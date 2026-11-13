/**
 * Bulk import (e.g. from a bank CSV, parsed and normalized in the browser).
 * The server re-validates every row: never trust the client.
 *
 * All or nothing: if any row is invalid, nothing is imported; the inserts
 * run in one database transaction (BEGIN/COMMIT, see CLAUDE.md).
 */
import { isValidDate } from "./validation.js";
import { normalizeMerchant } from "./merchants.js";
import { transferCategoryId } from "./transfers.js";

export const MAX_IMPORT_ROWS = 2000;
const MAX_LISTED_ERRORS = 10;
const MAX_DESCRIPTION = 500;

/**
 * Check the request. Returns a list of error messages (empty = valid).
 * Row numbers are 1-based, as a person counts them.
 */
export function validateImport(db, body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return ["request body must be a JSON object"];
  }
  const { account_id, rows } = body;
  const errors = [];

  if (!Number.isInteger(account_id)) {
    errors.push("account_id must be an integer");
  } else if (
    !db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(account_id)
  ) {
    errors.push("account_id does not exist");
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return [...errors, "rows must be a non-empty list"];
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return [...errors, `at most ${MAX_IMPORT_ROWS} rows per import`];
  }

  const categoryKind = db.prepare("SELECT kind FROM categories WHERE id = ?");
  // A row may link to an existing transaction to form a transfer pair.
  const linkTarget = db.prepare(
    "SELECT account_id, amount_cents, transfer_id FROM transactions WHERE id = ?",
  );
  const linkedTo = new Set();
  const rowErrors = [];
  rows.forEach((row, i) => {
    const n = i + 1;
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      rowErrors.push(`row ${n}: must be an object`);
      return;
    }
    if (!isValidDate(row.date)) {
      rowErrors.push(`row ${n}: date must be a real date in YYYY-MM-DD format`);
    }
    if (!Number.isInteger(row.amount_cents) || row.amount_cents === 0) {
      rowErrors.push(
        `row ${n}: amount_cents must be a non-zero whole number of cents`,
      );
    }
    if (
      typeof row.description !== "string" ||
      row.description.length > MAX_DESCRIPTION
    ) {
      rowErrors.push(
        `row ${n}: description must be text of at most ${MAX_DESCRIPTION} characters`,
      );
    }
    if (row.category_id !== null && row.category_id !== undefined) {
      const kind = Number.isInteger(row.category_id)
        ? categoryKind.get(row.category_id)?.kind
        : undefined;
      if (!kind) rowErrors.push(`row ${n}: category_id does not exist`);
      else if (kind === "transfer") {
        rowErrors.push(`row ${n}: transfer categories can't be imported`);
      }
    }
    if (
      row.link_transaction_id !== undefined &&
      row.link_transaction_id !== null
    ) {
      const id = row.link_transaction_id;
      const target = Number.isInteger(id) ? linkTarget.get(id) : undefined;
      if (!target)
        rowErrors.push(`row ${n}: link_transaction_id does not exist`);
      else if (target.account_id === account_id) {
        rowErrors.push(`row ${n}: a transfer needs two different accounts`);
      } else if (target.amount_cents !== -row.amount_cents) {
        rowErrors.push(
          `row ${n}: the linked transaction must have the opposite amount`,
        );
      } else if (target.transfer_id !== null) {
        rowErrors.push(
          `row ${n}: that transaction is already part of a transfer`,
        );
      } else if (linkedTo.has(id)) {
        rowErrors.push(
          `row ${n}: that transaction is linked by another row too`,
        );
      }
      linkedTo.add(id);
    }
  });

  // List the first few; a 2,000-row file with a wrong date format would
  // otherwise produce 2,000 messages.
  const listed = rowErrors.slice(0, MAX_LISTED_ERRORS);
  if (rowErrors.length > MAX_LISTED_ERRORS) {
    listed.push(`…and ${rowErrors.length - MAX_LISTED_ERRORS} more row errors`);
  }
  return [...errors, ...listed];
}

/** Same date, same amount, same merchant (store numbers etc. ignored). */
const duplicateKey = (date, cents, description) =>
  `${date}|${cents}|${normalizeMerchant(description)}`;

/**
 * Insert valid rows, skipping ones already in the ledger. Call validateImport first.
 *
 * Duplicates are COUNTED, not just matched: if the ledger already has one
 * "Tim Hortons −$4.00 on Nov 9" and the file has two, one is skipped and one
 * imported (two coffees on the same day are real; overlapping exports aren't).
 *
 * A row with link_transaction_id becomes a transfer with that existing
 * transaction (from another account): both get the "Account transfer"
 * category and a shared transfer_id, inside the same database transaction.
 *
 * @returns { imported, skipped_duplicates, linked_transfers }
 */
export function importTransactions(db, { account_id, rows }) {
  const dates = rows.map((r) => r.date).sort();
  const existing = db
    .prepare(
      `SELECT date, amount_cents, description FROM transactions
       WHERE account_id = ? AND date BETWEEN ? AND ?`,
    )
    .all(account_id, dates[0], dates.at(-1));

  const alreadyThere = new Map(); // key → how many the ledger already has
  for (const t of existing) {
    const key = duplicateKey(t.date, t.amount_cents, t.description);
    alreadyThere.set(key, (alreadyThere.get(key) ?? 0) + 1);
  }

  const insert = db.prepare(
    `INSERT INTO transactions (account_id, category_id, date, amount_cents, description)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const transferCategory = transferCategoryId(db);
  const newTransfer = db.prepare("INSERT INTO transfers DEFAULT VALUES");
  const insertTransferHalf = db.prepare(
    `INSERT INTO transactions (account_id, category_id, date, amount_cents, description, transfer_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const makeTransferHalf = db.prepare(
    "UPDATE transactions SET category_id = ?, transfer_id = ? WHERE id = ?",
  );
  let imported = 0;
  let skipped = 0;
  let linked = 0;

  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const key = duplicateKey(row.date, row.amount_cents, row.description);
      const remaining = alreadyThere.get(key) ?? 0;
      if (remaining > 0) {
        alreadyThere.set(key, remaining - 1); // "use up" one existing match
        skipped += 1;
        continue;
      }
      if (row.link_transaction_id) {
        // The other half already exists: link the two as one transfer.
        const transferId = newTransfer.run().lastInsertRowid;
        makeTransferHalf.run(
          transferCategory,
          transferId,
          row.link_transaction_id,
        );
        insertTransferHalf.run(
          account_id,
          transferCategory,
          row.date,
          row.amount_cents,
          row.description.trim(),
          transferId,
        );
        linked += 1;
      } else {
        insert.run(
          account_id,
          row.category_id ?? null,
          row.date,
          row.amount_cents,
          row.description.trim(),
        );
      }
      imported += 1;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK"); // nothing half-imported
    throw err;
  }
  return { imported, skipped_duplicates: skipped, linked_transfers: linked };
}
