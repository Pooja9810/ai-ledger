// Money is stored as integer cents everywhere. We only convert to dollars
// here, at the very last moment, for display. (Dividing for display is safe;
// it's doing MATH in floats that causes rounding errors.)
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** 123456 → "$1,234.56", -1250 → "-$12.50" */
export const formatCents = (cents) => usd.format(cents / 100);

/**
 * Parse what a user typed into integer cents, WITHOUT floating-point math.
 * '12.50' → 1250, '12.5' → 1250, '1,234' → 123400, '.99' → 99
 * Returns null for anything that isn't a valid non-negative amount
 * with at most 2 decimal places ('abc', '12.345', '-5', '').
 */
export function parseDollarsToCents(text) {
  const cleaned = String(text).trim().replace(/[$,]/g, "");
  const match = /^(\d*)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match || cleaned === "" || cleaned === ".") return null;
  const [, dollars, cents = ""] = match;
  return Number(dollars || "0") * 100 + Number(cents.padEnd(2, "0"));
}

/** Today as 'YYYY-MM-DD' in local time (for the form's default date). */
export const todayLocal = () => new Date().toLocaleDateString("en-CA");

/**
 * '2026-11-03' → 'Nov 3, 2026'
 *
 * ⚠️ Timezone trap: new Date('2026-11-03') is parsed as MIDNIGHT UTC, which in
 * New York is still Nov 2 at 7pm, so the page would show the wrong day.
 * Building the date from its parts uses LOCAL time instead.
 */
export function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** '2026-11' → ['2026-11-01', '2026-11-30'] (the API only accepts real dates) */
export function monthBounds(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  // Day 0 of the NEXT month = the last day of THIS month.
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return [`${month}-01`, `${month}-${String(lastDay).padStart(2, "0")}`];
}

export const ACCOUNT_TYPE_LABELS = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
  cash: "Cash",
};
