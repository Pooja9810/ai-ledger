import { ACCOUNT_TYPE_LABELS, formatCents } from "../format.js";
import { Skeleton } from "./ui.jsx";

/**
 * Props (loaded once by App and passed down):
 *   accounts – list of accounts, or null while loading
 *   error    – error message, or null
 *   netWorth – sum of all balances in cents, or null while loading
 */
export function AccountList({ accounts, error, netWorth = null }) {
  return (
    <section className="card accounts-card" aria-labelledby="accounts-title">
      <header className="card-header">
        <h2 id="accounts-title">Accounts</h2>
        {netWorth !== null && (
          <span className="caption">
            Net worth{" "}
            <span className="amount net-worth">{formatCents(netWorth)}</span>
          </span>
        )}
      </header>

      {error && <p className="error-text">Couldn't load accounts: {error}</p>}

      {!error && accounts === null && (
        <ul className="rows" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <li key={i} className="row">
              <Skeleton width="55%" />
              <Skeleton width="25%" />
            </li>
          ))}
        </ul>
      )}

      {accounts?.length === 0 && (
        <p className="empty">
          No accounts yet. Accounts hold your transactions, like a checking
          account or a credit card.
        </p>
      )}

      {accounts?.length > 0 && (
        <ul className="rows">
          {accounts.map((account) => (
            <li key={account.id} className="row">
              <div className="row-main">
                <span className="row-title">{account.name}</span>
                <span className="row-meta">
                  {ACCOUNT_TYPE_LABELS[account.type]}
                </span>
              </div>
              {/* Debt isn't an error: it shows in normal ink with a minus sign. */}
              <span className="amount">
                {formatCents(account.balance_cents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
