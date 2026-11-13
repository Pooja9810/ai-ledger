import { describe, it, expect } from "vitest";
import {
  transferDirection,
  transferPartners,
  transferProblems,
  transferSavedMessage,
} from "./transfer.js";

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

describe("transferDirection and transferPartners", () => {
  const out = {
    id: 1,
    transfer_id: 7,
    amount_cents: -60000,
    account_name: "Everyday Checking",
  };
  const into = {
    id: 2,
    transfer_id: 7,
    amount_cents: 60000,
    account_name: "Visa Card",
  };
  const coffee = {
    id: 3,
    transfer_id: null,
    amount_cents: -425,
    account_name: "Everyday Checking",
  };

  it("pairs the two halves of each transfer", () => {
    const partners = transferPartners([out, coffee, into]);
    expect(partners.get(1)).toBe(into);
    expect(partners.get(2)).toBe(out);
    expect(partners.has(3)).toBe(false);
  });

  it("says where the money went or came from", () => {
    expect(transferDirection(out, into)).toBe("To Visa Card");
    expect(transferDirection(into, out)).toBe("From Everyday Checking");
  });

  it("falls back to 'Transfer' when the other half isn't in the list", () => {
    const partners = transferPartners([out]); // e.g. filtered to one account
    expect(transferDirection(out, partners.get(1))).toBe("Transfer");
  });
});
