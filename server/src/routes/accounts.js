import { Router } from "express";
import { parseId } from "../validation.js";
import { today } from "../dates.js";

const ACCOUNT_TYPES = ["checking", "savings", "credit_card", "cash"];

/**
 * Check a new-account request body. Returns a list of error messages
 * (empty list = valid). We collect ALL errors so the user can fix them at once.
 */
function validateNewAccount(body) {
  const errors = [];
  const { name, type, opening_balance_cents = 0 } = body ?? {};

  if (typeof name !== "string" || name.trim() === "") {
    errors.push("name is required");
  }
  if (!ACCOUNT_TYPES.includes(type)) {
    errors.push(`type must be one of: ${ACCOUNT_TYPES.join(", ")}`);
  }
  if (!Number.isInteger(opening_balance_cents)) {
    errors.push("opening_balance_cents must be a whole number of cents");
  }
  return errors;
}

export function accountsRouter(db) {
  const router = Router();

  // LEFT JOIN keeps accounts that have NO transactions yet (a plain JOIN would drop them).
  // COALESCE turns the NULL sum of "no rows" into 0.
  // The balance is calculated here, never stored — our single source of truth.
  const selectWithBalance = `
    SELECT a.id, a.name, a.type, a.created_at,
           COALESCE(SUM(t.amount_cents), 0) AS balance_cents
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id`;

  // Prepared statements: SQL is compiled once, values are passed separately with "?".
  // Passing values separately is also what prevents SQL injection.
  const listAccounts = db.prepare(
    `${selectWithBalance} GROUP BY a.id ORDER BY a.id`,
  );
  const getAccount = db.prepare(
    `${selectWithBalance} WHERE a.id = ? GROUP BY a.id`,
  );
  const insertAccount = db.prepare(
    "INSERT INTO accounts (name, type) VALUES (?, ?)",
  );
  const insertOpeningBalance = db.prepare(
    `INSERT INTO transactions (account_id, category_id, date, amount_cents, description)
     VALUES (?, (SELECT id FROM categories WHERE name = 'Opening balance' AND kind = 'transfer'),
             ?, ?, 'Opening balance')`,
  );

  // GET /api/accounts → all accounts with balances
  router.get("/", (req, res) => {
    res.json(listAccounts.all());
  });

  // GET /api/accounts/:id → one account, or 404
  router.get("/:id", (req, res) => {
    const account = getAccount.get(parseId(req.params.id));
    if (!account) return res.status(404).json({ error: "Account not found" });
    res.json(account);
  });

  // POST /api/accounts → create an account (+ optional opening balance)
  router.post("/", (req, res) => {
    const errors = validateNewAccount(req.body);
    if (errors.length > 0) return res.status(400).json({ errors });

    const { name, type, opening_balance_cents = 0 } = req.body;

    // A database TRANSACTION makes both inserts "all or nothing":
    // we never end up with an account that's missing its opening balance.
    let id;
    db.exec("BEGIN");
    try {
      id = insertAccount.run(name.trim(), type).lastInsertRowid;
      if (opening_balance_cents !== 0) {
        insertOpeningBalance.run(id, today(), opening_balance_cents);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err; // the error handler in app.js turns this into a 500
    }

    res.status(201).json(getAccount.get(id));
  });

  return router;
}
