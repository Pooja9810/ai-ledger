/**
 * Rules for the Import dialog's category review: transactions are grouped
 * by merchant, so 300 rows become ~50 decisions. Pure functions, tested.
 */

/**
 * Same as the server's normalizeMerchant (server/src/merchants.js), so the
 * groups here match how history and the AI categorize:
 *   "TIM HORTONS #4521 TORONTO ON" → "tim hortons toronto on"
 */
export function normalizeMerchant(description) {
  return description
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

const kindOf = (cents) => (cents < 0 ? "expense" : "income");

/**
 * One group per (kind, merchant), most frequent first.
 * Descriptions with nothing to group on (e.g. "#1234") get their own group.
 * @returns [{ key, kind, label, count, totalCents, indexes }]
 */
export function groupByMerchant(transactions) {
  const groups = new Map();
  transactions.forEach((t, i) => {
    const kind = kindOf(t.amount_cents);
    const merchant = normalizeMerchant(t.description);
    const key = merchant ? `${kind}|${merchant}` : `${kind}|#${i}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        kind,
        label: t.description || "(no description)",
        count: 0,
        totalCents: 0,
        indexes: [],
      });
    }
    const group = groups.get(key);
    group.count += 1;
    group.totalCents += t.amount_cents;
    group.indexes.push(i);
  });
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}

/**
 * Pre-fill each group's dropdown from the server's suggestions (one per
 * transaction, same order). The first suggested category in a group wins.
 * @returns { [groupKey]: { categoryId: string, source: "history"|"ai"|null } }
 *          categoryId is "" for Uncategorized (like a <select> value)
 */
export function initialChoices(groups, suggestions = []) {
  const choices = {};
  for (const group of groups) {
    const hit = group.indexes
      .map((i) => suggestions[i])
      .find((s) => s?.category);
    choices[group.key] = hit
      ? { categoryId: String(hit.category.id), source: hit.source }
      : { categoryId: "", source: null };
  }
  return choices;
}

/** The rows to send to POST /api/transactions/import, in file order. */
export function buildImportRows(transactions, groups, choices) {
  const categoryOf = new Array(transactions.length).fill(null);
  for (const group of groups) {
    const id = choices[group.key]?.categoryId;
    for (const i of group.indexes) categoryOf[i] = id ? Number(id) : null;
  }
  return transactions.map((t, i) => ({
    date: t.date,
    description: t.description,
    amount_cents: t.amount_cents,
    category_id: categoryOf[i],
  }));
}

/** A note explaining missing suggestions, or null when all went well. */
export function aiStatusNote(status) {
  switch (status) {
    case "unavailable":
      return "AI isn't set up, so only merchants you've categorized before were filled in.";
    case "partial":
      return "Some suggestions couldn't be loaded; pick categories for the rest.";
    case "failed":
      return "Couldn't reach the AI; only merchants you've categorized before were filled in.";
    default:
      return null; // "used" or "not_needed"
  }
}

/** Toast text after an import. */
export function importSummary({ imported, skipped_duplicates: skipped }) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts = [`Imported ${plural(imported, "transaction")}`];
  if (skipped > 0) parts.push(`${plural(skipped, "duplicate")} skipped`);
  return parts.join(" · ");
}
