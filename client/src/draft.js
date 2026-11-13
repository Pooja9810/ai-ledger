/**
 * Rules for "✨ Fill": applying AI drafts from /api/ai/parse-transaction
 * to the Add Transaction form. One note can hold several transactions:
 * the first fills the form, the rest wait in a queue and fill in one by one
 * after each save. Pure functions, so they're easy to test.
 */
import { formatSignedCents } from "./format.js";
import { normalizeMerchant } from "./importer.js";

/** 1250 → "12.50", -1250 → "12.50" (the form shows the sign separately). Integer math only. */
export function centsToInput(cents) {
  const abs = Math.abs(cents);
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Which form fields should change? Only fields the AI actually found.
 * Returns an object with just the fields to set.
 *
 * @param draft            { kind, amount_cents, date, description, category }
 * @param currentKind      the form's current "expense" | "income"
 * @param currentCategoryId the select's current value ("" = Uncategorized)
 */
export function draftToFields(draft, { currentKind, currentCategoryId }) {
  const fields = { kind: draft.kind };
  if (draft.amount_cents) fields.amount = centsToInput(draft.amount_cents);
  if (draft.date) fields.date = draft.date;
  if (draft.description) fields.description = draft.description;

  if (draft.category) {
    fields.categoryId = String(draft.category.id);
  } else if (draft.kind !== currentKind && currentCategoryId !== "") {
    fields.categoryId = ""; // the old category belongs to the other kind
  }
  return fields;
}

/** A note about what the AI couldn't find, or null if it found the essentials. */
export function draftNote(draft) {
  if (!draft.amount_cents) return "Couldn't find an amount; enter it above";
  if (!draft.date) return "Couldn't tell the date; check it below";
  return null;
}

/** Turn a failed request into a message for the user. */
export function fillErrorMessage(error) {
  if (error?.status === 503) return "AI isn't set up on the server";
  if (error?.status === 400) return error.message;
  return "Couldn't reach the AI, try again";
}

/**
 * Describe the transactions still waiting, e.g.
 * "1 more: Five Guys −$15.00 · fills after you save"
 */
export function queueNote(queue) {
  if (queue.length === 0) return null;
  const items = queue
    .map((d) => {
      const name = d.description || "Transaction";
      return d.amount_cents
        ? `${name} ${formatSignedCents(d.amount_cents)}`
        : name;
    })
    .join(", ");
  const verb = queue.length === 1 ? "fills" : "fill one by one";
  return `${queue.length} more: ${items} · ${verb} after you save`;
}

/** Where should focus go after a fill? The first thing still needed. */
export function nextFocus({ hasAmount, hasAccount }) {
  if (!hasAmount) return "amount";
  if (!hasAccount) return "account";
  return "submit"; // everything's there: review and save
}

/**
 * Is this new transaction probably already in the ledger? Same date, same
 * amount and the same merchant after normalizing ("MAPLE LEAF MARKET #0412"
 * = "Maple Leaf Market"). Used to WARN, not block: two identical coffees
 * on the same day are real.
 * @param candidate  { date, amount_cents, description }
 * @param existing   transactions from the API for that date
 * @returns the matching transaction, or null
 */
export function findLikelyDuplicate(candidate, existing = []) {
  const merchant = normalizeMerchant(candidate.description ?? "");
  return (
    existing.find(
      (t) =>
        t.date === candidate.date &&
        t.amount_cents === candidate.amount_cents &&
        normalizeMerchant(t.description ?? "") === merchant,
    ) ?? null
  );
}
