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
 * Build a lookup of the user's past categorizations, ONCE: for each
 * (kind, normalized merchant), the category of the most recent transaction.
 * Bulk import categorizes up to 2,000 rows; scanning the history for each
 * row would be 2,000 full scans. One scan + a Map makes each lookup instant.
 *
 * Only expense/income categories are indexed, never 'transfer'.
 * @returns { lookup({ description, amountCents }) → { id, name } | null }
 */
export function createHistoryIndex(db) {
  // Newest first: the first time we see a merchant is its latest category,
  // so the user's most recent correction wins.
  const rows = db
    .prepare(
      `SELECT t.description, c.id, c.name, c.kind
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE c.kind IN ('expense', 'income')
       ORDER BY t.date DESC, t.id DESC`,
    )
    .all();

  const latest = new Map(); // "expense|starbucks seattle wa" → { id, name }
  for (const row of rows) {
    const key = normalizeMerchant(row.description);
    if (key === "") continue;
    const mapKey = `${row.kind}|${key}`;
    if (!latest.has(mapKey)) latest.set(mapKey, { id: row.id, name: row.name });
  }

  return {
    lookup({ description, amountCents }) {
      const key = normalizeMerchant(description);
      if (key === "") return null;
      const kind = amountCents < 0 ? "expense" : "income";
      return latest.get(`${kind}|${key}`) ?? null;
    },
  };
}

/**
 * Find the category of the most recent past transaction from the same merchant.
 * Only reuses categories of the right kind for this amount (expense for
 * negative, income for positive), never 'transfer'.
 * @returns { id, name } or null
 */
export function findCategoryFromHistory(db, { description, amountCents }) {
  return createHistoryIndex(db).lookup({ description, amountCents });
}
