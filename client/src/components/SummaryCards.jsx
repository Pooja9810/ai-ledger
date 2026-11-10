import { useApi } from "../hooks/useApi.js";
import { formatCents, formatSignedCents, monthLabel } from "../format.js";
import { Skeleton } from "./ui.jsx";

/**
 * The answer to "how am I doing?", shown first.
 * One hero number (net worth) plus three supporting tiles for this month.
 *
 * Props:
 *   month        – 'YYYY-MM'
 *   accountCount – number of accounts (for the caption), or null while loading
 *   version      – bumped by App after changes, to trigger a re-fetch
 */
export function SummaryCards({ month, accountCount, version }) {
  const { data, error } = useApi(`/summary?month=${month}`, version);
  const monthName = monthLabel(month).split(" ")[0]; // 'November'

  if (error) {
    return <p className="error-text">Couldn't load your summary: {error}</p>;
  }

  return (
    <section className="summary" aria-label="Summary">
      <div className="card hero-card">
        <span className="label">Net worth</span>
        <span className="hero-number amount">
          {data ? (
            formatCents(data.net_worth_cents)
          ) : (
            <Skeleton width="60%" height={48} />
          )}
        </span>
        <span className="caption">
          {accountCount === null
            ? " "
            : `Across ${accountCount} account${accountCount === 1 ? "" : "s"}`}
        </span>
      </div>

      <Tile
        label={`Income · ${monthName}`}
        value={data && formatCents(data.income_cents)}
        caption="From income categories"
      />
      <Tile
        label={`Spending · ${monthName}`}
        value={data && formatCents(data.spending_cents)}
        caption="Includes uncategorized"
      />
      <Tile
        label="Net this month"
        value={data && formatSignedCents(data.net_cents)}
        tone={data && data.net_cents > 0 ? "positive" : undefined}
        caption={
          data &&
          (data.net_cents >= 0
            ? "Money in exceeds money out"
            : "More out than in so far")
        }
      />
    </section>
  );
}

function Tile({ label, value, tone, caption }) {
  return (
    <div className="card tile">
      <span className="label">{label}</span>
      <span
        className={`tile-number amount ${tone === "positive" ? "positive-text" : ""}`}
      >
        {value ?? <Skeleton width="70%" height={28} />}
      </span>
      {caption && <span className="caption">{caption}</span>}
    </div>
  );
}
