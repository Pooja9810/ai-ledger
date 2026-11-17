import { describe, it, expect } from "vitest";
import {
  rowType,
  canDelete,
  transactionToFields,
  editRequest,
  undoRequest,
  rowLabel,
} from "./editing.js";

const coffee = {
  id: 7,
  account_id: 3,
  account_name: "Visa",
  category_id: 4,
  category_name: "Dining Out",
  category_kind: "expense",
  date: "2026-11-14",
  amount_cents: -450,
  description: "Tim Hortons",
  transfer_id: null,
};
const opening = {
  ...coffee,
  id: 1,
  category_id: 11,
  category_name: "Opening balance",
  category_kind: "transfer",
  amount_cents: 320000,
  description: "Opening balance",
};
const half = {
  ...coffee,
  id: 20,
  category_kind: "transfer",
  transfer_id: 5,
  amount_cents: -60000,
};
const transfer = {
  id: 5,
  date: "2026-11-14",
  amount_cents: 60000,
  description: "Visa payment",
  from_account_id: 1,
  from_account_name: "Everyday Chequing",
  to_account_id: 3,
  to_account_name: "Visa",
};

describe("rowType and canDelete", () => {
  it("tells normal rows, transfer halves and opening balances apart", () => {
    expect(rowType(coffee)).toBe("normal");
    expect(rowType(half)).toBe("transfer");
    expect(rowType(opening)).toBe("opening");
  });

  it("never deletes an opening balance (undo couldn't bring it back)", () => {
    expect(canDelete(coffee)).toBe(true);
    expect(canDelete(half)).toBe(true);
    expect(canDelete(opening)).toBe(false);
  });
});

describe("transactionToFields", () => {
  it("shows an expense as a positive amount with kind expense", () => {
    expect(transactionToFields(coffee)).toEqual({
      kind: "expense",
      amount: "4.50",
      description: "Tim Hortons",
      date: "2026-11-14",
      accountId: "3",
      toAccountId: "",
      categoryId: "4",
    });
  });

  it("uses the transfer, not the half, for a transfer", () => {
    expect(transactionToFields(half, transfer)).toMatchObject({
      kind: "transfer",
      amount: "600.00",
      accountId: "1",
      toAccountId: "3",
      description: "Visa payment",
    });
  });

  it("shows uncategorized as an empty category", () => {
    expect(
      transactionToFields({ ...coffee, category_id: null }).categoryId,
    ).toBe("");
  });
});

describe("editRequest", () => {
  const fields = transactionToFields(coffee);

  it("is null when nothing changed", () => {
    expect(editRequest(fields, coffee)).toBeNull();
  });

  it("sends only what changed, with the sign from the kind", () => {
    expect(editRequest({ ...fields, amount: "5.25" }, coffee)).toEqual({
      path: "/transactions/7",
      body: { amount_cents: -525 },
    });
    expect(
      editRequest({ ...fields, kind: "income", categoryId: "" }, coffee),
    ).toEqual({
      path: "/transactions/7",
      body: { amount_cents: 450, category_id: null },
    });
  });

  it("trims the description before comparing", () => {
    expect(
      editRequest({ ...fields, description: "  Tim Hortons " }, coffee),
    ).toBeNull();
  });

  it("never sends a category for an opening balance", () => {
    const f = transactionToFields(opening);
    expect(editRequest({ ...f, amount: "3500.00" }, opening)).toEqual({
      path: "/transactions/1",
      body: { amount_cents: 350000 },
    });
  });

  it("edits a transfer through /transfers, keeping the amount positive", () => {
    const f = transactionToFields(half, transfer);
    expect(editRequest({ ...f, amount: "650" }, half, transfer)).toEqual({
      path: "/transfers/5",
      body: { amount_cents: 65000 },
    });
  });
});

describe("undoRequest", () => {
  it("re-creates a normal transaction with the same values", () => {
    expect(undoRequest(coffee)).toEqual({
      path: "/transactions",
      body: {
        account_id: 3,
        category_id: 4,
        date: "2026-11-14",
        amount_cents: -450,
        description: "Tim Hortons",
      },
    });
  });

  it("re-creates a transfer (both halves) through /transfers", () => {
    expect(undoRequest(half, transfer)).toEqual({
      path: "/transfers",
      body: {
        from_account_id: 1,
        to_account_id: 3,
        amount_cents: 60000,
        date: "2026-11-14",
        description: "Visa payment",
      },
    });
  });
});

describe("rowLabel", () => {
  it("names the row for toasts", () => {
    expect(rowLabel(coffee)).toBe("Tim Hortons · −$4.50");
    expect(rowLabel(half, transfer)).toBe(
      "Transfer Everyday Chequing → Visa · $600.00",
    );
  });
});
