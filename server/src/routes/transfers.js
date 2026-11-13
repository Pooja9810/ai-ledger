import { Router } from "express";
import { isValidDate, parseId } from "../validation.js";
import { findTransferMatches } from "../transfer-matching.js";
import { MAX_IMPORT_ROWS } from "../import-transactions.js";
import {
  createTransfer,
  deleteTransfer,
  getTransfer,
  updateTransfer,
  validateTransfer,
} from "../transfers.js";

/** /api/transfers: money moving between the user's own accounts. */
export function transfersRouter(db) {
  const router = Router();
  const notFound = (res) =>
    res.status(404).json({ error: "Transfer not found" });

  // POST /api/transfers { from_account_id, to_account_id, amount_cents, date, description? }
  router.post("/", (req, res) => {
    const errors = validateTransfer(db, req.body);
    if (errors.length > 0) return res.status(400).json({ errors });
    res.status(201).json(createTransfer(db, req.body));
  });

  // POST /api/transfers/match { account_id, rows: [{ date, description, amount_cents }] }
  // → { matches: [...] }: likely transfer pairs for an import (suggestions only).
  router.post("/match", (req, res) => {
    const { account_id, rows } = req.body ?? {};
    const errors = [];
    if (!Number.isInteger(account_id))
      errors.push("account_id must be an integer");
    if (!Array.isArray(rows) || rows.length > MAX_IMPORT_ROWS) {
      errors.push(`rows must be a list of at most ${MAX_IMPORT_ROWS}`);
    } else if (
      rows.some(
        (r) =>
          r === null ||
          typeof r !== "object" ||
          !isValidDate(r.date) ||
          !Number.isInteger(r.amount_cents) ||
          typeof r.description !== "string",
      )
    ) {
      errors.push(
        "each row needs a real date, a whole amount_cents and a description",
      );
    }
    if (errors.length > 0) return res.status(400).json({ errors });
    res.json({ matches: findTransferMatches(db, { account_id, rows }) });
  });

  // GET /api/transfers/:id
  router.get("/:id", (req, res) => {
    const id = parseId(req.params.id);
    const transfer = id && getTransfer(db, id);
    if (!transfer) return notFound(res);
    res.json(transfer);
  });

  // PATCH /api/transfers/:id → update the sent fields; both halves stay in sync
  router.patch("/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id && getTransfer(db, id);
    if (!current) return notFound(res);

    const errors = validateTransfer(db, req.body, { partial: true, current });
    if (errors.length === 0 && Object.keys(req.body).length === 0) {
      errors.push("no fields to update");
    }
    if (errors.length > 0) return res.status(400).json({ errors });
    res.json(updateTransfer(db, current, req.body));
  });

  // DELETE /api/transfers/:id → removes both halves
  router.delete("/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id || !deleteTransfer(db, id)) return notFound(res);
    res.status(204).end();
  });

  return router;
}
