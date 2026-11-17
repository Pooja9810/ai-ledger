import { useCallback, useEffect, useState } from "react";
import { AccountList } from "./components/AccountList.jsx";
import { AddTransactionDialog } from "./components/AddTransactionDialog.jsx";
import { AskLedgerCard } from "./components/AskLedgerCard.jsx";
import { InsightsCard } from "./components/InsightsCard.jsx";
import { ImportDialog } from "./components/ImportDialog.jsx";
import { BudgetList } from "./components/BudgetList.jsx";
import { SummaryCards } from "./components/SummaryCards.jsx";
import { TransactionList } from "./components/TransactionList.jsx";
import { Logo, Toast } from "./components/ui.jsx";
import { api } from "./api.js";
import { rowLabel, undoRequest } from "./editing.js";
import { todayLocal } from "./format.js";
import { useApi } from "./hooks/useApi.js";
import "./App.css";

export default function App() {
  // Bumped after every change, so every component re-fetches fresh data
  // from the server (the single source of truth for balances).
  const [dataVersion, setDataVersion] = useState(0);
  // false = closed; "form" = Add transaction; "quick" = Quick add (✨ Fill box first)
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // { transaction, transfer } being edited, or null.
  const [editing, setEditing] = useState(null);
  // A plain message, or { message, action: { label, onClick } } (e.g. Undo).
  const [toast, setToast] = useState("");
  const clearToast = useCallback(() => setToast(""), []);
  const refresh = () => setDataVersion((v) => v + 1);

  // Click a row: a transfer half edits the whole transfer, so load it first.
  async function startEdit(transaction) {
    try {
      const transfer = transaction.transfer_id
        ? await api(`/transfers/${transaction.transfer_id}`)
        : null;
      setEditing({ transaction, transfer });
    } catch {
      setToast("Couldn't open that transaction; try again");
    }
  }

  // Deleted already (balances update now); Undo puts it back with a new id.
  function afterDelete({ transaction, transfer }) {
    setEditing(null);
    refresh();
    const label = rowLabel(transaction, transfer);
    setToast({
      message: `Deleted ${label}`,
      action: {
        label: "Undo",
        onClick: async () => {
          const { path, body } = undoRequest(transaction, transfer);
          try {
            await api(path, { method: "POST", body });
            setToast(`Restored ${label}`);
          } catch {
            setToast("Couldn't undo; add it again if you need it");
          }
          refresh();
        },
      },
    });
  }

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

        <InsightsCard version={dataVersion} />
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
            onImport={() => setImporting(true)}
            onEdit={startEdit}
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
      <ImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        accounts={accounts ?? []}
        onImported={(message) => {
          setImporting(false);
          setToast(message);
          setDataVersion((v) => v + 1);
        }}
      />
      {/* Editing gets its own dialog, keyed per row, so each edit starts fresh. */}
      {editing && (
        <AddTransactionDialog
          key={`edit-${editing.transaction.id}`}
          open
          editing={editing}
          onClose={() => setEditing(null)}
          accounts={accounts ?? []}
          onSaved={(message) => {
            setEditing(null);
            setToast(message);
            refresh();
          }}
          onDeleted={afterDelete}
        />
      )}
      <Toast
        message={typeof toast === "string" ? toast : toast.message}
        action={typeof toast === "string" ? null : toast.action}
        onDone={clearToast}
      />
    </div>
  );
}
