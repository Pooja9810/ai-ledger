/**
 * "Ask your ledger" tools: read-only functions the AI may ASK us to run.
 *
 * Two halves per tool:
 *   - a definition in TOOL_DEFINITIONS: the "menu" the AI sees
 *     (name, description, inputs as JSON Schema)
 *   - an implementation in createLedgerTools(db): our SQL, which the AI never sees
 *
 * Rules (same as the dashboard, see CLAUDE.md):
 *   - every tool is READ-ONLY; there is no tool that can change data
 *   - spending = expense categories + uncategorized money out; income =
 *     income categories; 'transfer' (opening balances) never counts
 *   - amounts and percentages are computed HERE and returned pre-formatted,
 *     so the AI quotes numbers instead of calculating them
 *   - bad inputs return { error } (not an exception), so the AI can read the
 *     message in the next round and correct itself
 */
import { isValidDate } from "../validation.js";
import {
  MONTH_PATTERN,
  monthRange,
  formatDateRange,
  formatMonthRange,
} from "../dates.js";
import { formatCents } from "../money.js";
import { calculate, OPERATIONS } from "./calculator.js";

export const MAX_TRANSACTIONS = 50; // per list_transactions call
const DEFAULT_TRANSACTIONS = 20;
const MAX_MONTHS = 24; // per get_monthly_totals call

// A date range, used by several tools.
const dateRangeParams = {
  from: { type: "string", description: "Start date, inclusive, YYYY-MM-DD" },
  to: { type: "string", description: "End date, inclusive, YYYY-MM-DD" },
};

/**
 * The menu: sent to the AI with every question. Provider-neutral
 * ({ name, description, parameters as JSON Schema }); client.js wraps it
 * in whatever format the provider expects.
 */
export const TOOL_DEFINITIONS = [
  {
    name: "get_spending_by_category",
    description:
      "Total money spent per expense category between two dates, largest first, with each category's share of the total. Uncategorized spending is included. Also returns ledger_starts, the date of the user's first transaction (there is no data before it). Use for 'how much did I spend on X' and 'what did I spend the most on'.",
    parameters: {
      type: "object",
      properties: dateRangeParams,
      required: ["from", "to"],
    },
  },
  {
    name: "list_transactions",
    description: `Individual transactions between two dates, newest first, plus the count and total of ALL matches (not just those shown). Optionally filter by category name and/or a text search on the description (e.g. a merchant like "Starbucks"). Shows at most ${MAX_TRANSACTIONS}.`,
    parameters: {
      type: "object",
      properties: {
        ...dateRangeParams,
        category: {
          type: "string",
          description: "Exact category name, e.g. 'Dining Out' (optional)",
        },
        search: {
          type: "string",
          description:
            "Text to find in the description, e.g. 'uber' (optional)",
        },
        limit: {
          type: "integer",
          description: `How many to show, 1-${MAX_TRANSACTIONS} (default ${DEFAULT_TRANSACTIONS})`,
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_account_balances",
    description:
      "Current balance of every account (checking, savings, credit cards, cash) and the total net worth.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_budgets",
    description:
      "Monthly budgets for one month: each category's limit, amount spent, amount left, and whether it is over budget.",
    parameters: {
      type: "object",
      properties: {
        month: { type: "string", description: "Month as YYYY-MM" },
      },
      required: ["month"],
    },
  },
  {
    name: "get_monthly_totals",
    description: `Income, spending and net (income minus spending) for each month in a range, for trends and month-to-month comparisons, plus ledger_starts (the date of the first transaction; months before it have no data). At most ${MAX_MONTHS} months.`,
    parameters: {
      type: "object",
      properties: {
        from_month: { type: "string", description: "First month, YYYY-MM" },
        to_month: { type: "string", description: "Last month, YYYY-MM" },
      },
      required: ["from_month", "to_month"],
    },
  },
  {
    name: "calculate",
    description:
      'Exact arithmetic on values from other tools. Use it for EVERY sum, difference, average, ratio or percentage; never calculate in your head. Values are amounts exactly as tools return them ("$1,234.56", "−$4.00") or plain numbers (counts, months). add/multiply/average take 1+ values; subtract is first minus the rest; divide is [a, b]; percent_of is [part, whole]; percent_change is [old, new].',
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: OPERATIONS },
        values: {
          type: "array",
          items: { type: ["string", "number"] },
          description: 'e.g. ["$46.10", "$294.59"] or ["$340.69", 2]',
        },
      },
      required: ["operation", "values"],
    },
  },
];

/** "23%" of a total; integer math, rounded to the nearest percent. */
function percentOf(part, total) {
  return total > 0 ? `${Math.round((part * 100) / total)}%` : "0%";
}

/** Every month from 'YYYY-MM' to 'YYYY-MM', inclusive. */
function monthsBetween(fromMonth, toMonth) {
  const months = [];
  let [y, m] = fromMonth.split("-").map(Number);
  const [endY, endM] = toMonth.split("-").map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m === 13) [y, m] = [y + 1, 1];
  }
  return months;
}

/** Validate a from/to date pair. Returns an error message or null. */
function checkDateRange(args) {
  if (!isValidDate(args.from))
    return "from must be a real date like 2026-10-01";
  if (!isValidDate(args.to)) return "to must be a real date like 2026-10-31";
  if (args.from > args.to) return "from must be on or before to";
  return null;
}

/**
 * The real implementations, bound to a database.
 * @returns { run(name, args) → { result } | { error }, describe(name, args) → string }
 */
export function createLedgerTools(db) {
  // Same definitions of spending/income as the dashboard summary.
  const spendingByCategory = db.prepare(`
    SELECT COALESCE(c.name, 'Uncategorized') AS category,
           -SUM(t.amount_cents) AS spent_cents,
           COUNT(*) AS count
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date BETWEEN ? AND ?
      AND (c.kind = 'expense' OR (t.category_id IS NULL AND t.amount_cents < 0))
    GROUP BY c.id
    ORDER BY spent_cents DESC`);

  const monthTotals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN c.kind = 'income' THEN t.amount_cents END), 0)
        AS income_cents,
      COALESCE(-SUM(CASE
        WHEN c.kind = 'expense' THEN t.amount_cents
        WHEN t.category_id IS NULL AND t.amount_cents < 0 THEN t.amount_cents
      END), 0) AS spending_cents
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date BETWEEN ? AND ?`);

  const balances = db.prepare(`
    SELECT a.name AS account, a.type, COALESCE(SUM(t.amount_cents), 0) AS balance_cents
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
    GROUP BY a.id
    ORDER BY a.id`);

  // Date filter in the JOIN, not a WHERE, so budgets with no spending still show.
  const budgets = db.prepare(`
    SELECT c.name AS category, b.monthly_limit_cents AS limit_cents,
           COALESCE(-SUM(t.amount_cents), 0) AS spent_cents
    FROM budgets b
    JOIN categories c ON c.id = b.category_id
    LEFT JOIN transactions t
      ON t.category_id = b.category_id AND t.date BETWEEN ? AND ?
    GROUP BY b.category_id
    ORDER BY c.name`);

  // First real transaction (opening balances excluded): no data exists before it.
  const firstTransaction = db.prepare(`
    SELECT MIN(t.date) AS first
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE c.kind IS NULL OR c.kind <> 'transfer'`);
  const ledgerStarts = () => firstTransaction.get().first ?? null;

  const findCategory = db.prepare(
    "SELECT id, name FROM categories WHERE name = ? AND kind <> 'transfer'", // name is COLLATE NOCASE
  );
  const categoryNames = db.prepare(
    "SELECT name FROM categories WHERE kind <> 'transfer' ORDER BY name",
  );

  const tools = {
    get_spending_by_category(args) {
      const problem = checkDateRange(args);
      if (problem) return { error: problem };

      const rows = spendingByCategory.all(args.from, args.to);
      const total = rows.reduce((sum, r) => sum + r.spent_cents, 0);
      return {
        result: {
          from: args.from,
          to: args.to,
          ledger_starts: ledgerStarts(),
          total_spent: formatCents(total),
          categories: rows.map((r) => ({
            category: r.category,
            spent: formatCents(r.spent_cents),
            share_of_total: percentOf(r.spent_cents, total),
            transactions: r.count,
          })),
        },
      };
    },

    list_transactions(args) {
      const problem = checkDateRange(args);
      if (problem) return { error: problem };

      const limit = args.limit ?? DEFAULT_TRANSACTIONS;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TRANSACTIONS) {
        return {
          error: `limit must be a whole number from 1 to ${MAX_TRANSACTIONS}`,
        };
      }

      // Build the WHERE clause from fixed pieces; user/AI text only ever
      // goes into ? placeholders, never into the SQL itself (no injection).
      const where = [
        "t.date BETWEEN ? AND ?",
        "(c.kind IS NULL OR c.kind <> 'transfer')",
      ];
      const params = [args.from, args.to];

      if (args.category !== undefined && args.category !== null) {
        if (typeof args.category !== "string")
          return { error: "category must be a string" };
        if (args.category.toLowerCase() === "uncategorized") {
          where.push("t.category_id IS NULL");
        } else {
          const category = findCategory.get(args.category.trim());
          if (!category) {
            const names = categoryNames.all().map((r) => r.name);
            return {
              error: `Unknown category "${args.category}". Valid categories: ${names.join(", ")}, Uncategorized`,
            };
          }
          where.push("t.category_id = ?");
          params.push(category.id);
        }
      }
      if (args.search !== undefined && args.search !== null) {
        if (typeof args.search !== "string" || args.search.trim() === "") {
          return { error: "search must be non-empty text" };
        }
        where.push("t.description LIKE ?");
        params.push(`%${args.search.trim()}%`); // LIKE is case-insensitive for ASCII
      }

      const from = `
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE ${where.join(" AND ")}`;
      const { count, total_cents } = db
        .prepare(
          `SELECT COUNT(*) AS count, COALESCE(SUM(t.amount_cents), 0) AS total_cents ${from}`,
        )
        .get(...params);
      const rows = db
        .prepare(
          `SELECT t.date, t.description, t.amount_cents,
                  COALESCE(c.name, 'Uncategorized') AS category, a.name AS account
           ${from} ORDER BY t.date DESC, t.id DESC LIMIT ?`,
        )
        .all(...params, limit);

      return {
        result: {
          matching: count,
          shown: rows.length,
          total_of_matching: formatCents(total_cents), // money in − money out
          transactions: rows.map((r) => ({
            date: r.date,
            description: r.description,
            amount: formatCents(r.amount_cents),
            category: r.category,
            account: r.account,
          })),
        },
      };
    },

    get_account_balances() {
      const rows = balances.all();
      const net = rows.reduce((sum, r) => sum + r.balance_cents, 0);
      return {
        result: {
          net_worth: formatCents(net),
          accounts: rows.map((r) => ({
            account: r.account,
            type: r.type,
            balance: formatCents(r.balance_cents),
          })),
        },
      };
    },

    get_budgets(args) {
      if (typeof args.month !== "string" || !MONTH_PATTERN.test(args.month)) {
        return { error: "month must be like 2026-11" };
      }
      const rows = budgets.all(...monthRange(args.month));
      return {
        result: {
          month: args.month,
          budgets: rows.map((r) => {
            const left = r.limit_cents - r.spent_cents;
            return {
              category: r.category,
              limit: formatCents(r.limit_cents),
              spent: formatCents(r.spent_cents),
              used: percentOf(r.spent_cents, r.limit_cents),
              status:
                left < 0
                  ? `over by ${formatCents(-left)}`
                  : `${formatCents(left)} left`,
            };
          }),
        },
      };
    },

    get_monthly_totals(args) {
      const { from_month: fromMonth, to_month: toMonth } = args;
      if (typeof fromMonth !== "string" || !MONTH_PATTERN.test(fromMonth)) {
        return { error: "from_month must be like 2026-06" };
      }
      if (typeof toMonth !== "string" || !MONTH_PATTERN.test(toMonth)) {
        return { error: "to_month must be like 2026-11" };
      }
      if (fromMonth > toMonth)
        return { error: "from_month must be on or before to_month" };
      const months = monthsBetween(fromMonth, toMonth);
      if (months.length > MAX_MONTHS) {
        return { error: `at most ${MAX_MONTHS} months at a time` };
      }
      return {
        result: {
          ledger_starts: ledgerStarts(),
          months: months.map((month) => {
            const { income_cents, spending_cents } = monthTotals.get(
              ...monthRange(month),
            );
            return {
              month,
              income: formatCents(income_cents),
              spending: formatCents(spending_cents),
              net: formatCents(income_cents - spending_cents),
            };
          }),
        },
      };
    },

    calculate, // pure arithmetic; doesn't touch the database
  };

  return {
    /** Run a tool by name. Never throws for bad input; returns { error } instead. */
    run(name, args) {
      const tool = Object.hasOwn(tools, name) ? tools[name] : null;
      if (!tool) return { error: `Unknown tool "${name}"` };
      if (args === null || typeof args !== "object" || Array.isArray(args)) {
        return { error: "arguments must be a JSON object" };
      }
      return tool(args);
    },

    /** Human-readable label for the "Based on" line, e.g. "spending by category (Nov 1–12, 2026)". */
    describe(name, args = {}) {
      // Labels are only built from arguments the tool accepted, but stay
      // defensive: fall back to no range rather than throwing.
      const dates = (a, b) =>
        isValidDate(a) && isValidDate(b) ? ` (${formatDateRange(a, b)})` : "";
      const months = (a, b) =>
        MONTH_PATTERN.test(a ?? "") && MONTH_PATTERN.test(b ?? "")
          ? ` (${formatMonthRange(a, b)})`
          : "";
      switch (name) {
        case "get_spending_by_category":
          return `spending by category${dates(args.from, args.to)}`;
        case "list_transactions": {
          const filters = [
            args.category,
            args.search && `"${args.search}"`,
          ].filter(Boolean);
          const what = filters.length
            ? `${filters.join(", ")} transactions`
            : "transactions";
          return `${what}${dates(args.from, args.to)}`;
        }
        case "get_account_balances":
          return "account balances";
        case "get_budgets":
          return `budgets${months(args.month, args.month)}`;
        case "get_monthly_totals":
          return `monthly totals${months(args.from_month, args.to_month)}`;
        case "calculate":
          return `calculation${args.operation ? ` (${args.operation})` : ""}`;
        default:
          return name;
      }
    },
  };
}
