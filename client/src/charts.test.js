import { describe, it, expect } from "vitest";
import {
  barHeights,
  changeLabel,
  donutSegments,
  groupCategories,
  previousMonthName,
  shortDollars,
  shortMonth,
  signedBars,
  TREND_METRICS,
} from "./charts.js";

const rows = [
  { category: "Rent", cents: 165000 },
  { category: "Groceries", cents: 27261 },
  { category: "Utilities", cents: 20944 },
  { category: "Dining Out", cents: 15432 },
  { category: "Transport", cents: 13003 },
  { category: "Uncategorized", cents: 9974 },
  { category: "Entertainment", cents: 9477 },
  { category: "Shopping", cents: 4540 },
];

describe("groupCategories", () => {
  it("keeps the top four and folds the rest into Other", () => {
    const slices = groupCategories(rows);
    expect(slices.map((s) => s.label)).toEqual([
      "Rent",
      "Groceries",
      "Utilities",
      "Dining Out",
      "Other",
    ]);
    expect(slices[4]).toMatchObject({ cents: 36994, count: 4 });
    const total = slices.reduce((sum, s) => sum + s.cents, 0);
    expect(total).toBe(265631); // nothing lost
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
  });

  it("doesn't make an Other of one: five categories all show", () => {
    expect(groupCategories(rows.slice(0, 5)).map((s) => s.label)).not.toContain(
      "Other",
    );
  });

  it("is empty when nothing was spent", () => {
    expect(groupCategories([])).toEqual([]);
  });
});

describe("donutSegments", () => {
  it("lays slices end to end around the circle, with gaps", () => {
    const segs = donutSegments(
      [{ share: 0.5 }, { share: 0.25 }, { share: 0.25 }],
      100,
    );
    expect(segs).toEqual([
      { length: 49, offset: -0 },
      { length: 24, offset: -50 },
      { length: 24, offset: -75 },
    ]);
  });

  it("draws one slice as a full ring with no gap", () => {
    expect(donutSegments([{ share: 1 }], 100)).toEqual([
      { length: 100, offset: -0 },
    ]);
  });
});

describe("barHeights", () => {
  it("scales to the tallest bar and keeps tiny values visible", () => {
    expect(barHeights([480000, 240000, 100, 0], 100)).toEqual([100, 50, 2, 0]);
  });
  it("is all zero when there's no data", () => {
    expect(barHeights([0, 0], 100)).toEqual([0, 0]);
  });
});

describe("changeLabel", () => {
  it("describes a month in progress against the same days", () => {
    expect(
      changeLabel({ change_percent: 21.4, same_days: true }, "October"),
    ).toBe("Up 21.4% vs this point last month");
  });
  it("describes a finished month against the whole previous month", () => {
    expect(
      changeLabel({ change_percent: -3, same_days: false }, "October"),
    ).toBe("Down 3.0% vs October");
    expect(
      changeLabel({ change_percent: 0, same_days: false }, "October"),
    ).toBe("Same as October");
  });
  it("says nothing without a base to compare with", () => {
    expect(changeLabel({ change_percent: null }, "October")).toBeNull();
    expect(changeLabel(null, "October")).toBeNull();
  });
});

describe("labels", () => {
  it("rounds to whole dollars and shortens month names", () => {
    expect(shortDollars(165000)).toBe("$1,650");
    expect(shortDollars(27261)).toBe("$273");
    expect(shortMonth("2026-11")).toBe("Nov");
  });
});

describe("previousMonthName", () => {
  it("steps back a month, across the year boundary", () => {
    expect(previousMonthName("2026-11")).toBe("October");
    expect(previousMonthName("2026-01")).toBe("December");
  });
});

describe("signedBars", () => {
  it("uses the whole height when nothing is negative", () => {
    expect(signedBars([400, 200, 0])).toEqual({
      up: 1,
      bars: [
        { negative: false, share: 1 },
        { negative: false, share: 0.5 },
        { negative: false, share: 0 },
      ],
    });
  });

  it("splits the height at zero by the largest bar on each side", () => {
    const { up, bars } = signedBars([300, -100, -50]);
    expect(up).toBe(0.75);
    expect(bars).toEqual([
      { negative: false, share: 1 },
      { negative: true, share: 1 },
      { negative: true, share: 0.5 },
    ]);
  });

  it("puts everything below zero when every month is negative", () => {
    expect(signedBars([-200, -100]).up).toBe(0);
  });

  it("handles no data and all zeros", () => {
    expect(signedBars([])).toEqual({ up: 1, bars: [] });
    expect(signedBars([0, 0]).up).toBe(1);
  });
});

describe("TREND_METRICS", () => {
  it("offers spending, income and saved, each reading a trend field", () => {
    expect(TREND_METRICS.map((m) => [m.label, m.field])).toEqual([
      ["Spending", "spending_cents"],
      ["Income", "income_cents"],
      ["Saved", "net_cents"],
    ]);
  });
});
