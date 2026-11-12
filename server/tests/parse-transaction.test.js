import { describe, it, expect, vi } from "vitest";
import { parseTransactions, MAX_DRAFTS } from "../src/ai/parse-transaction.js";
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
const parseAll = (data, text = "spent $12.50 on lunch at Chipotle yesterday") =>
  parseTransactions(fakeAi(data), {
    text,
    today: TODAY,
    categories: CATEGORIES,
  });
// Most tests check one item's validation: wrap it in the list shape, take the first draft.
const parse = async (item, text) =>
  (await parseAll({ transactions: [item] }, text))[0];

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

describe("parseTransactions", () => {
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
    await parseTransactions(ai, {
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

    it("drops items with neither an amount nor a description", async () => {
      expect(
        await parseAll({ transactions: [{}, { kind: "expense" }] }),
      ).toEqual([]);
    });
  });

  describe("several transactions in one note", () => {
    const COFFEE = {
      kind: "expense",
      amount: "4",
      date: TODAY,
      description: "Tim Hortons",
      category: "Dining Out",
    };
    const CHIPS = { ...COFFEE, amount: "15", description: "Five Guys" };

    it("returns one validated draft per transaction, in order", async () => {
      const drafts = await parseAll({ transactions: [COFFEE, CHIPS] });
      expect(drafts.map((d) => [d.description, d.amount_cents])).toEqual([
        ["Tim Hortons", -400],
        ["Five Guys", -1500],
      ]);
    });

    it("validates each item independently", async () => {
      const drafts = await parseAll({
        transactions: [{ ...COFFEE, date: "2026-11-30" }, CHIPS], // future date
      });
      expect(drafts[0].date).toBeNull();
      expect(drafts[1].date).toBe(TODAY);
    });

    it(`keeps at most ${MAX_DRAFTS}`, async () => {
      const many = Array.from({ length: 8 }, () => COFFEE);
      expect(await parseAll({ transactions: many })).toHaveLength(MAX_DRAFTS);
    });

    it("tolerates a single bare object instead of a list", async () => {
      expect(await parseAll(COFFEE)).toHaveLength(1);
    });

    it.each([
      ["transactions is not a list", { transactions: "nope" }],
      ["items are not objects", { transactions: [null, "x", 4] }],
    ])("returns [] when %s", async (_label, data) => {
      expect(await parseAll(data)).toEqual([]);
    });

    it("asks for a list and forbids merging in the prompt", async () => {
      const ai = fakeAi({ transactions: [] });
      await parseTransactions(ai, {
        text: "x",
        today: TODAY,
        categories: CATEGORIES,
      });
      const { system, maxTokens } = ai.completeJson.mock.calls[0][0];
      expect(system).toContain('{"transactions": [');
      expect(system).toMatch(/Never merge separate purchases/);
      expect(maxTokens).toBeGreaterThanOrEqual(500); // room for several items
    });
  });

  it("lets AiError propagate", async () => {
    const ai = { completeJson: vi.fn().mockRejectedValue(new AiError("down")) };
    await expect(
      parseTransactions(ai, {
        text: "x",
        today: TODAY,
        categories: CATEGORIES,
      }),
    ).rejects.toBeInstanceOf(AiError);
  });
});
