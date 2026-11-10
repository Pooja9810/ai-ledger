import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

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

  db.exec(schemaSql);
  return db;
}
