/**
 * A small chart to go with an "Ask your ledger" answer, built ONLY from the
 * results of the tools the AI called (numbers our code computed), never
 * from the AI's text. The AI reaches the same answer by different routes,
 * so each route that has a clear chart shape gets one; anything ambiguous
 * gets no chart (no chart beats a chart of the wrong thing).
 *
 * Shapes, in order:
 *  1. One category, month by month, from list_transactions called once per
 *     month with the same category.
 *  2. One category, month by month, from get_spending_by_category called
 *     once per month, when the question names exactly one of its categories
 *     ("Which month did I spend the most on dining out?").
 *  3. An overview, when the AI made exactly one such lookup (or one of each,
 *     then the later one): spending per month (get_monthly_totals), or
 *     spending by category (get_spending_by_category).
 */
import { formatDateRange } from "../dates.js";

const MAX_CATEGORY_BARS = 6;

/** '$1,234.56' → 123456, '−$4.00' → -400 (the format of formatCents). */
export function parseFormattedCents(text) {
  const match = /^(−|-)?\$([\d,]+)\.(\d{2})$/.exec(String(text));
  if (!match) return null;
  const [, minus, dollars, cents] = match;
  const value = Number(dollars.replaceAll(",", "")) * 100 + Number(cents);
  return minus ? -value : value;
}

/**
 * @param runs     [{ name, args, result }] successful tool calls, in order
 * @param question the user's question (to tell which category it's about)
 * @returns { kind: "months" | "categories", title, bars: [{ key, cents }] } | null
 */
export function chartFromToolRuns(runs, question = "") {
  return (
    listedByMonth(runs) ?? breakdownByMonth(runs, question) ?? overview(runs)
  );
}

// Shape 1: list_transactions for one category, one month per call.
function listedByMonth(runs) {
  const monthly = runs.filter(
    (r) =>
      r.name === "list_transactions" &&
      typeof r.args.category === "string" &&
      !r.args.search &&
      oneMonth(r.args),
  );
  const categories = new Set(monthly.map((r) => r.args.category.toLowerCase()));
  if (categories.size !== 1) return null;

  const byMonth = new Map(); // a repeated month: the later lookup wins
  for (const r of monthly) {
    const cents = parseFormattedCents(r.result.total_of_matching);
    if (cents === null) return null;
    byMonth.set(r.args.from.slice(0, 7), cents);
  }
  if (byMonth.size < 2) return null;

  // Spending categories total negative (money out); show them as positive.
  const values = [...byMonth.values()];
  const sign = values.every((v) => v <= 0) ? -1 : 1;
  if (sign === 1 && values.some((v) => v < 0)) return null; // mixed: unclear

  const name =
    monthly[0].result.transactions?.[0]?.category ?? monthly[0].args.category;
  return monthsChart(`${name} by month`, byMonth, sign);
}

// Shape 2: a full category breakdown per month; chart the one asked about.
function breakdownByMonth(runs, question) {
  const monthly = runs.filter(
    (r) => r.name === "get_spending_by_category" && oneMonth(r.args),
  );
  if (new Set(monthly.map((r) => r.args.from.slice(0, 7))).size < 2) {
    return null;
  }
  const asked = question.toLowerCase();
  const names = new Set(
    monthly.flatMap((r) => r.result.categories.map((c) => c.category)),
  );
  const mentioned = [...names].filter((n) => asked.includes(n.toLowerCase()));
  if (mentioned.length !== 1) return null;
  const [name] = mentioned;

  const byMonth = new Map();
  for (const r of monthly) {
    const row = r.result.categories.find((c) => c.category === name);
    const cents = row ? parseFormattedCents(row.spent) : 0;
    if (cents === null) return null;
    byMonth.set(r.args.from.slice(0, 7), cents);
  }
  return monthsChart(`${name} by month`, byMonth, 1);
}

// Shape 3: one overview lookup (if both kinds, the later one).
function overview(runs) {
  const totals = runs.filter((r) => r.name === "get_monthly_totals");
  const breakdowns = runs.filter((r) => r.name === "get_spending_by_category");
  if (totals.length > 1 || breakdowns.length > 1) return null; // ambiguous
  const last = [...totals, ...breakdowns].sort(
    (a, b) => runs.indexOf(b) - runs.indexOf(a),
  )[0];
  if (!last) return null;

  if (last.name === "get_monthly_totals") {
    // Months before the ledger began have no data: leave them out.
    const starts = last.result.ledger_starts;
    const months = last.result.months.filter(
      (m) => !starts || `${m.month}-31` >= starts,
    );
    if (months.length < 2) return null;
    const byMonth = new Map(
      months.map((m) => [m.month, parseFormattedCents(m.spending)]),
    );
    if ([...byMonth.values()].includes(null)) return null;
    return monthsChart("Spending by month", byMonth, 1);
  }

  const rows = last.result.categories;
  if (rows.length < 2) return null; // one bar compares nothing
  const bars = rows
    .slice(0, MAX_CATEGORY_BARS)
    .map((c) => ({ key: c.category, cents: parseFormattedCents(c.spent) }));
  if (bars.some((b) => b.cents === null)) return null;
  return {
    kind: "categories",
    title: `Spending by category · ${formatDateRange(last.args.from, last.args.to)}`,
    bars,
  };
}

function monthsChart(title, byMonth, sign) {
  return {
    kind: "months",
    title,
    bars: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, cents]) => ({ key, cents: cents * sign })),
  };
}

/** from 2026-09-01 to 2026-09-30 (or ..09-17, a month so far): one month. */
function oneMonth({ from, to }) {
  return (
    typeof from === "string" &&
    typeof to === "string" &&
    from.endsWith("-01") &&
    from.slice(0, 7) === to.slice(0, 7)
  );
}
