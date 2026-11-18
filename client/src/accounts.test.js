import { describe, expect, it } from "vitest";
import { defaultAccountId } from "./accounts.js";

const accounts = [
  { id: 1, name: "Chequing" },
  { id: 2, name: "Visa" },
  { id: 3, name: "Savings" },
];

describe("defaultAccountId", () => {
  it("starts on the account used last time", () => {
    expect(defaultAccountId(accounts, "2")).toBe("2");
  });

  it("falls back to the first account when nothing is remembered", () => {
    expect(defaultAccountId(accounts, null)).toBe("1");
  });

  it("falls back to the first account when the remembered one was deleted", () => {
    expect(defaultAccountId(accounts, "99")).toBe("1");
  });

  it("matches ids whether they're numbers or strings", () => {
    expect(defaultAccountId([{ id: "3" }], 3)).toBe("3");
  });

  it("returns an empty choice when there are no accounts yet", () => {
    expect(defaultAccountId([], "2")).toBe("");
    expect(defaultAccountId(undefined, null)).toBe("");
  });
});
