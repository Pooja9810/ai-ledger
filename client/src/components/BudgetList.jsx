import { useApi } from "../hooks/useApi.js";
import { budgetStatus } from "../budgets.js";
import { formatCents, monthProgress } from "../format.js";
import { Skeleton } from "./ui.jsx";

/**
 * Props:
 *   month   – 'YYYY-MM' (the current month)
 *   version – bumped by App after changes, to trigger a re-fetch
 */
export function BudgetList({ month, version }) {
  const { data: budgets, error } = useApi(`/budgets?month=${month}`, version);

  // PACE: where you'd be today if you spent evenly through the month.
  // 94% spent on the 28th is fine; 94% spent on the 9th is a warning sign.
  const [day, daysInMonth] = monthProgress();
  const pacePercent = (day / daysInMonth) * 100; // display only
  const daysLeft = daysInMonth - day;

  return (
    <section className="card">
      <header className="card-header">
        <h2>Budgets</h2>
        <span className="caption">
          {daysLeft === 0 ? "Last day of the month" : `${daysLeft} days left`}
        </span>
      </header>

      {error && <p className="error-text">Couldn't load budgets: {error}</p>}

      {!error && budgets === null && (
        <div className="budget-list" aria-busy="true">
          {[1, 2].map((i) => (
            <div key={i}>
              <Skeleton width="40%" />
              <Skeleton height={8} />
            </div>
          ))}
        </div>
      )}

      {budgets?.length === 0 && (
        <p className="empty">
          No budgets yet. A budget sets a monthly limit for a spending category.
        </p>
      )}

      {budgets?.length > 0 && (
        <>
          <ul className="budget-list">
            {budgets.map((b) => {
              const spent = Math.max(b.spent_cents, 0);
              const limit = b.monthly_limit_cents;
              const percent = Math.min((spent / limit) * 100, 100); // bar width only
              const status = budgetStatus(spent, limit);
              const summary = `${formatCents(spent)} of ${formatCents(limit)}, ${status.label}`;

              return (
                <li key={b.category_id}>
                  <div className="budget-top">
                    <span className="row-title">{b.category_name}</span>
                    <span className="budget-amounts">
                      <span className="amount">{formatCents(spent)}</span>
                      <span className="muted"> / {formatCents(limit)}</span>
                    </span>
                  </div>

                  <div
                    className={`meter ${status.level}`}
                    role="meter"
                    aria-label={`${b.category_name} budget`}
                    aria-valuemin={0}
                    aria-valuemax={limit}
                    aria-valuenow={Math.min(spent, limit)}
                    aria-valuetext={summary}
                    title={summary}
                  >
                    <div
                      className="meter-fill"
                      style={{ width: `${percent}%` }}
                    />
                    <div
                      className="meter-pace"
                      style={{ left: `${pacePercent}%` }}
                      aria-hidden="true"
                    />
                  </div>

                  <div className="budget-status">
                    <span
                      className={`status-icon ${status.level}`}
                      aria-hidden="true"
                    >
                      {status.icon}
                    </span>
                    {status.label}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="legend">
            <span className="legend-pace" aria-hidden="true" /> Even pace for
            today (day {day} of {daysInMonth})
          </p>
        </>
      )}
    </section>
  );
}
