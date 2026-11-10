import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { formatCents, formatDate, monthBounds } from "../format.js";

/**
 * Props:
 *   accounts – list of accounts (loaded once by App) for the filter dropdown
 *   version  – bumped by App after changes, to trigger a re-fetch
 */
export function TransactionTable({ accounts, version }) {
  // Filter state. "" means "no filter".
  const [accountId, setAccountId] = useState("");
  const [month, setMonth] = useState("");
  const [uncategorizedOnly, setUncategorizedOnly] = useState(false);

  // DERIVED, not stored: the query string is computed from the filters on
  // every render. Storing it in state too would mean two things to keep in sync.
  const params = new URLSearchParams();
  if (accountId) params.set("account_id", accountId);
  if (month) {
    const [from, to] = monthBounds(month);
    params.set("from", from);
    params.set("to", to);
  }
  if (uncategorizedOnly) params.set("uncategorized", "true");

  // When params change, the path changes, so useApi fetches again.
  const {
    data: transactions,
    error,
    loading,
  } = useApi(`/transactions?${params}`, version);

  const net = transactions?.reduce((sum, t) => sum + t.amount_cents, 0) ?? 0;

  return (
    <section className="card">
      <div className="card-header">
        <h2>Transactions</h2>
        {loading && <span className="muted small">Loading…</span>}
      </div>

      {/* Controlled inputs: React state holds each value; onChange updates it. */}
      <div className="filters">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          aria-label="Filter by account"
        >
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>

        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Filter by month"
        />

        <label className="checkbox">
          <input
            type="checkbox"
            checked={uncategorizedOnly}
            onChange={(e) => setUncategorizedOnly(e.target.checked)}
          />
          Uncategorized only
        </label>

        {(accountId || month || uncategorizedOnly) && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setAccountId("");
              setMonth("");
              setUncategorizedOnly(false);
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {error && <p className="error">Couldn't load transactions: {error}</p>}

      {transactions && transactions.length === 0 && (
        <p className="muted">No transactions match these filters.</p>
      )}

      {transactions && transactions.length > 0 && (
        <>
          <table className="transactions">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Account</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td className="nowrap muted">{formatDate(t.date)}</td>
                  <td>{t.description || <span className="muted">—</span>}</td>
                  <td>
                    {t.category_name ?? (
                      <span className="badge">Uncategorized</span>
                    )}
                  </td>
                  <td className="muted">{t.account_name}</td>
                  <td
                    className={`right amount ${t.amount_cents < 0 ? "negative" : "positive"}`}
                  >
                    {formatCents(t.amount_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small table-footer">
            {transactions.length} transaction
            {transactions.length === 1 ? "" : "s"} · net{" "}
            <span className="amount">{formatCents(net)}</span>
          </p>
        </>
      )}
    </section>
  );
}
