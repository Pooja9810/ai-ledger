// Money is stored as integer cents everywhere. We only convert to dollars
// here, at the very last moment, for display. (Dividing for display is safe;
// it's doing MATH in floats that causes rounding errors.)
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const MINUS = "\u2212"; // a real minus sign: same width as "+", aligns in columns

/** 123456 → "$1,234.56", -1250 → "−$12.50" */
export const formatCents = (cents) =>
  usd.format(cents / 100).replace("-", MINUS);

/** Always show the direction: 4210 → "+$42.10", -1250 → "−$12.50" */
export const formatSignedCents = (cents) =>
  cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);

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

/** 'YYYY-MM-DD' → a local Date (never via the UTC parser; see formatDate). */
function toLocalDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Friendly heading for a day of transactions:
 * 'Today', 'Yesterday', 'Sat, Nov 7', or 'Mon, Dec 29, 2025' in another year.
 */
export function dayLabel(isoDate, today = todayLocal()) {
  if (isoDate === today) return "Today";
  const yesterday = toLocalDate(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isoDate === yesterday.toLocaleDateString("en-CA")) return "Yesterday";
  const date = toLocalDate(isoDate);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(isoDate.slice(0, 4) !== today.slice(0, 4) && { year: "numeric" }),
  });
}

/** '2026-11' → 'November 2026' */
export function monthLabel(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** The current month and the `count - 1` before it, newest first: ['2026-11', '2026-10', ...] */
export function recentMonths(count, today = todayLocal()) {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, i) =>
    new Date(year, month - 1 - i, 1).toLocaleDateString("en-CA").slice(0, 7),
  );
}

/** How far through the month we are, as [dayOfMonth, daysInMonth]. */
export function monthProgress(today = todayLocal()) {
  const [year, month, day] = today.split("-").map(Number);
  return [day, new Date(year, month, 0).getDate()];
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
