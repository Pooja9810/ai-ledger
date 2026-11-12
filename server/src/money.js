// Money helpers. Money is always integer cents (see CLAUDE.md).

/**
 * '12.50' → 1250, '$1,200' → 120000, '7.5' → 750.
 * Returns null for anything that isn't a plain positive dollar amount
 * ('abc', '-5', '1.234'). Same rules as the client's parser in format.js.
 */
export function parseDollarsToCents(text) {
  const cleaned = String(text).trim().replace(/[$,]/g, "");
  const match = /^(\d*)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match || cleaned === "" || cleaned === ".") return null;
  const [, dollars, cents = ""] = match;
  return Number(dollars || "0") * 100 + Number(cents.padEnd(2, "0"));
}
