// Schema migrations: upgrade EXISTING databases one version at a time.
//
// The database remembers its version in SQLite's built-in `PRAGMA user_version`
// (0 for databases created before migrations existed). Each entry below
// upgrades from version N to N+1. Never edit a migration that has already run
// somewhere; add a new one instead.

export const MIGRATIONS = [
  {
    // v0 → v1
    name: "Add the 'transfer' category kind and categorize opening balances",
    up(db) {
      // SQLite can't change a CHECK rule in place, so the table is rebuilt:
      // create new → copy rows → drop old → rename (SQLite's documented method).
      //
      // ⚠️ Foreign keys MUST be off during the rebuild. Dropping `categories`
      // with them on would trigger ON DELETE actions: every budget would be
      // deleted (CASCADE) and every transaction uncategorized (SET NULL).
      db.exec(`
        CREATE TABLE categories_new (
          id    INTEGER PRIMARY KEY,
          name  TEXT    NOT NULL UNIQUE COLLATE NOCASE,
          kind  TEXT    NOT NULL CHECK (kind IN ('expense', 'income', 'transfer'))
        ) STRICT;

        INSERT INTO categories_new (id, name, kind)
          SELECT id, name, kind FROM categories;     -- same ids, so links survive

        DROP TABLE categories;
        ALTER TABLE categories_new RENAME TO categories;

        INSERT OR IGNORE INTO categories (name, kind)
          VALUES ('Opening balance', 'transfer');

        -- One-time data fix: existing opening balances were stored uncategorized.
        UPDATE transactions
           SET category_id = (SELECT id FROM categories WHERE name = 'Opening balance')
         WHERE category_id IS NULL
           AND description = 'Opening balance';
      `);
    },
  },
  {
    // v1 → v2
    name: "Add transfers between accounts",
    up(db) {
      // Only ADDS things (a table, a nullable column, an index, a category),
      // so no table rebuild is needed and existing rows are untouched:
      // they get transfer_id = NULL, meaning "not part of a transfer".
      // SQLite allows ADD COLUMN with REFERENCES as long as the default is NULL.
      db.exec(`
        CREATE TABLE transfers (
          id          INTEGER PRIMARY KEY,
          created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        ) STRICT;

        ALTER TABLE transactions
          ADD COLUMN transfer_id INTEGER REFERENCES transfers(id) ON DELETE CASCADE;

        CREATE INDEX idx_transactions_transfer ON transactions(transfer_id);

        INSERT OR IGNORE INTO categories (name, kind)
          VALUES ('Account transfer', 'transfer');
      `);
    },
  },
];

export const LATEST_VERSION = MIGRATIONS.length;

/**
 * Bring a database up to LATEST_VERSION. Each migration runs inside a
 * database transaction: it either fully succeeds, or nothing changes.
 */
export function migrate(db) {
  let version = db.prepare("PRAGMA user_version").get().user_version;

  while (version < LATEST_VERSION) {
    const migration = MIGRATIONS[version];
    // PRAGMA foreign_keys can't be changed inside a transaction, so: off first.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      migration.up(db);

      // Before committing, prove no link points at a row that doesn't exist.
      const broken = db.prepare("PRAGMA foreign_key_check").all();
      if (broken.length > 0) {
        throw new Error(
          `Migration ${version + 1} would break ${broken.length} foreign key(s)`,
        );
      }

      // Safe to interpolate: it's our own integer, never user input.
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Migration "${migration.name}" failed: ${err.message}`, {
        cause: err,
      });
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    version += 1;
  }
}
