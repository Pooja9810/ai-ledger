import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ACCOUNT_TYPE_LABELS, formatCents } from "../format.js";

export function AccountList() {
  // STATE: data this component remembers. Calling a setter re-draws the component.
  const [accounts, setAccounts] = useState(null); // null = "not loaded yet"
  const [error, setError] = useState(null);

  // EFFECT: runs after the component first appears on screen.
  // The empty [] at the end means "only once, not on every re-draw".
  useEffect(() => {
    let ignore = false; // see the cleanup function below
    api("/accounts")
      .then((data) => {
        if (!ignore) setAccounts(data);
      })
      .catch((err) => {
        if (!ignore) setError(err.message);
      });
    // CLEANUP: if the component disappears before the response arrives,
    // ignore the late response instead of updating a component that's gone.
    return () => {
      ignore = true;
    };
  }, []);

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
