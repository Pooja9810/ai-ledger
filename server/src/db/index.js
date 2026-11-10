import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { LATEST_VERSION, migrate } from "./migrations.js";

// Read schema.sql once, when this module is first imported.
// import.meta.url = the location of *this* file, so the path works
// no matter which folder the app is started from.
const schemaSql = readFileSync(
  new URL("./schema.sql", import.meta.url),
  "utf8",
);

/**
 * Open (or create) a database and make sure the schema exists.
 * @param {string} path - file path, or ':memory:' for a temporary in-memory DB (used in tests)
 */
export function openDatabase(path) {
  const db = new DatabaseSync(path);

  // Plain SQLite has foreign keys OFF by default. node:sqlite turns them on
  // already, but we set it explicitly so the requirement survives a driver change.
  db.exec("PRAGMA foreign_keys = ON;");

  const isNew = !db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'accounts'",
    )
    .get();

  if (isNew) {
    // Brand-new database: schema.sql is already the latest version.
    db.exec(schemaSql);
    db.exec(`PRAGMA user_version = ${LATEST_VERSION}`);
  } else {
    // Existing database: upgrade it FIRST, then re-apply schema.sql (safe to
    // repeat; it adds any missing default categories and indexes). The order
    // matters: schema.sql inserts a 'transfer' category that the old
    // CHECK rule would reject.
    migrate(db);
    db.exec(schemaSql);
  }
  return db;
}
