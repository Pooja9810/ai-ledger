/**
 * Rules for "✨ Fill": applying an AI draft from /api/ai/parse-transaction
 * to the Add Transaction form. Pure functions, so they're easy to test.
 */

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
