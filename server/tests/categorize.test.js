import { describe, it, expect, vi } from "vitest";
import { suggestCategory, candidateCategories } from "../src/ai/categorize.js";
import { AiError } from "../src/ai/client.js";

const CATEGORIES = [
  { id: 1, name: "Salary", kind: "income" },
  { id: 3, name: "Groceries", kind: "expense" },
  { id: 4, name: "Dining Out", kind: "expense" },
  { id: 11, name: "Opening balance", kind: "transfer" },
];

/** A fake AI client whose completeJson returns the given data. */
function fakeAi(data) {
  return { completeJson: vi.fn().mockResolvedValue({ data, usage: {} }) };
}

describe("candidateCategories", () => {
  it("offers expense categories for negative amounts, never transfer", () => {
    const names = candidateCategories(CATEGORIES, -1250).map((c) => c.name);
    expect(names).toEqual(["Groceries", "Dining Out"]);
  });

  it("offers income categories for positive amounts", () => {
    const names = candidateCategories(CATEGORIES, 500000).map((c) => c.name);
    expect(names).toEqual(["Salary"]);
  });
});

describe("suggestCategory", () => {
  const input = {
    description: "STARBUCKS #1234 SEATTLE WA",
    amountCents: -575,
    categories: CATEGORIES,
  };

  it("returns the matching category's id and name", async () => {
    const ai = fakeAi({ category: "Dining Out" });
    expect(await suggestCategory(ai, input)).toEqual({
      id: 4,
      name: "Dining Out",
    });
  });

  it("sends only the candidate categories and the description", async () => {
    const ai = fakeAi({ category: "Dining Out" });
    await suggestCategory(ai, input);

    const { user, system } = ai.completeJson.mock.calls[0][0];
    expect(user).toContain("Groceries, Dining Out");
    expect(user).not.toContain("Salary"); // wrong kind for an expense
    expect(user).not.toContain("Opening balance"); // transfer: never offered
    expect(user).toContain("STARBUCKS #1234 SEATTLE WA");
    expect(system).toContain("json"); // DeepSeek JSON mode requires the word
  });

  it("matches names regardless of letter case", async () => {
    const ai = fakeAi({ category: "  dining out " });
    expect(await suggestCategory(ai, input)).toEqual({
      id: 4,
      name: "Dining Out",
    });
  });

  it.each([
    ["a made-up category", { category: "Coffee" }],
    ["a category of the wrong kind", { category: "Salary" }],
    ["a transfer category", { category: "Opening balance" }],
    ["an explicit null (AI unsure)", { category: null }],
    ["a non-string", { category: 4 }],
    ["a missing field", { answer: "Dining Out" }],
  ])("returns null for %s", async (_label, data) => {
    expect(await suggestCategory(fakeAi(data), input)).toBeNull();
  });

  it("skips the AI call for a blank description", async () => {
    const ai = fakeAi({ category: "Dining Out" });
    const result = await suggestCategory(ai, { ...input, description: "  " });
    expect(result).toBeNull();
    expect(ai.completeJson).not.toHaveBeenCalled(); // no wasted money
  });

  it("lets AiError propagate so the route can report it", async () => {
    const ai = {
      completeJson: vi.fn().mockRejectedValue(new AiError("AI request failed")),
    };
    await expect(suggestCategory(ai, input)).rejects.toBeInstanceOf(AiError);
  });
});
