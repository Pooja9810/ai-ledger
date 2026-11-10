// Small, reusable input checks shared by the routers.

/**
 * True only for a REAL calendar date in 'YYYY-MM-DD' form.
 * The regex checks the shape; the round-trip through Date catches
 * impossible dates like '2026-02-30' (which Date would roll into March).
 */
export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Turn a URL value like '42' into the number 42.
 * Returns null for anything that isn't a positive whole number ('abc', '-1', '1.5').
 */
export function parseId(value) {
  return /^[1-9]\d*$/.test(String(value)) ? Number(value) : null;
}
