import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate, LATEST_VERSION } from "../src/db/migrations.js";

// FROZEN snapshot of the schema as it was at version 0. Never update this:
// it represents databases that already exist out in the world.
const SCHEMA_V0 = `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit_card', 'cash')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  ) STRICT;
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind TEXT NOT NULL CHECK (kind IN ('expense', 'income'))
  ) STRICT;
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    date TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  ) STRICT;
  CREATE TABLE budgets (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id) ON DELETE CASCADE,
    monthly_limit_cents INTEGER NOT NULL CHECK (monthly_limit_cents > 0)
  ) STRICT;
  INSERT INTO categories (name, kind) VALUES
    ('Salary', 'income'), ('Groceries', 'expense'), ('Dining Out', 'expense');
  INSERT INTO accounts (name, type) VALUES ('Checking', 'checking');
  INSERT INTO transactions (account_id, category_id, date, amount_cents, description) VALUES
    (1, NULL, '2026-10-01', 200000, 'Opening balance'),
    (1, 1,    '2026-10-15', 400000, 'Payroll'),
    (1, 2,    '2026-10-20',  -8000, 'Groceries run'),
    (1, NULL, '2026-10-21',  -1899, 'SQ *CORNER BAKERY');
  INSERT INTO budgets (category_id, monthly_limit_cents) VALUES (2, 40000), (3, 20000);
`;

describe("migrations", () => {
  let db;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA_V0); // user_version is 0, like a pre-migration database
  });

  const all = (sql) =>
    db
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));

  it("upgrades a v0 database to the latest version", () => {
    migrate(db);
    expect(db.prepare("PRAGMA user_version").get().user_version).toBe(
      LATEST_VERSION,
    );
  });

  it("keeps every budget (the CASCADE trap)", () => {
    migrate(db);
    expect(all("SELECT category_id, monthly_limit_cents FROM budgets")).toEqual(
      [
        { category_id: 2, monthly_limit_cents: 40000 },
        { category_id: 3, monthly_limit_cents: 20000 },
      ],
    );
  });

  it("keeps every category id, so existing links still point to the same rows", () => {
    const before = all("SELECT id, name, kind FROM categories");
    migrate(db);
    expect(
      all("SELECT id, name, kind FROM categories WHERE kind != 'transfer'"),
    ).toEqual(before);
  });

  it("categorizes opening balances as a transfer, and nothing else", () => {
    migrate(db);
    const rows = all(`
      SELECT t.description, c.name AS category, c.kind
      FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
      ORDER BY t.id`);
    expect(rows).toEqual([
      {
        description: "Opening balance",
        category: "Opening balance",
        kind: "transfer",
      },
      { description: "Payroll", category: "Salary", kind: "income" },
      { description: "Groceries run", category: "Groceries", kind: "expense" },
      { description: "SQ *CORNER BAKERY", category: null, kind: null }, // still needs a category
    ]);
  });

  it("leaves the database with no broken links and foreign keys back on", () => {
    migrate(db);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get().foreign_keys).toBe(1);
  });

  it("is safe to run twice (the second run does nothing)", () => {
    migrate(db);
    const snapshot = all("SELECT * FROM categories");
    migrate(db);
    expect(all("SELECT * FROM categories")).toEqual(snapshot);
  });

  it("rolls back completely if a migration fails", () => {
    // Sabotage: without a transactions table, the migration's UPDATE fails
    // AFTER the categories table has already been rebuilt, mid-migration.
    db.exec("DROP TABLE transactions");
    expect(() => migrate(db)).toThrow(/Migration ".*" failed/);
    expect(db.prepare("PRAGMA user_version").get().user_version).toBe(0);
    // The old categories table is untouched (still has the old CHECK rule).
    expect(() =>
      db.exec("INSERT INTO categories (name, kind) VALUES ('X', 'transfer')"),
    ).toThrow(/CHECK constraint failed/);
  });
});
