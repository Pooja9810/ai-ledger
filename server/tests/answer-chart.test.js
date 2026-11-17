import { describe, it, expect } from "vitest";
import {
  chartFromToolRuns,
  parseFormattedCents,
} from "../src/ai/answer-chart.js";

const listRun = (from, to, total, category = "Dining Out") => ({
  name: "list_transactions",
  args: { from, to, category, limit: 50 },
  result: {
    total_of_matching: total,
    transactions: [{ category: "Dining Out" }],
  },
});
const monthlyRun = (months) => ({
  name: "get_monthly_totals",
  args: {},
  result: { months: months.map(([month, spending]) => ({ month, spending })) },
});
const categoryRun = (rows) => ({
  name: "get_spending_by_category",
  args: { from: "2026-11-01", to: "2026-11-17" },
  result: {
    categories: rows.map(([category, spent]) => ({ category, spent })),
  },
});

describe("parseFormattedCents", () => {
  it.each([
    ["$1,234.56", 123456],
    ["−$4.00", -400],
    ["-$4.00", -400],
    ["$0.07", 7],
    ["1,234.56", null],
    ["$12.5", null],
    [undefined, null],
  ])("%s → %s", (text, cents) => {
    expect(parseFormattedCents(text)).toBe(cents);
  });
});

describe("chartFromToolRuns", () => {
  it("charts one category month by month (the dining-out question)", () => {
    const chart = chartFromToolRuns([
      monthlyRun([
        ["2026-10", "$2,746.12"],
        ["2026-11", "$2,656.31"],
      ]),
      listRun("2026-09-01", "2026-09-30", "−$602.16"),
      listRun("2026-07-01", "2026-07-31", "−$431.97"),
      listRun("2026-11-01", "2026-11-17", "−$154.32"), // month so far counts
    ]);
    expect(chart).toEqual({
      kind: "months",
      title: "Dining Out by month",
      bars: [
        { key: "2026-07", cents: 43197 },
        { key: "2026-09", cents: 60216 },
        { key: "2026-11", cents: 15432 },
      ],
    });
  });

  it("doesn't mix categories or count partial ranges as months", () => {
    expect(
      chartFromToolRuns([
        listRun("2026-09-01", "2026-09-30", "−$602.16", "Dining Out"),
        listRun("2026-10-01", "2026-10-31", "−$120.00", "Groceries"),
      ]),
    ).toBeNull();
    expect(
      chartFromToolRuns([
        listRun("2026-09-05", "2026-09-30", "−$1.00"),
        listRun("2026-10-01", "2026-11-30", "−$2.00"),
      ]),
    ).toBeNull();
  });

  it("charts spending per month from monthly totals", () => {
    expect(
      chartFromToolRuns([
        monthlyRun([
          ["2026-05", "$3,174.89"],
          ["2026-06", "$3,144.89"],
        ]),
      ]),
    ).toEqual({
      kind: "months",
      title: "Spending by month",
      bars: [
        { key: "2026-05", cents: 317489 },
        { key: "2026-06", cents: 314489 },
      ],
    });
  });

  it("charts the top categories, and prefers the overview called last", () => {
    const rows = [
      ["Rent", "$1,650.00"],
      ["Groceries", "$272.61"],
      ["Utilities", "$209.44"],
      ["Dining Out", "$154.32"],
      ["Transport", "$130.03"],
      ["Uncategorized", "$99.74"],
      ["Entertainment", "$94.77"],
    ];
    const chart = chartFromToolRuns([
      monthlyRun([
        ["2026-10", "$1.00"],
        ["2026-11", "$2.00"],
      ]),
      categoryRun(rows),
    ]);
    expect(chart.kind).toBe("categories");
    expect(chart.bars).toHaveLength(6);
    expect(chart.bars[0]).toEqual({ key: "Rent", cents: 165000 });
  });

  it("has no chart for lookups without a chart shape", () => {
    expect(chartFromToolRuns([])).toBeNull();
    expect(
      chartFromToolRuns([
        { name: "get_account_balances", args: {}, result: { accounts: [] } },
        monthlyRun([["2026-11", "$2.00"]]), // one month isn't a trend
      ]),
    ).toBeNull();
  });
});

describe("chartFromToolRuns: a single category", () => {
  it("draws nothing for one bar", () => {
    expect(chartFromToolRuns([categoryRun([["Rent", "$1.00"]])])).toBeNull();
  });
});

describe("chartFromToolRuns: the AI's other routes", () => {
  const monthBreakdown = (from, to, rows) => ({
    name: "get_spending_by_category",
    args: { from, to },
    result: {
      categories: rows.map(([category, spent]) => ({ category, spent })),
    },
  });
  const breakdowns = [
    monthBreakdown("2026-09-01", "2026-09-30", [
      ["Rent", "$1,650.00"],
      ["Dining Out", "$602.16"],
    ]),
    monthBreakdown("2026-10-01", "2026-10-31", [["Rent", "$1,650.00"]]),
    monthBreakdown("2026-11-01", "2026-11-17", [
      ["Rent", "$1,650.00"],
      ["Dining Out", "$154.32"],
    ]),
  ];

  it("charts the category the question names from month-by-month breakdowns", () => {
    const chart = chartFromToolRuns(
      [
        categoryRun([
          ["Rent", "$9.00"],
          ["Dining Out", "$1.00"],
        ]), // a wide lookup first: ignored in favour of the monthly ones
        ...breakdowns,
      ],
      "Which month did I spend the most on dining out?",
    );
    expect(chart).toEqual({
      kind: "months",
      title: "Dining Out by month",
      bars: [
        { key: "2026-09", cents: 60216 },
        { key: "2026-10", cents: 0 }, // no dining that month
        { key: "2026-11", cents: 15432 },
      ],
    });
  });

  it("draws nothing when the question names no category, or two", () => {
    expect(
      chartFromToolRuns(breakdowns, "Which was my priciest month?"),
    ).toBeNull();
    expect(
      chartFromToolRuns(breakdowns, "Rent or dining out: which grew more?"),
    ).toBeNull();
  });

  it("titles a category overview with its dates", () => {
    const chart = chartFromToolRuns([
      categoryRun([
        ["Rent", "$1,650.00"],
        ["Groceries", "$272.61"],
      ]),
    ]);
    expect(chart.title).toBe("Spending by category · Nov 1–17, 2026");
  });

  it("leaves out months before the ledger began", () => {
    const run = monthlyRun([
      ["2026-03", "$0.00"],
      ["2026-04", "$0.00"],
      ["2026-05", "$3,174.89"],
      ["2026-06", "$3,144.89"],
    ]);
    run.result.ledger_starts = "2026-05-01";
    expect(chartFromToolRuns([run]).bars.map((b) => b.key)).toEqual([
      "2026-05",
      "2026-06",
    ]);
  });

  it("draws nothing when the AI made several overview lookups", () => {
    const rows = [
      ["Rent", "$1.00"],
      ["Groceries", "$2.00"],
    ];
    expect(
      chartFromToolRuns([categoryRun(rows), categoryRun(rows)]),
    ).toBeNull();
  });
});
