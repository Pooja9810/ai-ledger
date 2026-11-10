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
