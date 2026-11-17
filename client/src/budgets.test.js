import { describe, it, expect } from "vitest";
import { budgetStatus, groupBudgets } from "./budgets.js";

describe("budgetStatus", () => {
  const limit = 40000; // $400

  it.each([
    [0, "good", "$400.00 left"],
    [31999, "good", "$80.01 left"], //   79.99%: still good
    [32000, "warning", "$80.00 left"], // exactly 80%: warning starts
    [40000, "warning", "$0.00 left"], //  exactly at the limit: not over yet
    [40001, "critical", "Over by $0.01"], // one cent over
    [55000, "critical", "Over by $150.00"],
  ])("spent %i of $400 → %s (%s)", (spent, level, label) => {
    expect(budgetStatus(spent, limit)).toMatchObject({ level, label });
  });

  it("always pairs the color level with an icon and a label", () => {
    for (const spent of [0, 35000, 50000]) {
      const status = budgetStatus(spent, limit);
      expect(status.icon).toBeTruthy();
      expect(status.label).toBeTruthy();
    }
  });
});

describe("budgetStatus with pace", () => {
  const limit = 17500; // $175, 30-day month
  const day17 = { day: 17, daysInMonth: 30 }; // 56.7% of the month gone

  it("flags spending 10+ points ahead of the calendar", () => {
    // 74.3% spent vs 56.7% of the month: ahead
    expect(budgetStatus(13003, limit, day17)).toMatchObject({
      level: "warning",
      icon: "→",
      short: "Ahead of pace",
      label: "Ahead of pace · $44.97 left",
    });
  });

  it("leaves a budget just under the line alone", () => {
    // 66.6% needed (56.7 + 10); 66% spent is fine
    expect(budgetStatus(11550, limit, day17).level).toBe("good");
  });

  it("is never 'ahead' on the last day (it can't be 10 points ahead of 100%)", () => {
    expect(budgetStatus(13000, limit, { day: 30, daysInMonth: 30 }).level).toBe(
      "good",
    );
  });

  it("keeps near-limit and over-limit ahead of pace", () => {
    expect(budgetStatus(14000, limit, day17).short).toBe("Near limit");
    expect(budgetStatus(18000, limit, day17).level).toBe("critical");
  });
});

describe("groupBudgets", () => {
  const pace = { day: 17, daysInMonth: 30 };
  const b = (name, spent, limit) => ({
    category_id: name,
    category_name: name,
    spent_cents: spent,
    monthly_limit_cents: limit,
  });

  it("puts the budgets that need a look first, most urgent first", () => {
    const groups = groupBudgets(
      [
        b("Groceries", 27261, 60000),
        b("Transport", 13003, 17500),
        b("Entertainment", 9477, 10000),
        b("Dining", 50000, 42500),
      ],
      pace,
    );
    expect(groups.attention.map((x) => x.category_name)).toEqual([
      "Dining", // over
      "Entertainment", // 95%
      "Transport", // ahead of pace
    ]);
    expect(groups.onTrack.map((x) => x.category_name)).toEqual(["Groceries"]);
    expect(groups.spentCents).toBe(27261 + 13003 + 9477 + 50000);
    expect(groups.limitCents).toBe(60000 + 17500 + 10000 + 42500);
  });

  it("counts a refund-heavy budget (negative spending) as zero", () => {
    const groups = groupBudgets([b("Shopping", -2000, 25000)], pace);
    expect(groups.spentCents).toBe(0);
    expect(groups.onTrack[0].spent).toBe(0);
  });
});
