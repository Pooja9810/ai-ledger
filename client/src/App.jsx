import { useCallback, useEffect, useState } from "react";
import { AccountList } from "./components/AccountList.jsx";
import { AddTransactionDialog } from "./components/AddTransactionDialog.jsx";
import { BudgetList } from "./components/BudgetList.jsx";
import { SummaryCards } from "./components/SummaryCards.jsx";
import { TransactionList } from "./components/TransactionList.jsx";
import { Logo, Toast } from "./components/ui.jsx";
import { todayLocal } from "./format.js";
import { useApi } from "./hooks/useApi.js";
import "./App.css";

export default function App() {
  // Bumped after every change, so every component re-fetches fresh data
  // from the server (the single source of truth for balances).
  const [dataVersion, setDataVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState("");
  const clearToast = useCallback(() => setToast(""), []);

  const month = todayLocal().slice(0, 7);
  const { data: accounts, error: accountsError } = useApi(
    "/accounts",
    dataVersion,
  );

  // Keyboard shortcut: "n" opens the dialog, unless you're typing somewhere.
  useEffect(() => {
    function onKeyDown(e) {
      const typing = e.target.closest("input, textarea, select, dialog");
      if (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setAdding(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span>Ledgerly</span>
        </div>
        <button
          type="button"
          className="button-primary"
          onClick={() => setAdding(true)}
          aria-keyshortcuts="n"
        >
          <span aria-hidden="true">+</span> Add transaction
          <kbd aria-hidden="true">N</kbd>
        </button>
      </header>

      <main>
        <SummaryCards
          month={month}
          accountCount={accounts ? accounts.length : null}
          version={dataVersion}
        />

        <div className="layout">
          <div className="stack">
            <AccountList accounts={accounts} error={accountsError} />
            <BudgetList month={month} version={dataVersion} />
          </div>
          <TransactionList
            accounts={accounts ?? []}
            version={dataVersion}
            onAdd={() => setAdding(true)}
          />
        </div>
      </main>

      <AddTransactionDialog
        open={adding}
        onClose={() => setAdding(false)}
        accounts={accounts ?? []}
        onSaved={(message) => {
          setAdding(false);
          setToast(message);
          setDataVersion((v) => v + 1);
        }}
      />
      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}
