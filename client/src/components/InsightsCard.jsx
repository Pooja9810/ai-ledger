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

/**
 * "This month in words": a short AI-written summary of a month. Every number
 * in it was computed by the server and checked against the facts.
 * `version` bumps after the data changes, so the summary is re-fetched (the
 * server only calls the AI again if the month's data actually changed).
 */
export function InsightsCard({ version }) {
  const today = todayLocal();
  const months = recentMonths(4, today);
  const [month, setMonth] = useState(months[0]);
  const { data, error } = useApi(
    `/ai/insights?month=${month}&today=${today}`,
    version,
  );
  const loading = !data && !error;
  const inProgress = month === today.slice(0, 7);

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
          <ul className="insights-points">
            {data.points.map((p) => {
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
        </>
      )}
    </section>
  );
}
