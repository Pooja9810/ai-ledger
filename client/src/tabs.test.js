import { describe, it, expect } from "vitest";
import { tabFromHash, hashFor, TABS } from "./tabs.js";

describe("tabs", () => {
  it.each([
    ["#budgets", "budgets"],
    ["#/ask", "ask"],
    ["#Transactions", "transactions"],
    ["", "home"],
    ["#nope", "home"],
    [undefined, "home"],
  ])("%s → %s", (hash, tab) => {
    expect(tabFromHash(hash)).toBe(tab);
  });

  it("round-trips every tab", () => {
    for (const { id } of TABS) expect(tabFromHash(hashFor(id))).toBe(id);
  });
});
