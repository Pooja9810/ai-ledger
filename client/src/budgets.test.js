import { describe, it, expect } from "vitest";
import { budgetStatus } from "./budgets.js";

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
