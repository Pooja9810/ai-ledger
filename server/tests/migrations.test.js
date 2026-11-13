import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, LATEST_VERSION } from "../src/db/migrations.js";
import { openDatabase } from "../src/db/index.js";

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

// FROZEN snapshot of the schema at version 1 (before transfers). Never update
// this: it represents databases that already exist, like ledger.db and demo.db
// on 2026-11-13.
const SCHEMA_V1 = `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit_card', 'cash')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  ) STRICT;
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer'))
  ) STRICT;
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    date TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  ) STRICT;
  CREATE INDEX idx_transactions_account ON transactions(account_id);
  CREATE INDEX idx_transactions_date ON transactions(date);
  CREATE TABLE budgets (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id) ON DELETE CASCADE,
    monthly_limit_cents INTEGER NOT NULL CHECK (monthly_limit_cents > 0)
  ) STRICT;
  INSERT INTO categories (name, kind) VALUES
    ('Salary', 'income'), ('Groceries', 'expense'), ('Opening balance', 'transfer');
  INSERT INTO accounts (name, type) VALUES ('Checking', 'checking'), ('Visa', 'credit_card');
  INSERT INTO transactions (account_id, category_id, date, amount_cents, description) VALUES
    (1, 3, '2026-10-01', 200000, 'Opening balance'),
    (1, 1, '2026-10-15', 400000, 'Payroll'),
    (2, 2, '2026-10-20',  -8000, 'Groceries run'),
    (1, NULL, '2026-10-21', -5000, 'VISA PAYMENT');
  INSERT INTO budgets (category_id, monthly_limit_cents) VALUES (2, 40000);
  PRAGMA user_version = 1;
`;

describe("migration 2: transfers between accounts (from a v1 database)", () => {
  let db;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA_V1);
  });
  const all = (sql) =>
    db
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));
  const columns = (target, table) =>
    target
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => `${c.name} ${c.type}${c.notnull ? " NOT NULL" : ""}`);

  it("upgrades v1 to the latest version", () => {
    migrate(db);
    expect(db.prepare("PRAGMA user_version").get().user_version).toBe(
      LATEST_VERSION,
    );
  });

  it("keeps every transaction unchanged, as 'not a transfer'", () => {
    const before = all(
      "SELECT id, account_id, category_id, date, amount_cents, description FROM transactions",
    );
    migrate(db);
    expect(
      all(
        "SELECT id, account_id, category_id, date, amount_cents, description FROM transactions",
      ),
    ).toEqual(before);
    expect(all("SELECT DISTINCT transfer_id FROM transactions")).toEqual([
      { transfer_id: null },
    ]);
  });

  it("keeps budgets and category ids, and adds the 'Account transfer' category", () => {
    migrate(db);
    expect(all("SELECT category_id, monthly_limit_cents FROM budgets")).toEqual(
      [{ category_id: 2, monthly_limit_cents: 40000 }],
    );
    expect(all("SELECT id, name, kind FROM categories ORDER BY id")).toEqual([
      { id: 1, name: "Salary", kind: "income" },
      { id: 2, name: "Groceries", kind: "expense" },
      { id: 3, name: "Opening balance", kind: "transfer" },
      { id: 4, name: "Account transfer", kind: "transfer" },
    ]);
  });

  it("deleting a transfer deletes BOTH of its transactions (cascade)", () => {
    migrate(db);
    const transferId = db
      .prepare("INSERT INTO transfers DEFAULT VALUES")
      .run().lastInsertRowid;
    const leg = db.prepare(
      `INSERT INTO transactions (account_id, category_id, date, amount_cents, description, transfer_id)
       VALUES (?, 4, '2026-11-15', ?, 'Visa payment', ?)`,
    );
    leg.run(1, -5000, transferId);
    leg.run(2, 5000, transferId);
    expect(all("SELECT COUNT(*) AS n FROM transactions")).toEqual([{ n: 6 }]);

    db.prepare("DELETE FROM transfers WHERE id = ?").run(transferId);

    expect(all("SELECT COUNT(*) AS n FROM transactions")).toEqual([{ n: 4 }]);
    expect(
      all(
        "SELECT COUNT(*) AS n FROM transactions WHERE transfer_id IS NOT NULL",
      ),
    ).toEqual([{ n: 0 }]);
  });

  it("rejects a transfer_id that doesn't exist", () => {
    migrate(db);
    expect(() =>
      db.exec("UPDATE transactions SET transfer_id = 999 WHERE id = 1"),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("ends with exactly the same structure as a brand-new database", () => {
    migrate(db);
    db.exec(
      readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"),
    );
    const fresh = openDatabase(":memory:");
    for (const table of [
      "transactions",
      "transfers",
      "categories",
      "budgets",
    ]) {
      expect(columns(db, table)).toEqual(columns(fresh, table));
    }
    const fks = (target) =>
      target
        .prepare("PRAGMA foreign_key_list(transactions)")
        .all()
        .map(
          (fk) =>
            `${fk.from} → ${fk.table}(${fk.to}) ON DELETE ${fk.on_delete}`,
        )
        .sort();
    expect(fks(db)).toEqual(fks(fresh));
    const indexes = (target) =>
      target
        .prepare("PRAGMA index_list(transactions)")
        .all()
        .map((i) => i.name)
        .filter((n) => n.startsWith("idx_"))
        .sort();
    expect(indexes(db)).toEqual(indexes(fresh));
  });

  it("upgrades a real v1 database FILE through openDatabase (what server start does)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledgerly-"));
    const path = join(dir, "v1.db");
    const file = new DatabaseSync(path);
    file.exec(SCHEMA_V1);
    file.close();

    const upgraded = openDatabase(path);
    expect(upgraded.prepare("PRAGMA user_version").get().user_version).toBe(
      LATEST_VERSION,
    );
    expect(columns(upgraded, "transactions")).toContain("transfer_id INTEGER");
    expect(
      upgraded.prepare("SELECT COUNT(*) AS n FROM transactions").get().n,
    ).toBe(4);
    upgraded.close();
    rmSync(dir, { recursive: true });
  });
});
