import { useState } from "react";
import { AccountList } from "./components/AccountList.jsx";
import { AddTransactionForm } from "./components/AddTransactionForm.jsx";
import { TransactionTable } from "./components/TransactionTable.jsx";
import { useApi } from "./hooks/useApi.js";
import "./App.css";

export default function App() {
  // Bumped after every change, so every component re-fetches fresh data
  // from the server (the single source of truth for balances).
  const [dataVersion, setDataVersion] = useState(0);
  const refresh = () => setDataVersion((v) => v + 1);

  // LIFTED STATE: several components need the accounts, so their common
  // parent loads them once and passes them down as props.
  const { data: accounts, error: accountsError } = useApi(
    "/accounts",
    dataVersion,
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>Ledgerly</h1>
        <p className="muted">Your personal ledger</p>
      </header>
      <main className="layout">
        <div className="sidebar">
          <AccountList accounts={accounts} error={accountsError} />
          <AddTransactionForm accounts={accounts ?? []} onSaved={refresh} />
        </div>
        <TransactionTable accounts={accounts ?? []} version={dataVersion} />
      </main>
    </div>
  );
}
