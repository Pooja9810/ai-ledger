import { formatCents } from "./format.js";

const WARNING_PERCENT = 80; // amber from 80% of the limit
const AHEAD_POINTS = 10; // "ahead of pace": 10+ points more spent than days gone

/**
 * Status for one budget. Color is never the only signal: every status
 * also has an icon and a text label (readable with color blindness).
 * Integer math only: compare spent*100 with limit*80 instead of dividing.
 *
 * `pace` ({ day, daysInMonth }, optional) adds "ahead of pace": 74% spent
 * on day 17 of 30 (57% of the month) is worth a look before it hits 80%.
 */
export function budgetStatus(spentCents, limitCents, pace) {
  if (spentCents > limitCents) {
    return {
      level: "critical",
      icon: "✕",
      label: `Over by ${formatCents(spentCents - limitCents)}`,
      short: "Over budget",
    };
  }
  const left = `${formatCents(limitCents - spentCents)} left`;
  if (spentCents * 100 >= limitCents * WARNING_PERCENT) {
    return { level: "warning", icon: "!", label: left, short: "Near limit" };
  }
  if (pace && isAheadOfPace(spentCents, limitCents, pace)) {
    return {
      level: "warning",
      icon: "→",
      label: `Ahead of pace · ${left}`,
      short: "Ahead of pace",
    };
  }
  return { level: "good", icon: "✓", label: left };
}

// spent/limit ≥ day/days + 10%, cross-multiplied so it stays in integers.
function isAheadOfPace(spent, limit, { day, daysInMonth }) {
  return (
    spent * 100 * daysInMonth >=
    limit * (day * 100 + AHEAD_POINTS * daysInMonth)
  );
}

/**
 * Split budgets for the Budgets screen: the ones that need a look (over,
 * near the limit, or ahead of pace) first, most urgent first; then the rest.
 * Also returns the totals across all budgets.
 */
export function groupBudgets(budgets, pace) {
  const rank = { critical: 0, warning: 1, good: 2 };
  const withStatus = budgets.map((b) => {
    const spent = Math.max(b.spent_cents, 0);
    return {
      ...b,
      spent,
      status: budgetStatus(spent, b.monthly_limit_cents, pace),
    };
  });
  const byUrgency = (a, b) =>
    rank[a.status.level] - rank[b.status.level] ||
    b.spent * a.monthly_limit_cents - a.spent * b.monthly_limit_cents;
  return {
    attention: withStatus
      .filter((b) => b.status.level !== "good")
      .sort(byUrgency),
    onTrack: withStatus.filter((b) => b.status.level === "good"),
    spentCents: withStatus.reduce((sum, b) => sum + b.spent, 0),
    limitCents: withStatus.reduce((sum, b) => sum + b.monthly_limit_cents, 0),
  };
}
