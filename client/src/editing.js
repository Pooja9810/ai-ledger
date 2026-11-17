/**
 * Rules for editing and deleting a saved transaction (pure, easy to test).
 *
 * Three kinds of saved row:
 *   - normal:   an expense or income        → /api/transactions/:id
 *   - transfer: one half of a transfer      → /api/transfers/:id (both halves)
 *   - opening:  an account's Opening balance → amount and date only, never deleted
 */
import { centsToInput } from "./draft.js";
import {
  formatCents,
  formatSignedCents,
  parseDollarsToCents,
} from "./format.js";

/** "normal" | "transfer" | "opening" */
export function rowType(transaction) {
  if (transaction.transfer_id !== null && transaction.transfer_id !== undefined)
    return "transfer";
  if (transaction.category_kind === "transfer") return "opening";
  return "normal";
}

/** Can this row be deleted? (Undo can't re-create an opening balance.) */
export const canDelete = (transaction) => rowType(transaction) !== "opening";

/**
 * Form values for a saved row.
 * @param transaction  a row from GET /api/transactions
 * @param transfer     for a transfer half: GET /api/transfers/:id
 */
export function transactionToFields(transaction, transfer = null) {
  if (transfer) {
    return {
      kind: "transfer",
      amount: centsToInput(transfer.amount_cents),
      description: transfer.description ?? "",
      date: transfer.date,
      accountId: String(transfer.from_account_id),
      toAccountId: String(transfer.to_account_id),
      categoryId: "",
    };
  }
  return {
    kind: transaction.amount_cents < 0 ? "expense" : "income",
    amount: centsToInput(Math.abs(transaction.amount_cents)),
    description: transaction.description ?? "",
    date: transaction.date,
    accountId: String(transaction.account_id),
    toAccountId: "",
    categoryId:
      transaction.category_id === null ? "" : String(transaction.category_id),
  };
}

/**
 * The PATCH for an edit: only the fields that changed.
 * @param fields    current form values
 * @param original  the row being edited (and `transfer` for a transfer half)
 * @returns { path, body } or null when nothing changed
 */
export function editRequest(fields, original, transfer = null) {
  const cents = parseDollarsToCents(fields.amount);
  let path;
  let wanted;
  let before;

  if (transfer) {
    path = `/transfers/${transfer.id}`;
    wanted = {
      from_account_id: Number(fields.accountId),
      to_account_id: Number(fields.toAccountId),
      amount_cents: cents,
      date: fields.date,
      description: fields.description.trim(),
    };
    before = { ...transfer, description: transfer.description ?? "" };
  } else {
    path = `/transactions/${original.id}`;
    wanted = {
      account_id: Number(fields.accountId),
      date: fields.date,
      amount_cents: fields.kind === "expense" ? -cents : cents,
      description: fields.description.trim(),
    };
    // An opening balance keeps its system category.
    if (rowType(original) === "normal") {
      wanted.category_id = fields.categoryId ? Number(fields.categoryId) : null;
    }
    before = { ...original, description: original.description ?? "" };
  }

  const body = Object.fromEntries(
    Object.entries(wanted).filter(([key, value]) => before[key] !== value),
  );
  return Object.keys(body).length > 0 ? { path, body } : null;
}

/**
 * The request that puts a deleted row back (Undo). It gets a new id.
 * Known limitation: a transfer matched from two CSV rows comes back with
 * one shared description.
 */
export function undoRequest(transaction, transfer = null) {
  if (transfer) {
    return {
      path: "/transfers",
      body: {
        from_account_id: transfer.from_account_id,
        to_account_id: transfer.to_account_id,
        amount_cents: transfer.amount_cents,
        date: transfer.date,
        description: transfer.description ?? "",
      },
    };
  }
  return {
    path: "/transactions",
    body: {
      account_id: transaction.account_id,
      category_id: transaction.category_id,
      date: transaction.date,
      amount_cents: transaction.amount_cents,
      description: transaction.description ?? "",
    },
  };
}

/** "Tim Hortons · −$4.50", or "Transfer Chequing → Visa · $600.00". */
export function rowLabel(transaction, transfer = null) {
  if (transfer) {
    return `Transfer ${transfer.from_account_name} → ${transfer.to_account_name} · ${formatCents(transfer.amount_cents)}`;
  }
  const name =
    transaction.description?.trim() ||
    transaction.category_name ||
    "Transaction";
  return `${name} · ${formatSignedCents(transaction.amount_cents)}`;
}
