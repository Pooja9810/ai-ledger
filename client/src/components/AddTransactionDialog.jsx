import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import {
  formatSignedCents,
  parseDollarsToCents,
  todayLocal,
} from "../format.js";
import {
  nextCategoryId,
  suggestionLabel,
  suggestionRequestKey,
} from "../suggestions.js";
import { draftNote, draftToFields, fillErrorMessage } from "../draft.js";

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

  // Category suggestion (history or AI). See suggestions.js for the rules.
  const [suggestion, setSuggestion] = useState(null); // { id, name, source }
  const [suggesting, setSuggesting] = useState(false);
  const lastKeyRef = useRef(null); // key of the latest request
  const autoFilledRef = useRef(null); // category value WE filled in, if any

  // "✨ Fill" from a sentence. See draft.js for the rules.
  const [quickText, setQuickText] = useState("");
  const [filling, setFilling] = useState(false);
  const [fillStatus, setFillStatus] = useState(null); // { type: "note" | "error", text }
  const fillIdRef = useRef(0); // bumps on every request/close, so late answers are ignored
  const amountRef = useRef(null);
  const accountRef = useRef(null);

  // Sync React's `open` prop with the browser's dialog (an external system,
  // which is exactly what effects are for).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const matchingCategories = (categories ?? []).filter((c) => c.kind === kind);

  function resetSuggestion() {
    lastKeyRef.current = null; // also makes any in-flight answer stale
    autoFilledRef.current = null;
    setSuggestion(null);
    setSuggesting(false);
  }

  function resetFill() {
    fillIdRef.current += 1; // makes any in-flight fill stale
    setQuickText("");
    setFilling(false);
    setFillStatus(null);
  }

  function close() {
    setErrors([]);
    resetSuggestion();
    resetFill();
    onClose();
  }

  // "✨ Fill": turn the sentence into a draft and apply it to the form.
  async function fillFromText() {
    const text = quickText.trim();
    if (text === "" || filling) return;

    const requestId = ++fillIdRef.current;
    setFilling(true);
    setFillStatus(null);
    let draft;
    try {
      ({ draft } = await api("/ai/parse-transaction", {
        method: "POST",
        body: { text, today: todayLocal() },
      }));
    } catch (err) {
      if (requestId !== fillIdRef.current) return; // closed meanwhile
      setFilling(false);
      // The user clicked a button, so tell them what went wrong.
      setFillStatus({ type: "error", text: fillErrorMessage(err) });
      return;
    }
    if (requestId !== fillIdRef.current) return; // closed meanwhile

    const fields = draftToFields(draft, {
      currentKind: kind,
      currentCategoryId: categoryId,
    });
    resetSuggestion();
    setKind(fields.kind);
    if (fields.amount !== undefined) setAmount(fields.amount);
    if (fields.date !== undefined) setDate(fields.date);
    if (fields.description !== undefined) setDescription(fields.description);
    if (fields.categoryId !== undefined) setCategoryId(fields.categoryId);
    if (draft.category) {
      // Show the same ✨ hint as auto-categorize, and let a later
      // suggestion replace it (it's ours, not the user's choice).
      autoFilledRef.current = String(draft.category.id);
      setSuggestion({ ...draft.category, source: draft.category_source });
    }

    // Don't ask /categorize again on blur for what we just filled.
    const cents = parseDollarsToCents(fields.amount ?? amount);
    lastKeyRef.current = suggestionRequestKey({
      description: fields.description ?? description,
      signedCents: cents ? (fields.kind === "expense" ? -cents : cents) : null,
      lastKey: null,
    });

    setFilling(false);
    setQuickText("");
    const note = draftNote(draft);
    setFillStatus(note ? { type: "note", text: note } : null);
    // Move to the first thing still needed.
    (fields.amount === undefined ? amountRef : accountRef).current?.focus();
  }

  // Runs when the description (or amount) field loses focus.
  async function requestSuggestion() {
    const cents = parseDollarsToCents(amount);
    const signedCents = cents ? (kind === "expense" ? -cents : cents) : null;
    const key = suggestionRequestKey({
      description,
      signedCents,
      lastKey: lastKeyRef.current,
    });
    if (!key) return;

    lastKeyRef.current = key;
    setSuggesting(true);
    let result = null;
    try {
      result = await api("/ai/categorize", {
        method: "POST",
        body: { description: description.trim(), amount_cents: signedCents },
      });
    } catch {
      // Optional helper: on any failure (no AI key, AI down, offline)
      // stay quiet and leave the form fully usable.
    }
    if (lastKeyRef.current !== key) return; // user changed something; stale

    setSuggesting(false);
    const next = result?.suggestion
      ? { ...result.suggestion, source: result.source }
      : null;
    const autoFilledId = autoFilledRef.current; // read before updating below
    setCategoryId((currentId) =>
      nextCategoryId({ currentId, autoFilledId, suggestion: next }),
    );
    autoFilledRef.current = next ? String(next.id) : null;
    setSuggestion(next);
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
      resetSuggestion();
      resetFill();
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

        {/* Natural-language entry: describe it, and the AI fills the form for review. */}
        <div className="quick-fill">
          <label htmlFor="quick-fill-input" className="visually-hidden">
            Describe the transaction
          </label>
          <div className="quick-fill-row">
            <input
              id="quick-fill-input"
              placeholder="“lunch 12.50 yesterday”"
              value={quickText}
              maxLength={500}
              onChange={(e) => setQuickText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault(); // fill, don't submit the whole form
                  fillFromText();
                }
              }}
            />
            <button
              type="button"
              className="button-secondary"
              onClick={fillFromText}
              disabled={filling || quickText.trim() === ""}
            >
              {filling ? "Filling…" : "✨ Fill"}
            </button>
          </div>
          {fillStatus && (
            <span
              className={`field-hint${fillStatus.type === "error" ? " is-error" : ""}`}
              role={fillStatus.type === "error" ? "alert" : "status"}
            >
              {fillStatus.type === "error" ? "⚠ " : "ℹ "}
              {fillStatus.text}
            </span>
          )}
        </div>

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
                resetSuggestion(); // expense vs income changes the candidates
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
            ref={amountRef}
            autoFocus
            inputMode="decimal"
            placeholder="0.00"
            // Grow with the amount so $1,000+ isn't clipped (4–12 characters).
            style={{
              width: `${Math.min(Math.max(amount.length, 4), 12) + 0.5}ch`,
            }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={requestSuggestion} // in case the description came first
          />
        </label>

        <label>
          Description
          <input
            placeholder="e.g. Trader Joe's"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={requestSuggestion}
          />
        </label>

        <div className="field-pair">
          <label>
            Account
            <select
              ref={accountRef}
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
          {/* aria-live: screen readers announce the hint when it appears */}
          <span className="field-hint" aria-live="polite">
            {suggesting
              ? "Suggesting a category…"
              : suggestion && categoryId === String(suggestion.id)
                ? suggestionLabel(suggestion.source)
                : null}
          </span>
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
