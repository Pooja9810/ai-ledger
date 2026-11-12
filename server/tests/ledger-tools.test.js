import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../src/db/index.js";
import {
  createLedgerTools,
  TOOL_DEFINITIONS,
  MAX_TRANSACTIONS,
} from "../src/ai/ledger-tools.js";
import { formatCents } from "../src/money.js";

/**
 * A small, known ledger so every expected number can be checked by hand:
 *
 * Checking: opening balance +1000.00 (transfer, never counted)
 *   Oct 03  Chipotle      −14.00  Dining Out
 *   Oct 12  Five Guys     −38.50  Dining Out
 *   Oct 15  No Frills     −86.42  Groceries
 *   Oct 20  Mystery shop  −10.00  (uncategorized: still spending)
 *   Oct 31  ACME payroll +4125.00 Salary
 *   Sep 05  Chipotle      −12.50  Dining Out
 * Visa: no transactions
 * Budget: Dining Out $50.00/month
 */
let db;
let tools;

function seed() {
  const cat = (name) =>
    db.prepare("SELECT id FROM categories WHERE name = ?").get(name).id;
  const checking = db
    .prepare(
      "INSERT INTO accounts (name, type) VALUES ('Checking', 'checking')",
    )
    .run().lastInsertRowid;
  db.prepare(
    "INSERT INTO accounts (name, type) VALUES ('Visa', 'credit_card')",
  ).run();
  const add = (date, description, cents, category) =>
    db
      .prepare(
        `INSERT INTO transactions (account_id, category_id, date, amount_cents, description)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(checking, category ? cat(category) : null, date, cents, description);

  add("2026-09-01", "Opening balance", 100000, "Opening balance");
  add("2026-10-03", "Chipotle", -1400, "Dining Out");
  add("2026-10-12", "Five Guys", -3850, "Dining Out");
  add("2026-10-15", "No Frills", -8642, "Groceries");
  add("2026-10-20", "Mystery shop", -1000, null);
  add("2026-10-31", "ACME payroll", 412500, "Salary");
  add("2026-09-05", "Chipotle", -1250, "Dining Out");
  db.prepare(
    "INSERT INTO budgets (category_id, monthly_limit_cents) VALUES (?, 5000)",
  ).run(cat("Dining Out"));
}

beforeEach(() => {
  db = openDatabase(":memory:");
  seed();
  tools = createLedgerTools(db);
});

const OCT = { from: "2026-10-01", to: "2026-10-31" };

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [-400, "−$4.00"],
    [123456, "$1,234.56"],
    [1999, "$19.99"],
  ])("%i → %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});

describe("TOOL_DEFINITIONS (the menu)", () => {
  it("describes exactly the tools that exist, in the OpenAI format", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toEqual([
      "get_spending_by_category",
      "list_transactions",
      "get_account_balances",
      "get_budgets",
      "get_monthly_totals",
    ]);
    for (const t of TOOL_DEFINITIONS) {
      expect(t.type).toBe("function");
      expect(t.function.description.length).toBeGreaterThan(20);
      expect(t.function.parameters.type).toBe("object");
      // every advertised tool must actually be runnable
      expect(tools.run(t.function.name, {}).error ?? "").not.toMatch(
        /Unknown tool/,
      );
    }
  });
});

describe("get_spending_by_category", () => {
  it("totals spending per category, largest first, with shares", () => {
    const { result } = tools.run("get_spending_by_category", OCT);
    // 14.00 + 38.50 + 86.42 + 10.00 = 148.92 (salary and opening balance excluded)
    expect(result.total_spent).toBe("$148.92");
    expect(result.categories).toEqual([
      {
        category: "Groceries",
        spent: "$86.42",
        share_of_total: "58%",
        transactions: 1,
      },
      {
        category: "Dining Out",
        spent: "$52.50",
        share_of_total: "35%",
        transactions: 2,
      },
      {
        category: "Uncategorized",
        spent: "$10.00",
        share_of_total: "7%",
        transactions: 1,
      },
    ]);
  });

  it("returns an empty list (not an error) for a quiet period", () => {
    const { result } = tools.run("get_spending_by_category", {
      from: "2025-01-01",
      to: "2025-01-31",
    });
    expect(result.total_spent).toBe("$0.00");
    expect(result.categories).toEqual([]);
  });

  it.each([
    [{ from: "October", to: "2026-10-31" }, /from must be a real date/],
    [{ from: "2026-10-01", to: "2026-02-30" }, /to must be a real date/],
    [{ from: "2026-10-31", to: "2026-10-01" }, /on or before/],
    [{}, /from must be/],
  ])("returns an error the AI can read for %j", (args, message) => {
    expect(tools.run("get_spending_by_category", args).error).toMatch(message);
  });
});

describe("list_transactions", () => {
  it("lists newest first with the count and total of all matches", () => {
    const { result } = tools.run("list_transactions", OCT);
    expect(result.matching).toBe(5);
    expect(result.shown).toBe(5);
    // 4125.00 − 148.92 = 3976.08 (income minus spending)
    expect(result.total_of_matching).toBe("$3,976.08");
    expect(result.transactions[0]).toEqual({
      date: "2026-10-31",
      description: "ACME payroll",
      amount: "$4,125.00",
      category: "Salary",
      account: "Checking",
    });
  });

  it("never includes transfer rows like opening balances", () => {
    const { result } = tools.run("list_transactions", {
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(result.transactions.map((t) => t.description)).toEqual(["Chipotle"]);
  });

  it("filters by category (any letter case)", () => {
    const { result } = tools.run("list_transactions", {
      ...OCT,
      category: "dining out",
    });
    expect(result.matching).toBe(2);
    expect(result.total_of_matching).toBe("−$52.50");
  });

  it("filters uncategorized transactions", () => {
    const { result } = tools.run("list_transactions", {
      ...OCT,
      category: "Uncategorized",
    });
    expect(result.transactions.map((t) => t.description)).toEqual([
      "Mystery shop",
    ]);
  });

  it("searches descriptions, case-insensitively, across dates", () => {
    const { result } = tools.run("list_transactions", {
      from: "2026-01-01",
      to: "2026-12-31",
      search: "chipotle",
    });
    expect(result.matching).toBe(2);
    expect(result.total_of_matching).toBe("−$26.50");
  });

  it("shows at most `limit`, but still counts all matches", () => {
    const { result } = tools.run("list_transactions", { ...OCT, limit: 2 });
    expect(result.shown).toBe(2);
    expect(result.matching).toBe(5);
  });

  it("treats search text as data, not SQL", () => {
    const { result } = tools.run("list_transactions", {
      ...OCT,
      search: "'; DROP TABLE transactions; --",
    });
    expect(result.matching).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n).toBe(
      7,
    );
  });

  it.each([
    [{ limit: 0 }, /limit must be/],
    [{ limit: MAX_TRANSACTIONS + 1 }, /limit must be/],
    [{ limit: "10" }, /limit must be/],
    [{ category: "Coffee" }, /Unknown category "Coffee".*Dining Out/],
    [{ category: "Opening balance" }, /Unknown category/], // transfer is hidden
    [{ search: "  " }, /search must be/],
  ])("returns a helpful error for %j", (extra, message) => {
    expect(tools.run("list_transactions", { ...OCT, ...extra }).error).toMatch(
      message,
    );
  });
});

describe("get_account_balances", () => {
  it("returns each balance and the net worth, including empty accounts", () => {
    const { result } = tools.run("get_account_balances", {});
    // 1000.00 + 4125.00 − 148.92 − 12.50 = 4963.58
    expect(result.net_worth).toBe("$4,963.58");
    expect(result.accounts).toEqual([
      { account: "Checking", type: "checking", balance: "$4,963.58" },
      { account: "Visa", type: "credit_card", balance: "$0.00" },
    ]);
  });
});

describe("get_budgets", () => {
  it("reports over-budget categories in words and numbers", () => {
    const { result } = tools.run("get_budgets", { month: "2026-10" });
    expect(result.budgets).toEqual([
      {
        category: "Dining Out",
        limit: "$50.00",
        spent: "$52.50",
        used: "105%",
        status: "over by $2.50",
      },
    ]);
  });

  it("still lists budgets in a month with no spending", () => {
    const { result } = tools.run("get_budgets", { month: "2026-08" });
    expect(result.budgets[0]).toMatchObject({
      spent: "$0.00",
      status: "$50.00 left",
    });
  });

  it("rejects a bad month", () => {
    expect(tools.run("get_budgets", { month: "October" }).error).toMatch(
      /month must be/,
    );
  });
});

describe("get_monthly_totals", () => {
  it("returns every month in the range, including empty ones", () => {
    const { result } = tools.run("get_monthly_totals", {
      from_month: "2026-08",
      to_month: "2026-10",
    });
    expect(result.months).toEqual([
      { month: "2026-08", income: "$0.00", spending: "$0.00", net: "$0.00" },
      { month: "2026-09", income: "$0.00", spending: "$12.50", net: "−$12.50" },
      {
        month: "2026-10",
        income: "$4,125.00",
        spending: "$148.92",
        net: "$3,976.08",
      },
    ]);
  });

  it("crosses year boundaries", () => {
    const { result } = tools.run("get_monthly_totals", {
      from_month: "2025-11",
      to_month: "2026-02",
    });
    expect(result.months.map((m) => m.month)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it.each([
    [{ from_month: "2026-13", to_month: "2026-14" }, /from_month must be/],
    [{ from_month: "2026-10", to_month: "2026-08" }, /on or before/],
    [{ from_month: "2020-01", to_month: "2026-01" }, /at most 24 months/],
  ])("rejects %j", (args, message) => {
    expect(tools.run("get_monthly_totals", args).error).toMatch(message);
  });
});

describe("run", () => {
  it("rejects tools that aren't on the menu", () => {
    expect(tools.run("delete_transaction", { id: 1 }).error).toBe(
      'Unknown tool "delete_transaction"',
    );
    expect(tools.run("toString", {}).error).toMatch(/Unknown tool/); // no prototype tricks
  });

  it("rejects non-object arguments", () => {
    expect(tools.run("get_account_balances", null).error).toMatch(
      /JSON object/,
    );
    expect(tools.run("get_account_balances", [1]).error).toMatch(/JSON object/);
  });
});

describe("describe (the 'Based on' labels)", () => {
  it.each([
    [
      "get_spending_by_category",
      OCT,
      "spending by category (2026-10-01 to 2026-10-31)",
    ],
    [
      "list_transactions",
      { ...OCT, category: "Dining Out" },
      "Dining Out transactions (2026-10-01 to 2026-10-31)",
    ],
    [
      "list_transactions",
      { ...OCT, search: "uber" },
      '"uber" transactions (2026-10-01 to 2026-10-31)',
    ],
    ["get_account_balances", {}, "account balances"],
    ["get_budgets", { month: "2026-11" }, "budgets (2026-11)"],
    [
      "get_monthly_totals",
      { from_month: "2026-06", to_month: "2026-11" },
      "monthly totals (2026-06 to 2026-11)",
    ],
  ])("%s %j → %s", (name, args, expected) => {
    expect(tools.describe(name, args)).toBe(expected);
  });
});
