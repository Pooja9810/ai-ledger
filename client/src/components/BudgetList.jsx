import { useApi } from "../hooks/useApi.js";
import { budgetStatus } from "../budgets.js";
import { formatCents, todayLocal } from "../format.js";

/**
 * Props:
 *   version – bumped by App after changes, to trigger a re-fetch
 */
export function BudgetList({ version }) {
  const month = todayLocal().slice(0, 7); // 'YYYY-MM'
  const { data: budgets, error } = useApi(`/budgets?month=${month}`, version);

  const [year, monthNumber] = month.split("-").map(Number);
  const monthLabel = new Date(year, monthNumber - 1, 1).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );

  return (
    <section className="card">
      <div className="card-header">
        <h2>Budgets</h2>
        <span className="muted small">{monthLabel}</span>
      </div>

      {error && <p className="error">Couldn't load budgets: {error}</p>}
      {!error && budgets === null && <p className="muted">Loading budgets…</p>}
      {budgets?.length === 0 && <p className="muted">No budgets set yet.</p>}

      {budgets?.length > 0 && (
        <ul className="budget-list">
          {budgets.map((b) => {
            const spent = Math.max(b.spent_cents, 0); // refunds can't go below 0
            const limit = b.monthly_limit_cents;
            const percent = Math.min((spent / limit) * 100, 100); // bar width only
            const status = budgetStatus(spent, limit);
            const summary = `${formatCents(spent)} of ${formatCents(limit)}, ${status.label}`;

            return (
              <li key={b.category_id}>
                <div className="budget-row">
                  <span className="budget-name">{b.category_name}</span>
                  <span className="small">
                    <span className="amount">{formatCents(spent)}</span>
                    <span className="muted"> of {formatCents(limit)}</span>
                  </span>
                </div>

                {/* role="meter" + aria-* lets screen readers announce it. */}
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
                </div>

                <div className="budget-status small">
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
      )}
    </section>
  );
}
