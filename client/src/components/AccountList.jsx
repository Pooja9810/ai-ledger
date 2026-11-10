import { ACCOUNT_TYPE_LABELS, formatCents } from "../format.js";

/**
 * Props (loaded once by App and passed down):
 *   accounts – list of accounts, or null while loading
 *   error    – error message, or null
 */
export function AccountList({ accounts, error }) {
  // A screen that loads data has 4 possible states. Handle ALL of them.
  if (error) return <p className="error">Couldn't load accounts: {error}</p>;
  if (accounts === null) return <p className="muted">Loading accounts…</p>;
  if (accounts.length === 0) return <p className="muted">No accounts yet.</p>;

  // Credit card debt is already negative (our sign convention),
  // so a simple sum gives the true net worth.
  const netWorth = accounts.reduce((sum, a) => sum + a.balance_cents, 0);

  return (
    <section className="card">
      <h2>Accounts</h2>
      <ul className="account-list">
        {/* .map() turns each account into a list item. React needs a unique
            "key" per item to track which row is which when the list changes. */}
        {accounts.map((account) => (
          <li key={account.id}>
            <div>
              <div className="account-name">{account.name}</div>
              <div className="muted small">
                {ACCOUNT_TYPE_LABELS[account.type]}
              </div>
            </div>
            <span
              className={
                account.balance_cents < 0 ? "amount negative" : "amount"
              }
            >
              {formatCents(account.balance_cents)}
            </span>
          </li>
        ))}
      </ul>
      <div className="total">
        <span>Net worth</span>
        <span className="amount">{formatCents(netWorth)}</span>
      </div>
    </section>
  );
}
