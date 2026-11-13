/**
 * Transfers: money moving between two of the user's own accounts (paying a
 * credit card, saving, withdrawing cash). Not spending, not income.
 *
 * Stored as TWO transactions sharing a transfer_id (see schema.sql):
 *   from account: −amount   to account: +amount   category: "Account transfer"
 * The 'transfer' category kind keeps both halves out of spending, income,
 * budgets and the AI tools; each account's balance still comes out right.
 *
 * Every write touches both halves inside one database transaction, so a
 * transfer is never left half-changed.
 */
import { isValidDate } from "./validation.js";

const FIELDS = [
  "from_account_id",
  "to_account_id",
  "amount_cents",
  "date",
  "description",
];
const MAX_DESCRIPTION = 500;

/** The system category both halves use. */
export function transferCategoryId(db) {
  return db
    .prepare(
      "SELECT id FROM categories WHERE name = 'Account transfer' AND kind = 'transfer'",
    )
    .get().id;
}

/**
 * Check a request body. partial = true for PATCH (only sent fields are
 * checked). `current` (for PATCH) supplies the values that weren't sent, so
 * "from and to must differ" is checked against the final result.
 * @returns a list of error messages (empty = valid)
 */
export function validateTransfer(
  db,
  body,
  { partial = false, current = null } = {},
) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return ["request body must be a JSON object"];
  }
  const errors = [];
  for (const field of Object.keys(body)) {
    if (!FIELDS.includes(field)) errors.push(`unknown field: ${field}`);
  }
  const check = (field) => !partial || body[field] !== undefined;
  const accountExists = db.prepare("SELECT 1 FROM accounts WHERE id = ?");

  for (const field of ["from_account_id", "to_account_id"]) {
    if (!check(field)) continue;
    if (!Number.isInteger(body[field]))
      errors.push(`${field} must be an integer`);
    else if (!accountExists.get(body[field]))
      errors.push(`${field} does not exist`);
  }
  const from = body.from_account_id ?? current?.from_account_id;
  const to = body.to_account_id ?? current?.to_account_id;
  if (from !== undefined && from === to) {
    errors.push("from and to must be different accounts");
  }
  if (
    check("amount_cents") &&
    (!Number.isInteger(body.amount_cents) || body.amount_cents <= 0)
  ) {
    errors.push(
      "amount_cents must be a positive whole number of cents (the amount moved)",
    );
  }
  if (check("date") && !isValidDate(body.date)) {
    errors.push("date must be a real date in YYYY-MM-DD format");
  }
  if (
    body.description !== undefined &&
    (typeof body.description !== "string" ||
      body.description.length > MAX_DESCRIPTION)
  ) {
    errors.push(
      `description must be text of at most ${MAX_DESCRIPTION} characters`,
    );
  }
  return errors;
}

/** One transfer with both accounts, or null if it doesn't exist. */
export function getTransfer(db, id) {
  const legs = db
    .prepare(
      `SELECT t.id, t.account_id, a.name AS account_name, t.date, t.amount_cents, t.description
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.transfer_id = ?`,
    )
    .all(id);
  const out = legs.find((l) => l.amount_cents < 0);
  const into = legs.find((l) => l.amount_cents > 0);
  if (!out || !into) return null;
  return {
    id,
    date: out.date,
    amount_cents: into.amount_cents,
    description: out.description,
    from_account_id: out.account_id,
    from_account_name: out.account_name,
    to_account_id: into.account_id,
    to_account_name: into.account_name,
    transaction_ids: { from: out.id, to: into.id },
  };
}

const accountName = (db, id) =>
  db.prepare("SELECT name FROM accounts WHERE id = ?").get(id).name;

/** Create a transfer and both halves. Call validateTransfer first. */
export function createTransfer(
  db,
  { from_account_id, to_account_id, amount_cents, date, description },
) {
  const text =
    description?.trim() ||
    `Transfer: ${accountName(db, from_account_id)} → ${accountName(db, to_account_id)}`;
  const category = transferCategoryId(db);
  const insertLeg = db.prepare(
    `INSERT INTO transactions (account_id, category_id, date, amount_cents, description, transfer_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  let id;
  db.exec("BEGIN");
  try {
    id = db
      .prepare("INSERT INTO transfers DEFAULT VALUES")
      .run().lastInsertRowid;
    insertLeg.run(from_account_id, category, date, -amount_cents, text, id); // money out
    insertLeg.run(to_account_id, category, date, amount_cents, text, id); // money in
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK"); // never half a transfer
    throw err;
  }
  return getTransfer(db, Number(id));
}

/** Change a transfer, keeping both halves consistent. Call validateTransfer first. */
export function updateTransfer(db, current, changes) {
  const next = { ...current, ...changes };
  const text =
    changes.description !== undefined
      ? changes.description.trim()
      : current.description;
  const update = db.prepare(
    "UPDATE transactions SET account_id = ?, date = ?, amount_cents = ?, description = ? WHERE id = ?",
  );
  db.exec("BEGIN");
  try {
    update.run(
      next.from_account_id,
      next.date,
      -next.amount_cents,
      text,
      current.transaction_ids.from,
    );
    update.run(
      next.to_account_id,
      next.date,
      next.amount_cents,
      text,
      current.transaction_ids.to,
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return getTransfer(db, current.id);
}

/** Delete a transfer; ON DELETE CASCADE removes both halves. @returns true if it existed */
export function deleteTransfer(db, id) {
  return db.prepare("DELETE FROM transfers WHERE id = ?").run(id).changes > 0;
}
