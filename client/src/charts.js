// Chart math for the Home screen. The server computes the money; this only
// turns it into shapes (slices, bar heights) and short labels.
import { formatCents, monthLabel } from "./format.js";

/**
 * Top categories plus "Other", so a donut never has 12 thin slivers.
 * [{category, cents}] (largest first) → [{label, cents, share}], where
 * share is a fraction of the total (0–1).
 */
export function groupCategories(rows, maxSlices = 4) {
  const total = rows.reduce((sum, r) => sum + r.cents, 0);
  if (total <= 0) return [];
  const top = rows.length > maxSlices + 1 ? rows.slice(0, maxSlices) : rows;
  const rest = rows.slice(top.length);
  const slices = top.map((r) => ({ label: r.category, cents: r.cents }));
  if (rest.length > 0) {
    slices.push({
      label: "Other",
      cents: rest.reduce((sum, r) => sum + r.cents, 0),
      count: rest.length,
    });
  }
  return slices.map((s) => ({ ...s, share: s.cents / total }));
}

/**
 * SVG donut: one circle per slice, drawn with stroke-dasharray.
 * Returns [{length, offset}] along a circle of the given circumference,
 * leaving a small gap between slices so they read as separate.
 */
export function donutSegments(slices, circumference, gap = 1) {
  let start = 0;
  return slices.map((s) => {
    const full = s.share * circumference;
    const segment = {
      length: Math.max(full - (slices.length > 1 ? gap : 0), 0),
      offset: -start,
    };
    start += full;
    return segment;
  });
}

/** Bar heights in px for values, scaled to the largest (min 2px if > 0). */
export function barHeights(values, maxHeight) {
  const max = Math.max(...values, 0);
  return values.map((v) =>
    max === 0 || v <= 0 ? 0 : Math.max(2, Math.round((v / max) * maxHeight)),
  );
}

/** "Up 21.4% vs this point last month" / "Down 3.0% vs October" / null. */
export function changeLabel(compare, lastMonthName) {
  if (!compare || compare.change_percent === null) return null;
  const p = compare.change_percent;
  const versus = compare.same_days
    ? "vs this point last month"
    : `vs ${lastMonthName}`;
  if (p === 0) return `Same as ${versus.replace("vs ", "")}`;
  return `${p > 0 ? "Up" : "Down"} ${Math.abs(p).toFixed(1)}% ${versus}`;
}

/** Whole dollars for chart labels: 165000 → "$1,650". */
export const shortDollars = (cents) =>
  formatCents(Math.round(cents / 100) * 100).replace(/\.00$/, "");

/** '2026-11' → 'Nov' */
export const shortMonth = (month) => monthLabel(month).slice(0, 3);

/** '2026-11' → 'October'; '2026-01' → 'December' */
export function previousMonthName(month) {
  const [y, m] = month.split("-").map(Number);
  const prev =
    m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return monthLabel(prev).split(" ")[0];
}

/** What the "Last 6 months" chart can show; each reads one trend field. */
export const TREND_METRICS = [
  {
    id: "spending",
    label: "Spending",
    field: "spending_cents",
    caption: "Spending per month",
  },
  {
    id: "income",
    label: "Income",
    field: "income_cents",
    caption: "Income per month",
  },
  {
    id: "saved",
    label: "Saved",
    field: "net_cents",
    caption: "Income minus spending",
  },
];

/**
 * Bars that can go below zero ("Saved" when you spent more than came in).
 * The chart splits into an area above the zero line and one below it, each
 * sized to its largest bar. Returns {up, bars}: `up` = the share of the height
 * above zero (1 when nothing is negative); each bar's `share` (0–1) is of its
 * own side.
 */
export function signedBars(values) {
  const maxUp = Math.max(...values, 0);
  const maxDown = Math.max(...values.map((v) => -v), 0);
  const up = maxUp + maxDown === 0 ? 1 : maxUp / (maxUp + maxDown);
  return {
    up,
    bars: values.map((v) => {
      const max = v < 0 ? maxDown : maxUp;
      return { negative: v < 0, share: max === 0 ? 0 : Math.abs(v) / max };
    }),
  };
}
