import { describe, it, expect } from "vitest";
import { transferProblems, transferSavedMessage } from "./transfer.js";

describe("transferProblems", () => {
  const ok = { cents: 60000, fromId: "1", toId: "2" };

  it("is empty for a complete transfer", () => {
    expect(transferProblems(ok)).toEqual([]);
  });

  it.each([
    [{ cents: null }, "Enter an amount like 600.00"],
    [{ cents: 0 }, "Enter an amount like 600.00"],
    [{ fromId: "" }, "Choose the account the money comes from"],
    [{ toId: "" }, "Choose the account the money goes to"],
    [{ toId: "1" }, "Choose two different accounts"],
  ])("%j → %s", (change, message) => {
    expect(transferProblems({ ...ok, ...change })).toEqual([message]);
  });

  it("lists every problem at once", () => {
    expect(
      transferProblems({ cents: null, fromId: "", toId: "" }),
    ).toHaveLength(3);
  });
});

describe("transferSavedMessage", () => {
  it("names the amount and both accounts", () => {
    expect(
      transferSavedMessage({
        amount_cents: 60000,
        from_account_name: "Chequing",
        to_account_name: "Visa",
      }),
    ).toBe("Transferred $600.00 · Chequing → Visa");
  });
});
