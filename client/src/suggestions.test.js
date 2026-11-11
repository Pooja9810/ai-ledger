import { describe, it, expect } from "vitest";
import {
  suggestionRequestKey,
  nextCategoryId,
  suggestionLabel,
} from "./suggestions.js";

describe("suggestionRequestKey", () => {
  const base = { description: "Starbucks", signedCents: -575, lastKey: null };

  it("builds a key from the sign and the trimmed, lowercased description", () => {
    expect(suggestionRequestKey({ ...base, description: "  Starbucks " })).toBe(
      "-|starbucks",
    );
    expect(suggestionRequestKey({ ...base, signedCents: 575 })).toBe(
      "+|starbucks",
    );
  });

  it.each([
    ["the description is blank", { description: "   " }],
    ["there is no valid amount yet", { signedCents: null }],
    ["the amount is zero", { signedCents: 0 }],
    ["nothing changed since the last request", { lastKey: "-|starbucks" }],
  ])("skips the request when %s", (_label, change) => {
    expect(suggestionRequestKey({ ...base, ...change })).toBeNull();
  });

  it("asks again when switching between expense and income", () => {
    expect(
      suggestionRequestKey({
        ...base,
        signedCents: 575,
        lastKey: "-|starbucks",
      }),
    ).toBe("+|starbucks");
  });
});

describe("nextCategoryId", () => {
  const dining = { id: 4, name: "Dining Out" };

  it("fills an empty category", () => {
    expect(
      nextCategoryId({ currentId: "", autoFilledId: null, suggestion: dining }),
    ).toBe("4");
  });

  it("never overwrites a category the user picked", () => {
    expect(
      nextCategoryId({
        currentId: "3",
        autoFilledId: null,
        suggestion: dining,
      }),
    ).toBe("3");
    // the user changed the auto-filled "4" to "3": still theirs
    expect(
      nextCategoryId({ currentId: "3", autoFilledId: "4", suggestion: dining }),
    ).toBe("3");
  });

  it("replaces its own earlier suggestion when the description changed", () => {
    expect(
      nextCategoryId({
        currentId: "3",
        autoFilledId: "3",
        suggestion: dining,
      }),
    ).toBe("4");
  });

  it("clears its own stale suggestion when there's no new one", () => {
    expect(
      nextCategoryId({ currentId: "3", autoFilledId: "3", suggestion: null }),
    ).toBe("");
  });
});

describe("suggestionLabel", () => {
  it("says where the suggestion came from, always with the icon", () => {
    expect(suggestionLabel("history")).toBe(
      "✨ Suggested from your past transactions",
    );
    expect(suggestionLabel("ai")).toBe("✨ Suggested by AI");
  });
});
