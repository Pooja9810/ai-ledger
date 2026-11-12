import { describe, it, expect } from "vitest";
import {
  centsToInput,
  draftToFields,
  draftNote,
  fillErrorMessage,
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
    [{ status: 502 }, "Couldn't reach the AI, try again"],
    [new TypeError("Failed to fetch"), "Couldn't reach the AI, try again"],
  ])("%j → %s", (error, expected) => {
    expect(fillErrorMessage(error)).toBe(expected);
  });
});
