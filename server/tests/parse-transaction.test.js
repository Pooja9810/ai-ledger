import { describe, it, expect, vi } from "vitest";
import { parseTransaction } from "../src/ai/parse-transaction.js";
import { parseDollarsToCents } from "../src/money.js";
import { AiError } from "../src/ai/client.js";

const CATEGORIES = [
  { id: 1, name: "Salary", kind: "income" },
  { id: 4, name: "Dining Out", kind: "expense" },
  { id: 3, name: "Groceries", kind: "expense" },
  { id: 11, name: "Opening balance", kind: "transfer" },
];
const TODAY = "2026-11-11"; // a Wednesday

function fakeAi(data) {
  return { completeJson: vi.fn().mockResolvedValue({ data, usage: {} }) };
}
const parse = (data, text = "spent $12.50 on lunch at Chipotle yesterday") =>
  parseTransaction(fakeAi(data), {
    text,
    today: TODAY,
    categories: CATEGORIES,
  });

const GOOD = {
  kind: "expense",
  amount: "12.50",
  date: "2026-11-10",
  description: "Chipotle",
  category: "Dining Out",
};

describe("parseDollarsToCents (server copy)", () => {
  it.each([
    ["12.50", 1250],
    ["$1,200", 120000],
    ["7.5", 750],
    [" 3 ", 300],
    ["abc", null],
    ["-5", null],
    ["1.234", null],
    ["", null],
  ])("%j → %j", (input, expected) => {
    expect(parseDollarsToCents(input)).toBe(expected);
  });
});

describe("parseTransaction", () => {
  it("returns a validated draft for a good answer", async () => {
    expect(await parse(GOOD)).toEqual({
      kind: "expense",
      amount_cents: -1250, // expenses are negative
      date: "2026-11-10",
      description: "Chipotle",
      category: { id: 4, name: "Dining Out" },
    });
  });

  it("makes income positive and matches income categories", async () => {
    const draft = await parse({
      ...GOOD,
      kind: "income",
      amount: "4,125.00",
      description: "ACME Corp",
      category: "Salary",
    });
    expect(draft.amount_cents).toBe(412500);
    expect(draft.category).toEqual({ id: 1, name: "Salary" });
  });

  it("sends today's date and weekday, both category lists, and the note", async () => {
    const ai = fakeAi(GOOD);
    await parseTransaction(ai, {
      text: "  lunch 12.50  ",
      today: TODAY,
      categories: CATEGORIES,
    });
    const { system, user } = ai.completeJson.mock.calls[0][0];
    expect(user).toContain("Today: 2026-11-11 (Wednesday)");
    expect(user).toContain("Expense categories: Dining Out, Groceries");
    expect(user).toContain("Income categories: Salary");
    expect(user).not.toContain("Opening balance"); // transfer: never offered
    expect(user).toContain("Note: lunch 12.50");
    expect(system).toContain("json");
    expect(system).not.toContain("2026-11-11"); // no dates in the cached prompt
  });

  describe("invalid fields become empty, never errors", () => {
    it.each([
      ["a non-numeric amount", { amount: "twelve" }, "amount_cents", null],
      ["a zero amount", { amount: "0" }, "amount_cents", null],
      ["a negative amount", { amount: "-12.50" }, "amount_cents", null],
      ["a missing amount", { amount: null }, "amount_cents", null],
      ["a fake date", { date: "2026-02-30" }, "date", null],
      ["a future date", { date: "2026-11-12" }, "date", null],
      ["a non-ISO date", { date: "yesterday" }, "date", null],
      ["a made-up category", { category: "Coffee" }, "category", null],
      ["a wrong-kind category", { category: "Salary" }, "category", null],
      [
        "a transfer category",
        { category: "Opening balance" },
        "category",
        null,
      ],
      ["a non-string description", { description: 42 }, "description", ""],
    ])("%s", async (_label, change, field, expected) => {
      const draft = await parse({ ...GOOD, ...change });
      expect(draft[field]).toEqual(expected);
    });

    it("defaults an unknown kind to expense (the form's default)", async () => {
      expect((await parse({ ...GOOD, kind: "refund" })).kind).toBe("expense");
    });

    it("accepts today's date", async () => {
      expect((await parse({ ...GOOD, date: TODAY })).date).toBe(TODAY);
    });

    it("trims and caps the description", async () => {
      const draft = await parse({
        ...GOOD,
        description: `  ${"x".repeat(300)} `,
      });
      expect(draft.description).toHaveLength(200);
    });

    it("survives a completely empty answer", async () => {
      expect(await parse({})).toEqual({
        kind: "expense",
        amount_cents: null,
        date: null,
        description: "",
        category: null,
      });
    });
  });

  it("lets AiError propagate", async () => {
    const ai = { completeJson: vi.fn().mockRejectedValue(new AiError("down")) };
    await expect(
      parseTransaction(ai, { text: "x", today: TODAY, categories: CATEGORIES }),
    ).rejects.toBeInstanceOf(AiError);
  });
});
