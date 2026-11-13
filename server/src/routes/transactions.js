import { Router } from "express";
import { isValidDate, parseId } from "../validation.js";
import { importTransactions, validateImport } from "../import-transactions.js";

// The ONLY fields a client may send. Also used as a whitelist of column names in PATCH.
const EDITABLE_FIELDS = [
  "account_id",
  "category_id",
  "date",
  "amount_cents",
  "description",
];

export function transactionsRouter(db) {
  const router = Router();

  // Every response includes the account and category NAMES, so the frontend
  // doesn't need extra requests. LEFT JOIN on categories keeps uncategorized rows.
  const selectTransactions = `
    SELECT t.id, t.account_id, a.name AS account_name,
           t.category_id, c.name AS category_name, c.kind AS category_kind,
           t.date, t.amount_cents, t.description, t.created_at, t.transfer_id
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id`;

  const getTransaction = db.prepare(`${selectTransactions} WHERE t.id = ?`);
  const accountExists = db.prepare("SELECT 1 FROM accounts WHERE id = ?");
  const categoryKind = db.prepare("SELECT kind FROM categories WHERE id = ?");
  const insertTransaction = db.prepare(`
    INSERT INTO transactions (account_id, category_id, date, amount_cents, description)
    VALUES (?, ?, ?, ?, ?)`);

  /**
   * Validate a request body. With partial = true (for PATCH), only the fields
   * that are present get checked; otherwise the required ones must exist.
   */
  function validate(body, { partial = false } = {}) {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return ["request body must be a JSON object"];
    }
    const errors = [];
    const has = (field) => body[field] !== undefined;
    const check = (field) => !partial || has(field); // "should we validate this field?"

    for (const field of Object.keys(body)) {
      if (!EDITABLE_FIELDS.includes(field))
        errors.push(`unknown field: ${field}`);
    }

    if (check("account_id")) {
      if (!Number.isInteger(body.account_id))
        errors.push("account_id must be an integer");
      else if (!accountExists.get(body.account_id))
        errors.push("account_id does not exist");
    }
    // category_id is optional; null means "uncategorized".
    if (has("category_id") && body.category_id !== null) {
      if (!Number.isInteger(body.category_id))
        errors.push("category_id must be an integer or null");
      else {
        const kind = categoryKind.get(body.category_id)?.kind;
        if (!kind) errors.push("category_id does not exist");
        // Transfer categories are system-only: opening balances are made with
        // the account, transfers with /api/transfers (which keeps both halves).
        else if (kind === "transfer")
          errors.push(
            "transfer categories can't be set directly; use /api/transfers",
          );
      }
    }
    if (check("date") && !isValidDate(body.date)) {
      errors.push("date must be a real date in YYYY-MM-DD format");
    }
    if (
      check("amount_cents") &&
      (!Number.isInteger(body.amount_cents) || body.amount_cents === 0)
    ) {
      errors.push("amount_cents must be a non-zero whole number of cents");
    }
    if (has("description") && typeof body.description !== "string") {
      errors.push("description must be a string");
    }
    return errors;
  }

  // GET /api/transactions?account_id=1&category_id=3&from=2026-11-01&to=2026-11-30&uncategorized=true
  router.get("/", (req, res) => {
    const { account_id, category_id, from, to, uncategorized } = req.query;
    const conditions = [];
    const params = [];
    const errors = [];

    // Each filter adds a "?" placeholder + its value. User input never goes into the SQL text.
    if (account_id !== undefined) {
      const id = parseId(account_id);
      if (id === null) errors.push("account_id must be a positive integer");
      conditions.push("t.account_id = ?");
      params.push(id);
    }
    if (category_id !== undefined) {
      const id = parseId(category_id);
      if (id === null) errors.push("category_id must be a positive integer");
      conditions.push("t.category_id = ?");
      params.push(id);
    }
    if (from !== undefined) {
      if (!isValidDate(from))
        errors.push("from must be a date in YYYY-MM-DD format");
      conditions.push("t.date >= ?");
      params.push(from);
    }
    if (to !== undefined) {
      if (!isValidDate(to))
        errors.push("to must be a date in YYYY-MM-DD format");
      conditions.push("t.date <= ?");
      params.push(to);
    }
    if (uncategorized === "true") conditions.push("t.category_id IS NULL");

    if (errors.length > 0) return res.status(400).json({ errors });

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db
      .prepare(`${selectTransactions} ${where} ORDER BY t.date DESC, t.id DESC`)
      .all(...params);
    res.json(rows);
  });

  // POST /api/transactions/import  { account_id, rows: [{ date, description, amount_cents, category_id }] }
  // → 201 { imported, skipped_duplicates }. All or nothing: any invalid row → 400, nothing saved.
  router.post("/import", (req, res) => {
    const errors = validateImport(db, req.body);
    if (errors.length > 0) return res.status(400).json({ errors });
    res.status(201).json(importTransactions(db, req.body));
  });

  // GET /api/transactions/:id
  router.get("/:id", (req, res) => {
    const transaction = getTransaction.get(parseId(req.params.id));
    if (!transaction)
      return res.status(404).json({ error: "Transaction not found" });
    res.json(transaction);
  });

  // POST /api/transactions
  router.post("/", (req, res) => {
    const errors = validate(req.body);
    if (errors.length > 0) return res.status(400).json({ errors });

    const {
      account_id,
      category_id = null,
      date,
      amount_cents,
      description = "",
    } = req.body;
    const { lastInsertRowid } = insertTransaction.run(
      account_id,
      category_id,
      date,
      amount_cents,
      description.trim(),
    );
    res.status(201).json(getTransaction.get(lastInsertRowid));
  });

  // Half of a transfer can't be changed on its own: that would leave the
  // other half out of sync. 409 Conflict points to the transfer instead.
  const partOfTransfer = (res, transaction) =>
    res.status(409).json({
      error: `This is part of transfer #${transaction.transfer_id}; change it with /api/transfers/${transaction.transfer_id}`,
    });

  // PATCH /api/transactions/:id → update only the fields that were sent
  router.patch("/:id", (req, res) => {
    const id = parseId(req.params.id);
    const existing = getTransaction.get(id);
    if (!existing)
      return res.status(404).json({ error: "Transaction not found" });
    if (existing.transfer_id !== null) return partOfTransfer(res, existing);

    const errors = validate(req.body, { partial: true });
    const fields = EDITABLE_FIELDS.filter(
      (field) => req.body?.[field] !== undefined,
    );
    if (errors.length === 0 && fields.length === 0)
      errors.push("no fields to update");
    if (errors.length > 0) return res.status(400).json({ errors });

    // SECURITY: column names come from OUR whitelist (EDITABLE_FIELDS), never from
    // the request. Values still go through "?" placeholders.
    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = fields.map((field) =>
      field === "description" ? req.body[field].trim() : req.body[field],
    );
    db.prepare(`UPDATE transactions SET ${setClause} WHERE id = ?`).run(
      ...values,
      id,
    );

    res.json(getTransaction.get(id));
  });

  router.delete("/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: "Transaction not found" });
    const existing = getTransaction.get(id);
    if (existing && existing.transfer_id !== null)
      return partOfTransfer(res, existing);

    const result = db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
    if (result.changes === 0)
      return res.status(404).json({ error: "Transaction not found" });
    res.status(204).end();
  });

  return router;
}
