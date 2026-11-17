import { useCallback, useEffect, useState } from "react";
import { AccountList } from "./components/AccountList.jsx";
import { AddTransactionDialog } from "./components/AddTransactionDialog.jsx";
import { AskLedgerCard } from "./components/AskLedgerCard.jsx";
import { InsightsCard } from "./components/InsightsCard.jsx";
import { ImportDialog } from "./components/ImportDialog.jsx";
import { BudgetsScreen } from "./components/BudgetList.jsx";
import { HomeScreen } from "./components/HomeScreen.jsx";
import { MicIcon, PlusIcon } from "./components/Icons.jsx";
import { TabNav, ThemeToggle } from "./components/Navigation.jsx";
import { TransactionList } from "./components/TransactionList.jsx";
import { WelcomeCard } from "./components/WelcomeCard.jsx";
import { Logo, Toast } from "./components/ui.jsx";
import { api } from "./api.js";
import { rowLabel, undoRequest } from "./editing.js";
import { todayLocal } from "./format.js";
import { TABS, tabFromHash } from "./tabs.js";
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

  // Which screen: read from the address (#budgets), so Back/Forward and
  // shared links work. Changing tabs is just following a link.
  const [tab, setTab] = useState(() => tabFromHash(window.location.hash));
  useEffect(() => {
    const onHashChange = () => {
      setTab(tabFromHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  useEffect(() => {
    const label = TABS.find((t) => t.id === tab).label;
    document.title = tab === "home" ? "Ledgerly" : `${label} · Ledgerly`;
  }, [tab]);

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
  // Is this the public demo? (Then say so: changes reset every hour.)
  const { data: config } = useApi("/config");
  const { data: accounts, error: accountsError } = useApi(
    "/accounts",
    dataVersion,
  );
  const { data: summary } = useApi(`/summary?month=${month}`, dataVersion);

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
      {config?.demo && (
        <p className="demo-banner" role="note">
          <span aria-hidden="true">ℹ</span> Demo with made-up data · your
          changes reset every{" "}
          {config.resets_every_minutes === 60
            ? "hour"
            : `${config.resets_every_minutes} minutes`}
        </p>
      )}
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Ledgerly home">
          <Logo />
          <span aria-hidden="true">Ledgerly</span>
        </a>
        <TabNav current={tab} variant="top" />
        <div className="topbar-actions">
          <ThemeToggle />
          <button
            type="button"
            className="button-secondary"
            onClick={() => setAdding("quick")}
            aria-label="Quick add: type or speak a transaction"
          >
            <MicIcon size={16} />
            <span className="hide-on-phone" aria-hidden="true">
              Quick add
            </span>
          </button>
          <button
            type="button"
            className="button-primary only-wide"
            onClick={() => setAdding("form")}
            aria-keyshortcuts="n"
          >
            <PlusIcon size={16} /> Add transaction
            <kbd aria-hidden="true">N</kbd>
          </button>
        </div>
      </header>

      {/* Every screen stays mounted and is only hidden, so an Ask
          conversation or a transaction filter survives switching tabs. */}
      <main>
        <div className="screen" hidden={tab !== "home"}>
          <h1 className="visually-hidden">Home</h1>
          <HomeScreen
            version={dataVersion}
            onEdit={startEdit}
            welcome={
              config?.demo && (
                <WelcomeCard
                  onQuickAdd={() => setAdding("quick")}
                  onImport={() => setImporting(true)}
                />
              )
            }
          />
        </div>

        <div className="screen" hidden={tab !== "transactions"}>
          <h1 className="visually-hidden">Transactions</h1>
          <div className="layout">
            <AccountList
              accounts={accounts}
              error={accountsError}
              netWorth={summary ? summary.net_worth_cents : null}
            />
            <TransactionList
              accounts={accounts ?? []}
              version={dataVersion}
              onAdd={() => setAdding("form")}
              onImport={() => setImporting(true)}
              onEdit={startEdit}
            />
          </div>
        </div>

        <div className="screen" hidden={tab !== "budgets"}>
          <BudgetsScreen month={month} version={dataVersion} />
        </div>

        <div className="screen" hidden={tab !== "ask"}>
          <h1 className="visually-hidden">Ask your ledger</h1>
          <div className="ask-layout">
            <AskLedgerCard />
            <InsightsCard version={dataVersion} />
          </div>
        </div>
      </main>

      {/* Phones: a round + for the most common action, and the tab bar. */}
      <button
        type="button"
        className="fab"
        onClick={() => setAdding("form")}
        aria-label="Add a transaction"
      >
        <PlusIcon size={26} />
      </button>
      <TabNav current={tab} variant="bottom" />

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
