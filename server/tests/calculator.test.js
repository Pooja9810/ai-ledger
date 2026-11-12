import { describe, it, expect } from "vitest";
import { calculate, parseValue, OPERATIONS } from "../src/ai/calculator.js";

const calc = (operation, ...values) => calculate({ operation, values });
const answer = (operation, ...values) =>
  calc(operation, ...values).result?.answer;

describe("parseValue", () => {
  it.each([
    ["$1,234.56", { money: true, cents: 123456 }],
    ["−$4.00", { money: true, cents: -400 }], // real minus, as tools return it
    ["-$4", { money: true, cents: -400 }],
    [" $ 7.5 ", { money: true, cents: 750 }],
    ["10.4", { money: false, number: 10.4 }],
    [2, { money: false, number: 2 }],
  ])("%j → %j", (input, expected) => {
    expect(parseValue(input)).toEqual(expected);
  });

  it.each([
    ["$1.234"],
    ["abc"],
    ["1e5"],
    [""],
    [null],
    [NaN],
    [Infinity],
    ["$"],
  ])("rejects %j", (input) => {
    expect(parseValue(input)).toBeNull();
  });
});

describe("calculate", () => {
  it("averages money exactly, in cents (the dining-out question)", () => {
    expect(answer("average", "$46.10", "$294.59")).toBe("$170.35"); // 34069 / 2 = 17034.5 → 17035
  });

  it.each([
    [["add", "$46.10", "$294.59"], "$340.69"],
    [["add", "$0.10", "$0.20"], "$0.30"], // 0.1 + 0.2 = 0.30000000000000004 in floats
    [["subtract", "$100.00", "$19.99", "$0.01"], "$80.00"],
    [["subtract", "$10.00", "$25.00"], "−$15.00"],
    [["multiply", "$4.00", 5], "$20.00"],
    [["multiply", 3, 4], "12"],
    [["divide", "$340.69", 6], "$56.78"],
    [["divide", "$294.59", "$46.10"], "6.3902"], // amount ÷ amount = a ratio
    [["divide", 10, 4], "2.5"],
    [["average", 1, 2, 4], "2.3333"],
    [["percent_of", "$294.59", "$2,291.80"], "12.9%"],
    [["percent_change", "$46.10", "$294.59"], "+539.0%"],
    [["percent_change", "$200.00", "$150.00"], "−25.0%"],
  ])("%j → %s", ([operation, ...values], expected) => {
    expect(answer(operation, ...values)).toBe(expected);
  });

  it.each([
    [{ operation: "eval", values: [1, 2] }, /operation must be one of/],
    [{ operation: "add", values: "1+2" }, /values must be a list/],
    [{ operation: "add", values: ["$1.00"] }, /needs 2 to 50 values/],
    [{ operation: "divide", values: [1, 2, 3] }, /exactly 2 values/],
    [{ operation: "add", values: ["$1.00", "1+1"] }, /"1\+1" isn't a number/],
    [{ operation: "add", values: ["$1.00", 2] }, /can't mix/],
    [{ operation: "multiply", values: ["$1.00", "$2.00"] }, /two amounts/],
    [{ operation: "divide", values: ["$5.00", 0] }, /divide by zero/],
    [{ operation: "divide", values: [5, "$1.00"] }, /number by an amount/],
    [
      { operation: "percent_of", values: ["$5.00", "$0.00"] },
      /whole can't be zero/,
    ],
    [{ operation: "percent_change", values: [0, 5] }, /change from zero/],
  ])("returns a helpful error for %j", (args, message) => {
    expect(calculate(args).error).toMatch(message);
  });

  it("offers a fixed list of operations (no free-form expressions)", () => {
    expect(OPERATIONS).toEqual([
      "add",
      "subtract",
      "multiply",
      "divide",
      "average",
      "percent_of",
      "percent_change",
    ]);
  });
});
