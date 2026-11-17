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
