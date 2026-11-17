import { useApi } from "../hooks/useApi.js";
import { changeLabel, previousMonthName } from "../charts.js";
import { groupBudgets } from "../budgets.js";
import {
  dayLabel,
  formatCents,
  formatSignedCents,
  monthLabel,
  monthProgress,
  todayLocal,
} from "../format.js";
import { SpendingDonut, TrendChart } from "./Charts.jsx";
import { InsightsCard } from "./InsightsCard.jsx";
import { BudgetRow } from "./BudgetList.jsx";
import { Skeleton } from "./ui.jsx";

/**
 * Home: the month at a glance. One hero number, two charts, the budgets that
 * need a look and the latest transactions; each links to its full screen.
 */
export function HomeScreen({ version, onEdit, welcome }) {
  const today = todayLocal();
  const month = today.slice(0, 7);
  const home = useApi(`/summary/home?month=${month}&today=${today}`, version);
  const summary = useApi(`/summary?month=${month}`, version);

  return (
    <div className="home-grid">
      {welcome}
      <HeroCard
        month={month}
        home={home.data}
        summary={summary.data}
        error={home.error ?? summary.error}
        version={version}
      />
      <SpendingDonut data={home.data} error={home.error} />
      <BudgetsAttention month={month} version={version} />
      <TrendChart data={home.data} error={home.error} inProgress />
      <RecentTransactions version={version} onEdit={onEdit} />
    </div>
  );
}

function HeroCard({ month, home, summary, error, version }) {
  const change = home && changeLabel(home.compare, previousMonthName(month));
  return (
    <section className="card hero-card" aria-labelledby="hero-title">
      <h2 id="hero-title" className="label">
        Spent in {monthLabel(month).split(" ")[0]}
      </h2>
      {error && <p className="error-text">Couldn't load this month: {error}</p>}
      <p className="hero-number amount">
        {home ? (
          formatCents(home.spending_cents)
        ) : (
          <Skeleton width="60%" height={48} />
        )}
      </p>
      <p className="caption hero-change">{change ?? " "}</p>
      <dl className="hero-stats">
        <div>
          <dt className="caption">Money in</dt>
          <dd className="amount positive-text">
            {summary ? (
              formatSignedCents(summary.income_cents)
            ) : (
              <Skeleton width="70%" />
            )}
          </dd>
        </div>
        <div>
          <dt className="caption">Net this month</dt>
          <dd
            className={`amount ${summary?.net_cents > 0 ? "positive-text" : ""}`}
          >
            {summary ? (
              formatSignedCents(summary.net_cents)
            ) : (
              <Skeleton width="70%" />
            )}
          </dd>
        </div>
      </dl>
      <InsightsCard version={version} compact />
    </section>
  );
}

const MAX_ATTENTION = 3;

function BudgetsAttention({ month, version }) {
  const { data, error } = useApi(`/budgets?month=${month}`, version);
  const [day, daysInMonth] = monthProgress();
  const pace = { day, daysInMonth };
  const groups = data ? groupBudgets(data, pace) : null;
  const shown = groups?.attention.slice(0, MAX_ATTENTION) ?? [];
  const onTrack = groups ? groups.onTrack.length : 0;
  const moreAttention = groups ? groups.attention.length - shown.length : 0;

  return (
    <section className="card attention-card" aria-labelledby="attention-title">
      <header className="card-header">
        <h2 id="attention-title">Budgets that need a look</h2>
        <a className="link" href="#budgets">
          All budgets
        </a>
      </header>
      {error && <p className="error-text">Couldn't load budgets: {error}</p>}
      {!data && !error && (
        <div aria-busy="true">
          <Skeleton width="40%" />
          <Skeleton height={8} />
        </div>
      )}
      {data?.length === 0 && (
        <p className="empty">
          No budgets yet. A budget sets a monthly limit for a category.
        </p>
      )}
      {groups && data.length > 0 && shown.length === 0 && (
        <p className="all-good">
          <span className="status-icon good" aria-hidden="true">
            ✓
          </span>
          All {data.length} budgets are on track
        </p>
      )}
      {shown.length > 0 && (
        <ul className="budget-list">
          {shown.map((b) => (
            <BudgetRow key={b.category_id} budget={b} pace={pace} compact />
          ))}
        </ul>
      )}
      {moreAttention > 0 && (
        <p className="caption">
          <a className="link" href="#budgets">
            {moreAttention} more need a look
          </a>
        </p>
      )}
      {shown.length > 0 && onTrack > 0 && (
        <p className="all-good caption">
          <span className="status-icon good" aria-hidden="true">
            ✓
          </span>
          {onTrack} other budget{onTrack === 1 ? "" : "s"} on track
        </p>
      )}
    </section>
  );
}

const RECENT = 5;

function RecentTransactions({ version, onEdit }) {
  const { data, error } = useApi("/transactions?", version);
  const rows = data?.slice(0, RECENT);

  return (
    <section className="card recent-card" aria-labelledby="recent-title">
      <header className="card-header">
        <h2 id="recent-title">Recent</h2>
        <a className="link" href="#transactions">
          All transactions
        </a>
      </header>
      {error && (
        <p className="error-text">Couldn't load transactions: {error}</p>
      )}
      {!data && !error && (
        <div aria-busy="true">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} />
          ))}
        </div>
      )}
      {data?.length === 0 && (
        <p className="empty">No transactions yet. Add one with the + button.</p>
      )}
      {rows?.length > 0 && (
        <ul className="rows">
          {rows.map((t) => (
            <li key={t.id} className="row txn">
              {/* The whole row is one button: tap it to edit. */}
              <button
                type="button"
                className="row-button"
                onClick={() => onEdit(t)}
                aria-label={`Edit ${t.description || t.category_name || "transaction"}, ${formatSignedCents(t.amount_cents)}, ${dayLabel(t.date)}`}
              >
                <span className="row-main">
                  <span className="row-title">
                    {t.description || t.category_name || "Untitled"}
                  </span>
                  <span className="row-meta">
                    {dayLabel(t.date)}
                    <span aria-hidden="true"> · </span>
                    {t.category_name ?? (
                      <span className="pill-dashed">Uncategorized</span>
                    )}
                  </span>
                </span>
                <span
                  className={`amount ${t.amount_cents > 0 && t.category_kind !== "transfer" ? "positive-text" : ""}`}
                >
                  {formatSignedCents(t.amount_cents)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
