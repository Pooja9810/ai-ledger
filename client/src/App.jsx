import { AccountList } from "./components/AccountList.jsx";
import { TransactionTable } from "./components/TransactionTable.jsx";
import { useApi } from "./hooks/useApi.js";
import "./App.css";

export default function App() {
  // LIFTED STATE: both components below need the accounts, so their common
  // parent loads them once and passes them down as props.
  const { data: accounts, error: accountsError } = useApi("/accounts");

  return (
    <div className="app">
      <header className="app-header">
        <h1>Ledgerly</h1>
        <p className="muted">Your personal ledger</p>
      </header>
      <main className="layout">
        <AccountList accounts={accounts} error={accountsError} />
        <TransactionTable accounts={accounts ?? []} />
      </main>
    </div>
  );
}
