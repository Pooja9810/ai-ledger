// Home screen charts, drawn as plain SVG/HTML from numbers the server
// computed. No chart library: two simple charts don't need 100 kB of JS.
import {
  barHeights,
  donutSegments,
  groupCategories,
  shortDollars,
  shortMonth,
} from "../charts.js";
import { Skeleton } from "./ui.jsx";

const SLICE_COLORS = [1, 2, 3, 4, 5].map((n) => `var(--chart-${n})`);
const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** "Where it went": a donut of spending by category, with a labeled legend. */
export function SpendingDonut({ data, error }) {
  const slices = data ? groupCategories(data.by_category) : [];
  const segments = donutSegments(slices, CIRCUMFERENCE);
  const total = data?.spending_cents ?? 0;
  const description = slices
    .map((s) => `${s.label} ${shortDollars(s.cents)}`)
    .join(", ");

  return (
    <section
      className="card chart-card donut-card"
      aria-labelledby="donut-title"
    >
      <header className="card-header">
        <h2 id="donut-title">Where it went</h2>
      </header>

      {error && <p className="error-text">Couldn't load spending: {error}</p>}
      {!data && !error && (
        <div className="donut-body" aria-busy="true">
          <Skeleton width={128} height={128} />
          <div className="donut-legend">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} width="80%" />
            ))}
          </div>
        </div>
      )}
      {data && slices.length === 0 && (
        <p className="empty">No spending yet this month.</p>
      )}
      {slices.length > 0 && (
        <div className="donut-body">
          <svg
            className="donut"
            viewBox="0 0 128 128"
            role="img"
            aria-label={`Spending by category: ${description}`}
          >
            <g transform="rotate(-90 64 64)" fill="none" strokeWidth="18">
              {slices.map((s, i) => (
                <circle
                  key={s.label}
                  cx="64"
                  cy="64"
                  r={RADIUS}
                  stroke={SLICE_COLORS[i]}
                  strokeDasharray={`${segments[i].length} ${CIRCUMFERENCE}`}
                  strokeDashoffset={segments[i].offset}
                />
              ))}
            </g>
            <text x="64" y="60" textAnchor="middle" className="donut-caption">
              {data.by_category.length} categor
              {data.by_category.length === 1 ? "y" : "ies"}
            </text>
            <text x="64" y="78" textAnchor="middle" className="donut-total">
              {shortDollars(total)}
            </text>
          </svg>
          <ul className="donut-legend" aria-hidden="true">
            {slices.map((s, i) => (
              <li key={s.label}>
                <span
                  className="swatch"
                  style={{ background: SLICE_COLORS[i] }}
                />
                <span className="legend-label">{s.label}</span>
                <span className="amount">{shortDollars(s.cents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Spending per month, this month highlighted (and marked "so far"). */
export function TrendChart({ data, error, inProgress }) {
  const trend = data?.trend ?? [];
  // Share of the tallest month (0–1), as a CSS variable per bar.
  const shares = barHeights(
    trend.map((t) => t.spending_cents),
    1000,
  ).map((h) => h / 1000);

  return (
    <section
      className="card chart-card trend-card"
      aria-labelledby="trend-title"
    >
      <header className="card-header">
        <h2 id="trend-title">
          Last {trend.length > 1 ? `${trend.length} months` : "months"}
        </h2>
        <span className="caption">Spending per month</span>
      </header>

      {error && <p className="error-text">Couldn't load the trend: {error}</p>}
      {!data && !error && <Skeleton height={170} />}
      {data && trend.length === 0 && (
        <p className="empty">Your monthly spending will show here.</p>
      )}
      {trend.length > 0 && (
        <ol className="bars">
          {trend.map((t, i) => {
            const current = i === trend.length - 1;
            const name = shortMonth(t.month);
            return (
              // Label first in the markup, so a screen reader says
              // "Nov so far, $2,656"; CSS moves it under the bar.
              <li key={t.month} className={current ? "is-current" : undefined}>
                <span className="bar-label">
                  {name}
                  {current && inProgress && (
                    <span className="hide-on-phone"> so far</span>
                  )}
                </span>
                <span className="bar-track">
                  <span className="bar-value amount">
                    {shortDollars(t.spending_cents)}
                  </span>
                  <span className="bar" style={{ "--share": shares[i] }} />
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
