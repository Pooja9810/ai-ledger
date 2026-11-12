import { useCallback, useEffect, useState } from "react";
import { AccountList } from "./components/AccountList.jsx";
import { AddTransactionDialog } from "./components/AddTransactionDialog.jsx";
import { AskLedgerCard } from "./components/AskLedgerCard.jsx";
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
  // false = closed; "form" = Add transaction; "quick" = Quick add (✨ Fill box first)
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
        setAdding("form");
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
        <div className="topbar-actions">
          <button
            type="button"
            className="button-secondary"
            onClick={() => setAdding("quick")}
            aria-label="Quick add: type or speak a transaction"
          >
            <span aria-hidden="true">🎙</span>
            <span className="hide-on-phone" aria-hidden="true">
              Quick add
            </span>
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => setAdding("form")}
            aria-keyshortcuts="n"
          >
            <span aria-hidden="true">+</span> Add transaction
            <kbd aria-hidden="true">N</kbd>
          </button>
        </div>
      </header>

      <main>
        <SummaryCards
          month={month}
          accountCount={accounts ? accounts.length : null}
          version={dataVersion}
        />

        <AskLedgerCard />

        <div className="layout">
          <div className="stack">
            <AccountList accounts={accounts} error={accountsError} />
            <BudgetList month={month} version={dataVersion} />
          </div>
          <TransactionList
            accounts={accounts ?? []}
            version={dataVersion}
            onAdd={() => setAdding("form")}
          />
        </div>
      </main>

      <AddTransactionDialog
        open={adding !== false}
        startWith={adding}
        onClose={() => setAdding(false)}
        accounts={accounts ?? []}
        onSaved={(message, { keepOpen = false } = {}) => {
          if (!keepOpen) setAdding(false); // stays open while queued drafts remain
          setToast(message);
          setDataVersion((v) => v + 1);
        }}
      />
      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}
