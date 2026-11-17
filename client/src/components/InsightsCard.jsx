import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import {
  keepMoneyTogether,
  monthLabel,
  recentMonths,
  todayLocal,
} from "../format.js";
import { insightsErrorMessage, toneMarker } from "../insights.js";
import { Skeleton } from "./ui.jsx";
import { SparkleIcon } from "./Icons.jsx";

/**
 * "This month in words": a short AI-written summary of a month. Every number
 * in it was computed by the server and checked against the facts.
 * `version` bumps after the data changes, so the summary is re-fetched (the
 * server only calls the AI again if the month's data actually changed).
 */
export function InsightsCard({ version, compact = false }) {
  const today = todayLocal();
  const months = recentMonths(4, today);
  const [month, setMonth] = useState(months[0]);
  // Compact (Home): the headline only, until "Read the full summary".
  const [expanded, setExpanded] = useState(false);
  const { data, error } = useApi(
    `/ai/insights?month=${month}&today=${today}`,
    version,
  );
  const loading = !data && !error;
  const inProgress = month === today.slice(0, 7);

  if (compact) {
    return (
      <div className="insight-teaser">
        <SparkleIcon size={16} />
        <div className="insight-teaser-body">
          {loading && (
            <span className="caption" aria-busy="true">
              Writing this month's summary…
            </span>
          )}
          {error && (
            <span className="caption">{insightsErrorMessage(error).text}</span>
          )}
          {data?.empty && (
            <span className="caption">
              Add transactions to get a monthly summary.
            </span>
          )}
          {data && !data.empty && (
            <>
              <p>{keepMoneyTogether(data.headline)}</p>
              {expanded && <Points points={data.points} />}
              <button
                type="button"
                className="link"
                aria-expanded={expanded}
                onClick={() => setExpanded((e) => !e)}
              >
                {expanded ? "Show less" : "Read the full summary"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="card insights-card" aria-labelledby="insights-title">
      <header className="card-header">
        <h2 id="insights-title">
          ✨ {monthLabel(month)}
          {inProgress ? " so far" : ""}
        </h2>
        <label className="insights-month">
          <span className="visually-hidden">Month</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </header>

      {loading && (
        <div className="insights-loading" aria-busy="true">
          <span className="caption">Writing your summary…</span>
          <Skeleton width="80%" />
          <Skeleton width="65%" />
          <Skeleton width="70%" />
        </div>
      )}

      {error &&
        (() => {
          const { info, text } = insightsErrorMessage(error);
          return info ? (
            <p className="caption">ℹ {text}</p>
          ) : (
            <p className="error-text" role="alert">
              ⚠ {text}
            </p>
          );
        })()}

      {data?.empty && (
        <p className="empty">
          No transactions in {monthLabel(month)} yet. Add some, or import a bank
          CSV, to get a summary.
        </p>
      )}

      {data && !data.empty && (
        <>
          <p className="insights-headline">
            {keepMoneyTogether(data.headline)}
          </p>
          <Points points={data.points} />
        </>
      )}
    </section>
  );
}

function Points({ points }) {
  return (
    <ul className="insights-points">
      {points.map((p) => {
        const { icon, label } = toneMarker(p.tone);
        return (
          <li key={p.text} className={`tone-${p.tone}`}>
            <span className="insights-icon" aria-hidden="true">
              {icon}
            </span>
            <span>
              {label && <span className="visually-hidden">{label} </span>}
              {keepMoneyTogether(p.text)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
