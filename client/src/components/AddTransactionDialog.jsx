import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import {
  formatSignedCents,
  parseDollarsToCents,
  todayLocal,
} from "../format.js";

/**
 * A native <dialog>: focus is trapped inside, Esc closes it, and focus goes
 * back to the button that opened it. All for free from the browser.
 *
 * Props:
 *   open     – whether the dialog is showing
 *   onClose  – called when the user closes it
 *   accounts – list of accounts for the dropdown
 *   onSaved  – called with a confirmation message after a successful save
 */
export function AddTransactionDialog({ open, onClose, accounts, onSaved }) {
  const dialogRef = useRef(null);
  const { data: categories } = useApi("/categories");

  const [kind, setKind] = useState("expense");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayLocal);
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);

  // Sync React's `open` prop with the browser's dialog (an external system,
  // which is exactly what effects are for).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const matchingCategories = (categories ?? []).filter((c) => c.kind === kind);

  function close() {
    setErrors([]);
    onClose();
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const cents = parseDollarsToCents(amount);
    const problems = [];
    if (cents === null || cents === 0)
      problems.push("Enter an amount like 12.50");
    if (!accountId) problems.push("Choose an account");
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }

    const signedCents = kind === "expense" ? -cents : cents;
    setSaving(true);
    setErrors([]);
    try {
      await api("/transactions", {
        method: "POST",
        body: {
          account_id: Number(accountId),
          category_id: categoryId ? Number(categoryId) : null,
          date,
          amount_cents: signedCents,
          description,
        },
      });
      const label = description.trim() || "Transaction";
      setAmount("");
      setDescription("");
      setCategoryId("");
      onSaved(`Added ${label} · ${formatSignedCents(signedCents)}`);
    } catch (err) {
      setErrors(err.errors.length > 0 ? err.errors : [err.message]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="add-title"
      onClose={close} // fires on Esc too
      onClick={(e) => {
        if (e.target === dialogRef.current) close(); // click on the backdrop
      }}
    >
      <form className="form" onSubmit={handleSubmit} noValidate>
        <header className="dialog-header">
          <h2 id="add-title">Add transaction</h2>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="segmented" role="radiogroup" aria-label="Type">
          {["expense", "income"].map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              className={kind === option ? "active" : ""}
              onClick={() => {
                setKind(option);
                setCategoryId("");
              }}
            >
              {option === "expense" ? "Expense" : "Income"}
            </button>
          ))}
        </div>

        {/* The amount is the one thing you always change, so it's big and focused first. */}
        <label className="amount-field">
          <span className="visually-hidden">Amount in dollars</span>
          <span className="amount-prefix" aria-hidden="true">
            {kind === "expense" ? "−$" : "+$"}
          </span>
          <input
            autoFocus
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <label>
          Description
          <input
            placeholder="e.g. Trader Joe's"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="field-pair">
          <label>
            Account
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Choose…</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>

        <label>
          Category
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Uncategorized</option>
            {matchingCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        {errors.length > 0 && (
          <ul className="form-errors" role="alert">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}

        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={saving}>
            {saving ? "Saving…" : "Add transaction"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
