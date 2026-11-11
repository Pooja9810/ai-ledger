/**
 * Rules for the category suggestion in the Add Transaction form.
 * Pure functions (no React, no fetch) so they're easy to test.
 */

/**
 * Should we ask the server for a suggestion when the description field loses focus?
 * Returns a "request key" to ask with, or null to skip.
 * The key lets us skip repeat calls (same description + same sign as last time)
 * and ignore stale answers that arrive after the user changed something.
 */
export function suggestionRequestKey({ description, signedCents, lastKey }) {
  const text = description.trim();
  if (text === "" || !signedCents) return null; // nothing to categorize yet
  const key = `${signedCents < 0 ? "-" : "+"}|${text.toLowerCase()}`;
  return key === lastKey ? null : key;
}

/**
 * Which category should the form show after a suggestion arrives?
 * Never overwrites a category the USER picked; may replace one that an
 * earlier suggestion filled in (the description changed since then).
 *
 * @param currentId     the select's current value ("" = Uncategorized)
 * @param autoFilledId  value the previous suggestion filled in, or null
 * @param suggestion    { id, name } from the server, or null
 * @returns the new select value (a string, like the <select> uses)
 */
export function nextCategoryId({ currentId, autoFilledId, suggestion }) {
  const userChose = currentId !== "" && currentId !== autoFilledId;
  if (userChose) return currentId;
  return suggestion ? String(suggestion.id) : "";
}

/** The hint text under the category field, with its icon. */
export function suggestionLabel(source) {
  return source === "history"
    ? "✨ Suggested from your past transactions"
    : "✨ Suggested by AI";
}
