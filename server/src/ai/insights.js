/**
 * Monthly insights: a short written summary of a month.
 *
 * Our code computes EVERY number (SQL + formatting); the AI only writes the
 * words. A guard then checks that every $ amount and % in the AI's text
 * appears in the facts it was given, and drops any point that invents one.
 */
import { createLedgerTools } from "./ledger-tools.js";
import { formatCents } from "../money.js";
import { formatMonthRange, monthRange } from "../dates.js";

const MAX_POINTS = 5;
const TONES = ["good", "attention", "neutral"];

/** '2026-11' → '2026-10' */
export function previousMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Percent change in words, computed in code: "up 12.3%", "down 38.0%",
 * "no change", or null if there's no base. Words, not a sign, so the AI
 * can't write a double negative like "−8.8% lower".
 */
function percentChange(from, to) {
  if (from === 0) return null;
  const p = Math.round(((to - from) * 1000) / Math.abs(from)) / 10;
  if (p === 0) return "no change";
  return `${p > 0 ? "up" : "down"} ${Math.abs(p).toFixed(1)}%`;
}

const MONTHS_SHORT = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(
  " ",
);
const daysIn = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * Everything the summary may say, already computed and formatted.
 * @returns facts object, or null if the month has no transactions
 */
export function buildMonthFacts(db, month, today) {
  const prev = previousMonth(month);
  const [start, end] = monthRange(month);
  const tools = createLedgerTools(db);

  // A month in progress is compared with the SAME days of last month
  // (Nov 1–12 vs Oct 1–12), not all of last month: half a month vs a whole
  // one always looks like "spending is down". On Mar 31, Feb stops at 28.
  const inProgress = today.slice(0, 7) === month;
  const day = Number(today.slice(8));
  const [prevStart, prevMonthEnd] = monthRange(prev);
  const prevEnd = inProgress
    ? `${prev}-${String(Math.min(day, daysIn(prev))).padStart(2, "0")}`
    : prevMonthEnd;
  const comparedWith = inProgress
    ? `${MONTHS_SHORT[Number(prev.slice(5)) - 1]} 1–${Number(prevEnd.slice(8))}, ${prev.slice(0, 4)} (the same days last month)`
    : formatMonthRange(prev);

  const count = db
    .prepare(
      `SELECT COUNT(*) AS n FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date BETWEEN ? AND ? AND (c.kind IS NULL OR c.kind <> 'transfer')`,
    )
    .get(start, end).n;
  if (count === 0) return null;

  // Same definitions as the dashboard: transfers never count.
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN c.kind = 'income' THEN t.amount_cents END), 0) AS income,
      COALESCE(-SUM(CASE
        WHEN c.kind = 'expense' THEN t.amount_cents
        WHEN t.category_id IS NULL AND t.amount_cents < 0 THEN t.amount_cents
      END), 0) AS spending
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date BETWEEN ? AND ?`);
  const now = totals.get(start, end);
  const before = totals.get(prevStart, prevEnd);

  const spend = (from, to) =>
    tools.run("get_spending_by_category", { from, to }).result.categories;
  const lastMonthByCategory = new Map(
    db
      .prepare(
        `SELECT COALESCE(c.name, 'Uncategorized') AS category, -SUM(t.amount_cents) AS cents
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.date BETWEEN ? AND ?
           AND (c.kind = 'expense' OR (t.category_id IS NULL AND t.amount_cents < 0))
         GROUP BY c.id`,
      )
      .all(prevStart, prevEnd)
      .map((r) => [r.category, r.cents]),
  );
  const thisMonthCents = new Map(
    db
      .prepare(
        `SELECT COALESCE(c.name, 'Uncategorized') AS category, -SUM(t.amount_cents) AS cents
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.date BETWEEN ? AND ?
           AND (c.kind = 'expense' OR (t.category_id IS NULL AND t.amount_cents < 0))
         GROUP BY c.id`,
      )
      .all(start, end)
      .map((r) => [r.category, r.cents]),
  );

  // The tool validates dates, so give it the real last day (not '-31').
  const daysInMonth = daysIn(month);
  const categories = spend(
    start,
    `${month}-${String(daysInMonth).padStart(2, "0")}`,
  )
    .slice(0, 6)
    .map((c) => {
      const last = lastMonthByCategory.get(c.category) ?? 0;
      return {
        category: c.category,
        spent: c.spent,
        share_of_spending: c.share_of_total,
        before: formatCents(last),
        change:
          percentChange(last, thisMonthCents.get(c.category) ?? 0) ??
          "new this month",
      };
    });

  const biggest = db
    .prepare(
      `SELECT t.date, t.description, t.amount_cents
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date BETWEEN ? AND ? AND t.amount_cents < 0
         AND (c.kind IS NULL OR c.kind <> 'transfer')
       ORDER BY t.amount_cents ASC, t.date DESC LIMIT 3`,
    )
    .all(start, end)
    .map((t) => ({
      date: t.date,
      description: t.description,
      amount: formatCents(-t.amount_cents),
    }));

  return {
    month: formatMonthRange(month),
    status: inProgress
      ? `in progress: day ${day} of ${daysInMonth}`
      : "complete",
    compared_with: comparedWith, // "before" and "change" figures are for this period
    income: formatCents(now.income),
    spending: formatCents(now.spending),
    net: formatCents(now.income - now.spending),
    before: {
      income: formatCents(before.income),
      spending: formatCents(before.spending),
      net: formatCents(before.income - before.spending),
    },
    spending_change:
      percentChange(before.spending, now.spending) ?? "no spending last month",
    top_categories: categories,
    budgets: tools.run("get_budgets", { month }).result.budgets,
    biggest_purchases: biggest,
    transactions: count,
  };
}

// ---------------------------------------------------------- number guard

const NUMBER = /\$[\d,]+(?:\.\d{2})?|\d+(?:\.\d+)?%/g;
const normalize = (n) => n.replace(/[,$]/g, "").replace(/\.0+%$/, "%");

/** Every $ amount and % that appears anywhere in the facts. */
export function allowedNumbers(facts) {
  return new Set((JSON.stringify(facts).match(NUMBER) ?? []).map(normalize));
}

/** True if every $ amount and % in the text appears in the facts (signs ignored). */
export function numbersCheckOut(text, allowed) {
  return (text.match(NUMBER) ?? []).every((n) => allowed.has(normalize(n)));
}

// ---------------------------------------------------------------- writing

// Constant (no user data) so the provider can cache it.
const SYSTEM_PROMPT = `You write a short, friendly monthly money summary for a personal finance app.
You get facts that are already calculated. Respond in json as
{"headline": "one sentence", "points": [{"text": "...", "tone": "good" | "attention" | "neutral"}]}
with 3 to 5 points, each one short sentence.
Rules:
- Use ONLY numbers that appear in the facts, written exactly as given. Never calculate, round or invent a number.
- If the month is in progress, say "so far" and don't judge it as if it were complete.
- "before" and "change" figures compare with the period in compared_with. When that's the same days last month, say "compared with this point last month", never "than <month>".
- tone "attention" for problems (over budget, spending up sharply), "good" for good news (under budget, spending down), otherwise "neutral".
- Plain text only, no markdown.`;

/**
 * @returns { headline, points: [{ text, tone }], dropped }   dropped = points removed by the guard
 * @throws AiError if the AI call fails
 */
export async function writeInsights(ai, facts) {
  const { data } = await ai.completeJson({
    system: SYSTEM_PROMPT,
    user: `Facts:\n${JSON.stringify(facts, null, 1)}`,
    maxTokens: 600,
  });
  const allowed = allowedNumbers(facts);
  const clean = (text, max) =>
    typeof text === "string" && text.trim() ? text.trim().slice(0, max) : null;

  const candidates = (Array.isArray(data?.points) ? data.points : [])
    .map((p) => ({
      text: clean(p?.text, 220),
      tone: TONES.includes(p?.tone) ? p.tone : "neutral",
    }))
    .filter((p) => p.text);
  const points = candidates
    .filter((p) => numbersCheckOut(p.text, allowed))
    .slice(0, MAX_POINTS);

  let headline = clean(data?.headline, 160);
  if (!headline || !numbersCheckOut(headline, allowed)) {
    headline = `Here's ${facts.month}${facts.status === "complete" ? "" : " so far"}.`;
  }
  return { headline, points, dropped: candidates.length - points.length };
}

/** Changes whenever the month's (or last month's) transactions or the budgets change. */
export function dataFingerprint(db, month) {
  const [start] = monthRange(previousMonth(month));
  const [, end] = monthRange(month);
  const t = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total,
              COALESCE(SUM(id * 31 + COALESCE(category_id, 0)), 0) AS mix, COALESCE(MAX(id), 0) AS last
       FROM transactions WHERE date BETWEEN ? AND ?`,
    )
    .get(start, end);
  const b = db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(category_id * monthly_limit_cents), 0) AS mix FROM budgets",
    )
    .get();
  return [t.n, t.total, t.mix, t.last, b.n, b.mix].join(":");
}
