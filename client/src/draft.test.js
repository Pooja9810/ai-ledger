import { describe, it, expect } from "vitest";
import {
  centsToInput,
  draftToFields,
  draftNote,
  fillErrorMessage,
  queueNote,
  nextFocus,
  findLikelyDuplicate,
} from "./draft.js";

const FULL = {
  kind: "expense",
  amount_cents: -1250,
  date: "2026-11-10",
  description: "Chipotle",
  category: { id: 4, name: "Dining Out" },
};
const form = { currentKind: "expense", currentCategoryId: "" };

describe("centsToInput", () => {
  it.each([
    [1250, "12.50"],
    [-1250, "12.50"],
    [5, "0.05"],
    [412500, "4125.00"],
    [1999, "19.99"], // 19.99 is exactly where float math goes wrong
  ])("%i → %s", (cents, expected) => {
    expect(centsToInput(cents)).toBe(expected);
  });
});

describe("draftToFields", () => {
  it("fills every field the AI found", () => {
    expect(draftToFields(FULL, form)).toEqual({
      kind: "expense",
      amount: "12.50",
      date: "2026-11-10",
      description: "Chipotle",
      categoryId: "4",
    });
  });

  it("leaves fields the AI couldn't read untouched", () => {
    const fields = draftToFields(
      {
        ...FULL,
        amount_cents: null,
        date: null,
        description: "",
        category: null,
      },
      { currentKind: "expense", currentCategoryId: "3" },
    );
    expect(fields).toEqual({ kind: "expense" }); // amount, date, description, category kept
  });

  it("clears the category when the kind changes and there's no new one", () => {
    const fields = draftToFields(
      { ...FULL, kind: "income", category: null },
      { currentKind: "expense", currentCategoryId: "3" },
    );
    expect(fields.categoryId).toBe("");
  });
});

describe("draftNote", () => {
  it("is null when amount and date were found", () => {
    expect(draftNote(FULL)).toBeNull();
  });
  it("asks for the amount first", () => {
    expect(draftNote({ ...FULL, amount_cents: null, date: null })).toMatch(
      /amount/,
    );
  });
  it("then mentions the date", () => {
    expect(draftNote({ ...FULL, date: null })).toMatch(/date/);
  });
});

describe("fillErrorMessage", () => {
  it.each([
    [{ status: 503 }, "AI isn't set up on the server"],
    [{ status: 400, message: "text is required" }, "text is required"],
    [
      {
        status: 429,
        message: "You've reached the demo's AI limit; try again in 12 min",
      },
      "You've reached the demo's AI limit; try again in 12 min",
    ],
    [{ status: 502 }, "Couldn't reach the AI, try again"],
    [new TypeError("Failed to fetch"), "Couldn't reach the AI, try again"],
  ])("%j → %s", (error, expected) => {
    expect(fillErrorMessage(error)).toBe(expected);
  });
});

describe("queueNote", () => {
  const fiveGuys = { description: "Five Guys", amount_cents: -1500 };
  const uber = { description: "Uber", amount_cents: -2300 };

  it("is null when nothing is waiting", () => {
    expect(queueNote([])).toBeNull();
  });

  it("describes one waiting transaction", () => {
    expect(queueNote([fiveGuys])).toBe(
      "1 more: Five Guys −$15.00 · fills after you save",
    );
  });

  it("lists several, in order", () => {
    expect(queueNote([fiveGuys, uber])).toBe(
      "2 more: Five Guys −$15.00, Uber −$23.00 · fill one by one after you save",
    );
  });

  it("copes with a missing amount or description", () => {
    expect(queueNote([{ description: "Coffee", amount_cents: null }])).toMatch(
      /^1 more: Coffee ·/,
    );
    expect(queueNote([{ description: "", amount_cents: -500 }])).toMatch(
      /^1 more: Transaction −\$5\.00/,
    );
  });
});

describe("nextFocus", () => {
  it.each([
    [{ hasAmount: false, hasAccount: false }, "amount"],
    [{ hasAmount: false, hasAccount: true }, "amount"],
    [{ hasAmount: true, hasAccount: false }, "account"],
    [{ hasAmount: true, hasAccount: true }, "submit"],
  ])("%j → %s", (state, expected) => {
    expect(nextFocus(state)).toBe(expected);
  });
});

describe("findLikelyDuplicate", () => {
  const saved = {
    id: 9,
    date: "2026-11-08",
    amount_cents: -3008,
    description: "MAPLE LEAF MARKET #0412",
    account_name: "Everyday Checking",
  };
  const draft = {
    date: "2026-11-08",
    amount_cents: -3008,
    description: "Maple Leaf Market",
  };

  it("finds the same receipt saved before (store number and case ignored)", () => {
    expect(findLikelyDuplicate(draft, [saved])).toBe(saved);
  });

  it.each([
    ["a different date", { date: "2026-11-09" }],
    ["a different amount", { amount_cents: -3009 }],
    ["a different merchant", { description: "Loblaws" }],
  ])("ignores %s", (_label, change) => {
    expect(findLikelyDuplicate({ ...draft, ...change }, [saved])).toBeNull();
  });

  it("is null when nothing is saved that day", () => {
    expect(findLikelyDuplicate(draft, [])).toBeNull();
  });
});
