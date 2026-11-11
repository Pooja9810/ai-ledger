/**
 * Reuse the user's own past categorization for a merchant they've seen before.
 * Free and instant; the AI is only asked when this finds nothing.
 */

/**
 * Reduce a bank description to a comparable merchant key.
 * Lowercase; anything that isn't a letter (digits, #, *, ., /) becomes a space.
 *   "STARBUCKS #1234 SEATTLE WA" → "starbucks seattle wa"
 *   "UBER *EATS"                 → "uber eats"   (stays different from "uber trip")
 * Returns "" when nothing useful is left (e.g. "#1234").
 */
export function normalizeMerchant(description) {
  return description
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/**
 * Find the category of the most recent past transaction from the same merchant.
 * Only reuses categories of the right kind for this amount (expense for
 * negative, income for positive) — never 'transfer'.
 * @returns { id, name } or null
 */
export function findCategoryFromHistory(db, { description, amountCents }) {
  const key = normalizeMerchant(description);
  if (key === "") return null;

  const kind = amountCents < 0 ? "expense" : "income";
  // Newest first, so the user's latest correction wins.
  const rows = db
    .prepare(
      `SELECT t.description, c.id, c.name
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE c.kind = ?
       ORDER BY t.date DESC, t.id DESC`,
    )
    .all(kind);

  const match = rows.find((row) => normalizeMerchant(row.description) === key);
  return match ? { id: match.id, name: match.name } : null;
}
