// Money is stored as integer cents everywhere. We only convert to dollars
// here, at the very last moment, for display. (Dividing for display is safe;
// it's doing MATH in floats that causes rounding errors.)
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** 123456 → "$1,234.56", -1250 → "-$12.50" */
export const formatCents = (cents) => usd.format(cents / 100);

export const ACCOUNT_TYPE_LABELS = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
  cash: "Cash",
};
