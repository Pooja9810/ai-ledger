-- Ledgerly database schema.
-- Conventions: money is integer cents; expenses negative, income positive;
-- dates are ISO 8601 text ('2026-11-09').
-- STRICT tables make SQLite reject values of the wrong type.
-- "IF NOT EXISTS" makes this file safe to run on every startup.

CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL
              CHECK (type IN ('checking', 'savings', 'credit_card', 'cash')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS categories (
  id    INTEGER PRIMARY KEY,
  name  TEXT    NOT NULL UNIQUE COLLATE NOCASE,  -- 'food' and 'Food' count as duplicates
  -- 'transfer' = money that's neither income nor spending (opening balances,
  -- moves between your own accounts). Reports and budgets ignore it.
  kind  TEXT    NOT NULL CHECK (kind IN ('expense', 'income', 'transfer'))
) STRICT;

-- A transfer moves money between two of the user's own accounts. It is
-- stored as TWO transactions (money out of one, into the other) that share a
-- transfer_id. This table just gives each pair an id; deleting the transfer
-- deletes both of its transactions (ON DELETE CASCADE below).
CREATE TABLE IF NOT EXISTS transfers (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id)   ON DELETE RESTRICT,
  category_id   INTEGER          REFERENCES categories(id) ON DELETE SET NULL,
  date          TEXT    NOT NULL,
  amount_cents  INTEGER NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  -- NULL for ordinary transactions; set on both halves of a transfer.
  transfer_id   INTEGER          REFERENCES transfers(id)  ON DELETE CASCADE
) STRICT;

-- Indexes speed up the lookups we'll do most: "transactions for account X"
-- and "transactions in date range".
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date    ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions(transfer_id);

CREATE TABLE IF NOT EXISTS budgets (
  id                   INTEGER PRIMARY KEY,
  category_id          INTEGER NOT NULL UNIQUE
                       REFERENCES categories(id) ON DELETE CASCADE,
  monthly_limit_cents  INTEGER NOT NULL CHECK (monthly_limit_cents > 0)
) STRICT;

-- Default categories. "OR IGNORE" skips ones that already exist.
INSERT OR IGNORE INTO categories (name, kind) VALUES
  ('Salary', 'income'),
  ('Other Income', 'income'),
  ('Groceries', 'expense'),
  ('Dining Out', 'expense'),
  ('Rent', 'expense'),
  ('Utilities', 'expense'),
  ('Transport', 'expense'),
  ('Shopping', 'expense'),
  ('Entertainment', 'expense'),
  ('Health', 'expense'),
  ('Opening balance', 'transfer'),
  ('Account transfer', 'transfer');  -- both halves of every transfer
