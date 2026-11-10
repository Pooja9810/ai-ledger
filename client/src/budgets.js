import { formatCents } from "./format.js";

const WARNING_PERCENT = 80; // amber from 80% of the limit

/**
 * Status for one budget. Color is never the only signal: every status
 * also has an icon and a text label (readable with color blindness).
 * Integer math only: compare spent*100 with limit*80 instead of dividing.
 */
export function budgetStatus(spentCents, limitCents) {
  if (spentCents > limitCents) {
    return {
      level: "critical",
      icon: "✕",
      label: `Over by ${formatCents(spentCents - limitCents)}`,
    };
  }
  const left = `${formatCents(limitCents - spentCents)} left`;
  if (spentCents * 100 >= limitCents * WARNING_PERCENT) {
    return { level: "warning", icon: "!", label: left };
  }
  return { level: "good", icon: "✓", label: left };
}
