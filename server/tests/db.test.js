import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../src/db/index.js";

describe("database schema", () => {
  let db;
  let accountId;

  // Runs before EVERY test: a fresh in-memory DB, so tests can't affect each other.
  beforeEach(() => {
    db = openDatabase(":memory:");
    accountId = db
      .prepare(
        "INSERT INTO accounts (name, type) VALUES ('Checking', 'checking')",
      )
      .run().lastInsertRowid;
  });

  // Small helper so tests read clearly.
  function addTransaction({ amount, categoryId = null, account = accountId }) {
    return db
      .prepare(
        "INSERT INTO transactions (account_id, category_id, date, amount_cents) VALUES (?, ?, '2026-11-09', ?)",
      )
      .run(account, categoryId, amount);
  }

  function categoryId(name) {
    return db.prepare("SELECT id FROM categories WHERE name = ?").get(name).id;
  }

  it("seeds the default categories", () => {
    const { count } = db
      .prepare("SELECT COUNT(*) AS count FROM categories")
      .get();
    expect(count).toBe(10);
  });

  it("calculates an account balance from its transactions", () => {
    addTransaction({ amount: 200000 }); // opening balance: +$2,000.00
    addTransaction({ amount: -1250 }); //  coffee:          -$12.50

    const { balance } = db
      .prepare(
        "SELECT SUM(amount_cents) AS balance FROM transactions WHERE account_id = ?",
      )
      .get(accountId);

    expect(balance).toBe(198750); // $1,987.50
  });

  it("rejects an invalid account type", () => {
    expect(() =>
      db
        .prepare("INSERT INTO accounts (name, type) VALUES ('X', 'piggy_bank')")
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it("rejects a float amount (money must be integer cents)", () => {
    expect(() => addTransaction({ amount: 12.5 })).toThrow(
      /cannot store REAL value/,
    );
  });

  it("rejects a transaction for an account that does not exist", () => {
    expect(() => addTransaction({ amount: -100, account: 9999 })).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it("blocks deleting an account that still has transactions", () => {
    addTransaction({ amount: -100 });
    expect(() =>
      db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("uncategorizes transactions when their category is deleted", () => {
    const groceries = categoryId("Groceries");
    const { lastInsertRowid: txId } = addTransaction({
      amount: -5000,
      categoryId: groceries,
    });

    db.prepare("DELETE FROM categories WHERE id = ?").run(groceries);

    const tx = db
      .prepare("SELECT category_id FROM transactions WHERE id = ?")
      .get(txId);
    expect(tx.category_id).toBeNull(); // transaction survives, just uncategorized
  });

  it("treats category names as case-insensitive duplicates", () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO categories (name, kind) VALUES ('groceries', 'expense')",
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });
});
