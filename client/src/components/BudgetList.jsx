import { useApi } from "../hooks/useApi.js";
import { groupBudgets } from "../budgets.js";
import { formatCents, monthLabel, monthProgress } from "../format.js";
import { Skeleton } from "./ui.jsx";

/**
 * The Budgets screen: the total across budgets, then the budgets that need
 * a look (over, near the limit, or ahead of pace), then the ones on track.
 *
 * Props:
 *   month   – 'YYYY-MM' (the current month)
 *   version – bumped by App after changes, to trigger a re-fetch
 */
export function BudgetsScreen({ month, version }) {
  const { data: budgets, error } = useApi(`/budgets?month=${month}`, version);

  // PACE: where you'd be today if you spent evenly through the month.
  // 94% spent on the 28th is fine; 94% spent on the 9th is a warning sign.
  const [day, daysInMonth] = monthProgress();
  const pace = { day, daysInMonth };
  const daysLeft = daysInMonth - day;
  const groups = budgets ? groupBudgets(budgets, pace) : null;

  return (
    <div className="budgets-screen">
      <header className="screen-header">
        <h1>Budgets</h1>
        <span className="caption">
          {monthLabel(month).split(" ")[0]} ·{" "}
          {daysLeft === 0 ? "last day of the month" : `${daysLeft} days left`}
        </span>
      </header>

      {error && <p className="error-text">Couldn't load budgets: {error}</p>}

      {!error && !budgets && (
        <section className="card" aria-busy="true">
          <Skeleton width="40%" height={28} />
          <Skeleton height={10} />
        </section>
      )}

      {budgets?.length === 0 && (
        <section className="card">
          <p className="empty">
            No budgets yet. A budget sets a monthly limit for a spending
            category.
          </p>
        </section>
      )}

      {groups && budgets.length > 0 && (
        <>
          <section className="card budget-total" aria-label="All budgets">
            <p className="budget-total-top">
              <span className="tile-number amount">
                {formatCents(groups.spentCents)}
              </span>
              <span className="caption">
                of {formatCents(groups.limitCents)} across {budgets.length}{" "}
                budgets
              </span>
            </p>
            <Meter
              label="All budgets"
              spent={groups.spentCents}
              limit={groups.limitCents}
              level="neutral"
              pace={pace}
              summary={`${formatCents(groups.spentCents)} of ${formatCents(groups.limitCents)}`}
            />
            <p className="legend">
              <span className="legend-pace" aria-hidden="true" /> Even pace for
              today (day {day} of {daysInMonth})
            </p>
          </section>

          {groups.attention.length > 0 && (
            <BudgetGroup
              title="Needs a look"
              items={groups.attention}
              pace={pace}
            />
          )}
          {groups.onTrack.length > 0 && (
            <BudgetGroup title="On track" items={groups.onTrack} pace={pace} />
          )}
        </>
      )}
    </div>
  );
}

function BudgetGroup({ title, items, pace }) {
  const id = `budgets-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section className="card" aria-labelledby={id}>
      <header className="card-header">
        <h2 id={id}>{title}</h2>
      </header>
      <ul className="budget-list">
        {items.map((b) => (
          <BudgetRow key={b.category_id} budget={b} pace={pace} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One budget: name, amounts, a meter with the pace marker, and a status
 * that pairs its color with an icon and words. `budget` comes from
 * groupBudgets (it carries `spent` and `status`).
 */
export function BudgetRow({ budget: b, pace, compact = false }) {
  const limit = b.monthly_limit_cents;
  const summary = `${formatCents(b.spent)} of ${formatCents(limit)}, ${b.status.label}`;
  return (
    <li>
      <div className="budget-top">
        <span className="row-title">{b.category_name}</span>
        {compact && b.status.short ? (
          <span className="budget-flag">
            <span
              className={`status-icon ${b.status.level}`}
              aria-hidden="true"
            >
              {b.status.icon}
            </span>
            {b.status.short}
          </span>
        ) : (
          <span className="budget-amounts">
            <span className="amount">{formatCents(b.spent)}</span>
            <span className="muted"> / {formatCents(limit)}</span>
          </span>
        )}
      </div>
      <Meter
        label={`${b.category_name} budget`}
        spent={b.spent}
        limit={limit}
        level={b.status.level}
        pace={pace}
        summary={summary}
      />
      <div className="budget-status">
        {compact ? (
          <span className="caption">
            {formatCents(b.spent)} of {formatCents(limit)} ·{" "}
            {b.status.label.replace(/^Ahead of pace · /, "")}
          </span>
        ) : (
          <>
            <span
              className={`status-icon ${b.status.level}`}
              aria-hidden="true"
            >
              {b.status.icon}
            </span>
            {b.status.label}
          </>
        )}
      </div>
    </li>
  );
}

function Meter({ label, spent, limit, level, pace, summary }) {
  const percent = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0; // width only
  const pacePercent = (pace.day / pace.daysInMonth) * 100;
  return (
    <div
      className={`meter ${level}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={Math.min(spent, limit)}
      aria-valuetext={summary}
      title={summary}
    >
      <div className="meter-fill" style={{ width: `${percent}%` }} />
      <div
        className="meter-pace"
        style={{ left: `${pacePercent}%` }}
        aria-hidden="true"
      />
    </div>
  );
}
