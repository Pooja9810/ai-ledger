import { describe, it, expect } from "vitest";
import {
  formatCents,
  formatDate,
  monthBounds,
  parseDollarsToCents,
} from "./format.js";

describe("parseDollarsToCents", () => {
  it.each([
    ["12.50", 1250],
    ["12.5", 1250],
    ["12", 1200],
    ["19.99", 1999], // Number("19.99") * 100 would be 1998.9999999999998
    ["0.29", 29], //    ...and this one 28.999999999999996
    [".99", 99],
    ["1,234.56", 123456],
    ["$45", 4500],
    ["  7.05  ", 705],
    ["0", 0],
  ])("parses %j as %i cents", (text, cents) => {
    expect(parseDollarsToCents(text)).toBe(cents);
  });

  it.each(["", ".", "abc", "12.345", "-5", "12.5.0", "1e3"])(
    "rejects %j",
    (text) => {
      expect(parseDollarsToCents(text)).toBeNull();
    },
  );
});

describe("formatCents", () => {
  it("formats positive, negative, and large amounts", () => {
    expect(formatCents(1250)).toBe("$12.50");
    expect(formatCents(-1250)).toBe("-$12.50");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
  });
});

describe("monthBounds", () => {
  it("handles month lengths and leap years", () => {
    expect(monthBounds("2026-11")).toEqual(["2026-11-01", "2026-11-30"]);
    expect(monthBounds("2026-02")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(monthBounds("2028-02")).toEqual(["2028-02-01", "2028-02-29"]);
  });
});

describe("formatDate", () => {
  it("shows the same calendar day that was stored (no UTC shift)", () => {
    expect(formatDate("2026-11-03")).toBe("Nov 3, 2026");
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
  });
});
