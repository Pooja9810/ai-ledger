import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { transferDirection, transferPartners } from "../transfer.js";
import {
  dayLabel,
  formatSignedCents,
  monthBounds,
  monthLabel,
  recentMonths,
} from "../format.js";
import { Skeleton } from "./ui.jsx";

/**
 * Props:
 *   accounts – list of accounts for the filter
 *   version  – bumped by App after changes, to trigger a re-fetch
 *   onAdd    – opens the "add transaction" dialog (used by the empty state)
 */
export function TransactionList({ accounts, version, onAdd, onImport }) {
  const [accountId, setAccountId] = useState("");
  const [period, setPeriod] = useState(""); // "" = all time, else 'YYYY-MM'
  const [uncategorizedOnly, setUncategorizedOnly] = useState(false);
  const [search, setSearch] = useState("");

  // Server-side filters (they change what the API returns)...
  const params = new URLSearchParams();
  if (accountId) params.set("account_id", accountId);
  if (period) {
    const [from, to] = monthBounds(period);
    params.set("from", from);
    params.set("to", to);
  }
  if (uncategorizedOnly) params.set("uncategorized", "true");
  const { data, error, loading } = useApi(`/transactions?${params}`, version);

  // ...and search runs in the browser, instantly, on what's already loaded.
  const query = search.trim().toLowerCase();
  const transactions = data?.filter(
    (t) =>
      !query ||
      [t.description, t.category_name, t.account_name].some((field) =>
        field?.toLowerCase().includes(query),
      ),
  );
  // Pair transfer halves from everything loaded (not just search matches),
  // so a row can say "To Visa Card" even when the other half is filtered out.
  const partners = transferPartners(data ?? []);

  // Group consecutive transactions by date (the API returns newest first).
  const groups = [];
  for (const t of transactions ?? []) {
    const last = groups.at(-1);
    if (last?.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }

  const hasFilters = accountId || period || uncategorizedOnly || query;
  const clearFilters = () => {
    setAccountId("");
    setPeriod("");
    setUncategorizedOnly(false);
    setSearch("");
  };
  const [thisMonth, lastMonth, ...earlier] = recentMonths(6);

  return (
    <section className="card transactions-card">
      <header className="card-header">
        <h2>Transactions</h2>
        <div className="card-header-actions">
          {loading && data && <span className="caption">Updating…</span>}
          {onImport && (
            <button type="button" className="link-button" onClick={onImport}>
              Import CSV
            </button>
          )}
        </div>
      </header>

      <div className="toolbar" role="search">
        <label className="search">
          <span className="visually-hidden">Search transactions</span>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle
              cx="9"
              cy="9"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M14 14l4 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="search"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          aria-label="Period"
        >
          <option value="">All time</option>
          <option value={thisMonth}>This month</option>
          <option value={lastMonth}>Last month</option>
          {earlier.map((month) => (
            <option key={month} value={month}>
              {monthLabel(month)}
            </option>
          ))}
        </select>

        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          aria-label="Account"
        >
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={`chip ${uncategorizedOnly ? "chip-on" : ""}`}
          aria-pressed={uncategorizedOnly}
          onClick={() => setUncategorizedOnly((on) => !on)}
        >
          Uncategorized
        </button>
      </div>

      {error && (
        <p className="error-text">Couldn't load transactions: {error}</p>
      )}

      {!error && !data && (
        <ul className="rows" aria-busy="true">
          {[1, 2, 3, 4, 5].map((i) => (
            <li key={i} className="row">
              <Skeleton width="45%" />
              <Skeleton width="15%" />
            </li>
          ))}
        </ul>
      )}

      {transactions?.length === 0 &&
        (hasFilters ? (
          <div className="empty">
            <p>No transactions match.</p>
            <button type="button" className="link" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="empty">
            <p>No transactions yet.</p>
            <button type="button" className="link" onClick={onAdd}>
              Add your first transaction
            </button>
          </div>
        ))}

      {groups.map((group) => {
        const dayNet = group.items.reduce((sum, t) => sum + t.amount_cents, 0);
        return (
          <div key={group.date} className="day-group">
            <h3 className="day-heading">
              <span>{dayLabel(group.date)}</span>
              <span className="amount muted">{formatSignedCents(dayNet)}</span>
            </h3>
            <ul className="rows">
              {group.items.map((t) => (
                <li key={t.id} className="row txn">
                  <span
                    className={`avatar${t.transfer_id ? " avatar-transfer" : ""}`}
                    aria-hidden="true"
                  >
                    {t.transfer_id
                      ? "⇄"
                      : (t.description || t.category_name || "?")
                          .replace(/[^a-z0-9]/gi, "")
                          .charAt(0)
                          .toUpperCase() || "?"}
                  </span>
                  <div className="row-main">
                    <span className="row-title">
                      {t.description || t.category_name || "Untitled"}
                    </span>
                    <span className="row-meta">
                      {/* A transfer half says where the money went or came from. */}
                      {t.transfer_id ? (
                        <>
                          {transferDirection(t, partners.get(t.id))}
                          <span aria-hidden="true"> · </span>
                        </>
                      ) : null}
                      {/* If the title already IS the category, don't repeat it here. */}
                      {!t.transfer_id &&
                        (t.description || !t.category_name) &&
                        (t.category_name ?? (
                          <span className="pill-dashed">Uncategorized</span>
                        ))}
                      {!t.transfer_id &&
                        (t.description || !t.category_name) && (
                          <span aria-hidden="true"> · </span>
                        )}
                      {t.account_name}
                    </span>
                  </div>
                  {/* Money in is green with "+"; money out and transfers stay in normal ink. */}
                  <span
                    className={`amount ${t.amount_cents > 0 && t.category_kind !== "transfer" ? "positive-text" : ""}`}
                  >
                    {formatSignedCents(t.amount_cents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {transactions?.length > 0 && (
        <p className="caption list-footer">
          {transactions.length} transaction
          {transactions.length === 1 ? "" : "s"}
          {hasFilters && (
            <>
              {" · "}
              <button type="button" className="link" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          )}
        </p>
      )}
    </section>
  );
}
