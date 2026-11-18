import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import {
  formatDate,
  formatSignedCents,
  parseDollarsToCents,
  todayLocal,
} from "../format.js";
import {
  nextCategoryId,
  suggestionLabel,
  suggestionRequestKey,
} from "../suggestions.js";
import {
  draftNote,
  draftToFields,
  fillErrorMessage,
  findLikelyDuplicate,
  nextFocus,
  queueNote,
} from "../draft.js";
import { getSpeechRecognition, startListening } from "../speech.js";
import { transferProblems, transferSavedMessage } from "../transfer.js";
import { imageFileProblem, shrinkImage } from "../image.js";
import {
  defaultAccountId,
  readLastAccount,
  rememberAccount,
} from "../accounts.js";
import {
  canDelete,
  editRequest,
  rowLabel,
  rowType,
  transactionToFields,
} from "../editing.js";

/**
 * A native <dialog>: focus is trapped inside, Esc closes it, and focus goes
 * back to the button that opened it. All for free from the browser.
 *
 * Props:
 *   open     – whether the dialog is showing
 *   onClose  – called when the user closes it
 *   accounts – list of accounts for the dropdown
 *   onSaved  – called with a confirmation message after a successful save
 *   startWith – "quick" focuses the ✨ Fill box (Quick add); otherwise the amount
 *   editing   – { transaction, transfer } to edit a saved row instead of adding.
 *               App gives each edit its own `key`, so the form starts fresh.
 *   onDeleted – called with { transaction, transfer } after a delete (editing only)
 */
export function AddTransactionDialog({
  open,
  onClose,
  accounts,
  onSaved,
  startWith,
  editing = null,
  onDeleted,
}) {
  const dialogRef = useRef(null);
  const { data: categories } = useApi("/categories");

  // Editing: start from the saved row (computed once; see `editing` above).
  const [initial] = useState(() =>
    editing ? transactionToFields(editing.transaction, editing.transfer) : null,
  );
  const type = editing ? rowType(editing.transaction) : null; // normal | transfer | opening
  const [kind, setKind] = useState(initial?.kind ?? "expense");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [date, setDate] = useState(initial?.date ?? todayLocal);
  const [accountId, setAccountId] = useState(initial?.accountId ?? ""); // "From" when it's a transfer
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? ""); // transfers only
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  // A saved transaction that looks like the one being added (warn, don't
  // block), remembered with the form values it was about: { match, key }.
  const [duplicateWarning, setDuplicateWarning] = useState(null);

  // Category suggestion (history or AI). See suggestions.js for the rules.
  const [suggestion, setSuggestion] = useState(null); // { id, name, source }
  const [suggesting, setSuggesting] = useState(false);
  // Key of the latest request. When editing, start with the saved values'
  // key, so we only ask again if the description or amount actually change.
  const lastKeyRef = useRef(
    editing
      ? suggestionRequestKey({
          description: editing.transaction.description ?? "",
          signedCents: editing.transaction.amount_cents,
          lastKey: null,
        })
      : null,
  );
  const autoFilledRef = useRef(null); // category value WE filled in, if any

  // "✨ Fill" from a sentence. See draft.js for the rules.
  const [quickText, setQuickText] = useState("");
  const [filling, setFilling] = useState(false);
  const [fillStatus, setFillStatus] = useState(null); // { type: "note" | "error", text }
  const fillIdRef = useRef(0); // bumps on every request/close, so late answers are ignored
  const amountRef = useRef(null);
  const accountRef = useRef(null);
  const quickInputRef = useRef(null);
  const photoInputRef = useRef(null); // hidden <input type="file"> behind 📷
  const [scanning, setScanning] = useState(false); // reading a receipt photo
  const submitRef = useRef(null);
  // More drafts from the same note, waiting to fill in after each save.
  const [queue, setQueue] = useState([]);

  // 🎙 Voice input (browser speech recognition). null = unsupported (e.g. Firefox).
  const [Recognition] = useState(() => getSpeechRecognition());
  const [listening, setListening] = useState(false);
  const listenRef = useRef(null); // { stop, abort } while listening
  // Speech ends later, in a callback created when listening started. This ref
  // always points at the latest fillFromText, so it never sees stale form values.
  const fillFromTextRef = useRef(null);

  // Sync React's `open` prop with the browser's dialog (an external system,
  // which is exactly what effects are for).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) {
      dialog.showModal();
      if (startWith === "quick" || startWith?.mode === "quick") {
        quickInputRef.current?.focus();
      }
    }
    if (!open && dialog.open) dialog.close();
  }, [open, startWith]);

  // New transactions start on the account used last time (or the first
  // one), so an AI-filled draft can be saved straight away. Accounts may
  // load after the dialog opens, hence `accounts` in the dependencies.
  // Editing keeps the saved row's own account.
  useEffect(() => {
    if (!open || editing || accountId !== "") return;
    const id = defaultAccountId(accounts, readLastAccount());
    if (id) setAccountId(id);
  }, [open, editing, accounts, accountId]);

  // Opened from Home's "Add with AI" bar with a sentence already typed:
  // run ✨ Fill on it once, exactly as if it had been typed in here.
  // The ref remembers which request we handled, so a re-render never
  // fills twice.
  const handledStartRef = useRef(null);
  useEffect(() => {
    if (!open || !startWith?.text) return;
    if (handledStartRef.current === startWith) return;
    handledStartRef.current = startWith;
    setQuickText(startWith.text);
    fillFromText(startWith.text);
    // fillFromText is a plain function recreated each render; listing it
    // would re-run this effect constantly, and the ref check covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startWith]);

  // Categories for this kind, plus the saved one when editing (a refund
  // filed under Groceries is positive, but Groceries must still show).
  const matchingCategories = (categories ?? []).filter(
    (c) =>
      c.kind === kind ||
      (c.kind !== "transfer" && String(c.id) === initial?.categoryId),
  );

  function resetSuggestion() {
    lastKeyRef.current = null; // also makes any in-flight answer stale
    autoFilledRef.current = null;
    setSuggestion(null);
    setSuggesting(false);
  }

  function resetFill() {
    fillIdRef.current += 1; // makes any in-flight fill or listening stale
    listenRef.current?.abort();
    listenRef.current = null;
    setListening(false);
    setQuickText("");
    setFilling(false);
    setFillStatus(null);
    setQueue([]);
  }

  function close() {
    setErrors([]);
    resetSuggestion();
    resetFill();
    onClose();
  }

  // 🎙 Start or stop voice input. Words stream into the Fill box; when the
  // speaker pauses, we fill the form from what was said (no extra click).
  function toggleListening() {
    if (listening) {
      listenRef.current?.stop(); // finish now and keep the words
      return;
    }
    const token = ++fillIdRef.current; // closing the dialog makes this stale
    setFillStatus(null);
    setQuickText("");
    try {
      listenRef.current = startListening(Recognition, {
        lang: navigator.language,
        onText: (text) => {
          if (token === fillIdRef.current) setQuickText(text);
        },
        onError: (message) => {
          if (token === fillIdRef.current) {
            setFillStatus({ type: "error", text: message });
          }
        },
        onEnd: (text) => {
          if (token !== fillIdRef.current) return; // dialog closed meanwhile
          listenRef.current = null;
          setListening(false);
          if (text) fillFromTextRef.current(text);
        },
      });
      setListening(true);
    } catch {
      setFillStatus({
        type: "error",
        text: "Voice input couldn't start; try again or type instead",
      });
    }
  }

  // "✨ Fill": turn the sentence into a draft and apply it to the form.
  // Called with the spoken text, or (from the button/Enter) uses the box.
  // "✨ Fill": turn the sentence into drafts and apply them to the form.
  // Called with the spoken text, or (from the button/Enter) uses the box.
  async function fillFromText(spokenText) {
    const text = (
      typeof spokenText === "string" ? spokenText : quickText
    ).trim();
    if (text === "" || filling) return;
    const filled = await fillFrom(
      () =>
        api("/ai/parse-transaction", {
          method: "POST",
          body: { text, today: todayLocal() },
        }),
      "Couldn't find a transaction in that; try adding a place or an amount",
    );
    if (filled) setQuickText("");
  }

  // "📷": read a receipt photo into drafts. The photo is shrunk in the
  // browser first (~300 KB) and never stored.
  async function scanPhoto(file) {
    if (!file || filling) return;
    const problem = imageFileProblem(file);
    if (problem) {
      setFillStatus({ type: "error", text: problem });
      return;
    }
    setScanning(true);
    await fillFrom(async () => {
      let image;
      try {
        image = await shrinkImage(file);
      } catch (err) {
        throw Object.assign(new Error(err.message), {
          userMessage: err.message,
        });
      }
      return api("/ai/scan-receipt", {
        method: "POST",
        body: { image, today: todayLocal() },
      });
    }, "Couldn't read a receipt in that photo; try a flatter, brighter photo");
    setScanning(false);
  }

  /**
   * Shared by Fill and 📷: run `request` (which resolves to { drafts }),
   * then put the first draft in the form and queue the rest.
   * @returns true if the form was filled
   */
  async function fillFrom(request, emptyNote) {
    const requestId = ++fillIdRef.current;
    setFilling(true);
    setFillStatus(null);
    let drafts;
    try {
      ({ drafts } = await request());
    } catch (err) {
      if (requestId !== fillIdRef.current) return false; // closed meanwhile
      setFilling(false);
      // The user clicked a button, so tell them what went wrong.
      setFillStatus({
        type: "error",
        text: err.userMessage ?? fillErrorMessage(err),
      });
      return false;
    }
    if (requestId !== fillIdRef.current) return false; // closed meanwhile

    setFilling(false);
    if (drafts.length === 0) {
      setFillStatus({ type: "note", text: emptyNote });
      return false;
    }
    const [first, ...rest] = drafts;
    applyDraft(first, {
      currentKind: kind,
      currentCategoryId: categoryId,
      currentAmount: amount,
      currentDescription: description,
    });
    setQueue(rest);
    return true;
  }

  /**
   * Put one draft into the form. Used for the first draft after ✨ Fill and
   * for each queued draft after a save, so both behave exactly the same.
   * The current* values describe the form as it will be when this applies
   * (after a save they're the cleared values, not the stale state).
   */
  function applyDraft(
    draft,
    { currentKind, currentCategoryId, currentAmount, currentDescription },
  ) {
    const fields = draftToFields(draft, { currentKind, currentCategoryId });
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
    const finalAmount = fields.amount ?? currentAmount;
    const cents = parseDollarsToCents(finalAmount);
    lastKeyRef.current = suggestionRequestKey({
      description: fields.description ?? currentDescription,
      signedCents: cents ? (fields.kind === "expense" ? -cents : cents) : null,
      lastKey: null,
    });

    const note = draftNote(draft);
    setFillStatus(note ? { type: "note", text: note } : null);

    // Move to the first thing still needed (after React renders the values).
    const target = nextFocus({
      hasAmount: Boolean(cents),
      hasAccount: accountId !== "",
    });
    const ref = { amount: amountRef, account: accountRef, submit: submitRef }[
      target
    ];
    requestAnimationFrame(() => ref.current?.focus());
  }

  // Runs when the description (or amount) field loses focus.
  async function requestSuggestion() {
    if (kind === "transfer" || type === "opening") return; // no category to suggest
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

  useEffect(() => {
    fillFromTextRef.current = fillFromText;
  });

  // DERIVED, not cleared in an effect: the warning only shows while the
  // form still describes the same transaction it was about.
  const formKey = [amount, date, description, kind, accountId].join("|");
  const duplicate =
    duplicateWarning?.key === formKey ? duplicateWarning.match : null;

  /**
   * Save. allowDuplicate = the user clicked "Add anyway" on the
   * possible-duplicate warning.
   */
  async function handleSubmit(event, { allowDuplicate = false } = {}) {
    event?.preventDefault();
    if (editing) return saveEdit();
    if (kind === "transfer") return saveTransfer();

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

    // Already in the ledger? (e.g. the same receipt scanned twice.) Ask
    // instead of saving; identical same-day purchases can be real.
    if (!allowDuplicate) {
      try {
        const sameDay = await api(`/transactions?from=${date}&to=${date}`);
        const match = findLikelyDuplicate(
          { date, amount_cents: signedCents, description },
          sameDay,
        );
        if (match) {
          setDuplicateWarning({ match, key: formKey });
          setSaving(false);
          return;
        }
      } catch {
        // If the check itself fails, don't stop the user from saving.
      }
    }
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
      rememberAccount(accountId); // next new transaction starts here
      const label = description.trim() || "Transaction";
      const [next, ...rest] = queue; // read before resetFill() clears it
      setAmount("");
      setDescription("");
      setCategoryId("");
      resetSuggestion();
      resetFill();
      if (next) {
        // More from the same note: fill the next one; account and date carry over.
        applyDraft(next, {
          currentKind: kind,
          currentCategoryId: "",
          currentAmount: "",
          currentDescription: "",
        });
        setQueue(rest);
      }
      onSaved(`Added ${label} · ${formatSignedCents(signedCents)}`, {
        keepOpen: Boolean(next),
      });
    } catch (err) {
      setErrors(err.errors.length > 0 ? err.errors : [err.message]);
    } finally {
      setSaving(false);
    }
  }

  // A transfer is saved as a pair (out of one account, into another) by
  // /api/transfers; it has no category, so reports don't count it.
  async function saveTransfer() {
    const cents = parseDollarsToCents(amount);
    const problems = transferProblems({
      cents,
      fromId: accountId,
      toId: toAccountId,
    });
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      const transfer = await api("/transfers", {
        method: "POST",
        body: {
          from_account_id: Number(accountId),
          to_account_id: Number(toAccountId),
          amount_cents: cents,
          date,
          // empty → the server writes "Transfer: From → To"
          ...(description.trim() ? { description: description.trim() } : {}),
        },
      });
      setAmount("");
      setDescription("");
      resetSuggestion();
      resetFill();
      onSaved(transferSavedMessage(transfer));
    } catch (err) {
      setErrors(err.errors.length > 0 ? err.errors : [err.message]);
    } finally {
      setSaving(false);
    }
  }

  // Save an edit: PATCH only what changed (transfers via /api/transfers).
  async function saveEdit() {
    const cents = parseDollarsToCents(amount);
    const problems =
      type === "transfer"
        ? transferProblems({ cents, fromId: accountId, toId: toAccountId })
        : [
            ...(cents ? [] : ["Enter an amount like 12.50"]),
            ...(accountId ? [] : ["Choose an account"]),
          ];
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    const request = editRequest(
      { kind, amount, description, date, accountId, toAccountId, categoryId },
      editing.transaction,
      editing.transfer,
    );
    if (!request) return close(); // nothing changed
    setSaving(true);
    setErrors([]);
    try {
      const saved = await api(request.path, {
        method: "PATCH",
        body: request.body,
      });
      onSaved(
        `Saved ${type === "transfer" ? rowLabel(null, saved) : rowLabel(saved)}`,
      );
    } catch (err) {
      setErrors(err.errors.length > 0 ? err.errors : [err.message]);
    } finally {
      setSaving(false);
    }
  }

  // Delete right away; App's toast offers Undo (which re-creates it).
  async function handleDelete() {
    const { transaction, transfer } = editing;
    setSaving(true);
    setErrors([]);
    try {
      await api(
        transfer
          ? `/transfers/${transfer.id}`
          : `/transactions/${transaction.id}`,
        { method: "DELETE" },
      );
      onDeleted({ transaction, transfer });
    } catch (err) {
      setErrors([err.message]);
      setSaving(false);
    }
  }

  const isTransfer = kind === "transfer";
  const accountOptions = accounts.map((account) => (
    <option key={account.id} value={account.id}>
      {account.name}
    </option>
  ));
  const dateField = (
    <label>
      Date
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
    </label>
  );

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
          <h2 id="add-title">
            {editing
              ? type === "transfer"
                ? "Edit transfer"
                : "Edit transaction"
              : "Add transaction"}
          </h2>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {/* Natural-language entry: describe it, and the AI fills the form for review.
            Only when adding: an edit starts from a saved row. */}
        {!editing && (
          <div className="quick-fill">
            <label htmlFor="quick-fill-input" className="visually-hidden">
              Describe the transaction
            </label>
            <div className="quick-fill-row">
              <input
                ref={quickInputRef}
                id="quick-fill-input"
                placeholder="“lunch 12.50 yesterday”"
                value={quickText}
                readOnly={listening} // the transcript is streaming in
                maxLength={500}
                onChange={(e) => setQuickText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault(); // fill, don't submit the whole form
                    fillFromText();
                  }
                }}
              />
              {Recognition && (
                <button
                  type="button"
                  className={`button-secondary mic-button${listening ? " is-listening" : ""}`}
                  onClick={toggleListening}
                  disabled={filling}
                  aria-pressed={listening}
                  aria-label={
                    listening ? "Stop listening" : "Speak instead of typing"
                  }
                  title={
                    listening ? "Stop listening" : "Speak instead of typing"
                  }
                >
                  <span aria-hidden="true">{listening ? "■" : "🎙"}</span>
                </button>
              )}
              {/* 📷 opens the camera on phones (capture), a file picker elsewhere. */}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  scanPhoto(e.target.files?.[0]);
                  e.target.value = ""; // so the same photo can be chosen again
                }}
              />
              <button
                type="button"
                className="button-secondary mic-button"
                onClick={() => photoInputRef.current?.click()}
                disabled={filling || listening}
                aria-label="Scan a receipt photo"
                title="Scan a receipt photo"
              >
                <span aria-hidden="true">📷</span>
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={fillFromText}
                disabled={filling || listening || quickText.trim() === ""}
                aria-label={
                  filling ? "Filling" : "Fill the form from this text"
                }
              >
                {/* On phones only ✨ shows, so 🎙 and 📷 fit (aria-label keeps the name). */}
                <span aria-hidden="true">{filling ? "…" : "✨"}</span>
                <span className="hide-on-phone" aria-hidden="true">
                  {filling ? "Filling" : "Fill"}
                </span>
              </button>
            </div>
            {listening && (
              <span className="field-hint" role="status">
                🎙 Listening… e.g. “bread at No Frills 4.99”
              </span>
            )}
            {scanning && filling && (
              <span className="field-hint" role="status">
                📷 Reading the receipt…
              </span>
            )}
            {queue.length > 0 && (
              <span className="field-hint" role="status">
                ⏭ {queueNote(queue)}
              </span>
            )}
            {!listening && fillStatus && (
              <span
                className={`field-hint${fillStatus.type === "error" ? " is-error" : ""}`}
                role={fillStatus.type === "error" ? "alert" : "status"}
              >
                {fillStatus.type === "error" ? "⚠ " : "ℹ "}
                {fillStatus.text}
              </span>
            )}
          </div>
        )}

        {/* Editing can switch expense ⇄ income, but not to or from a transfer
            (a different kind of record) or an opening balance. */}
        {type !== "transfer" && type !== "opening" && (
          <div className="segmented" role="radiogroup" aria-label="Type">
            {(editing
              ? ["expense", "income"]
              : ["expense", "income", "transfer"]
            ).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                className={kind === option ? "active" : ""}
                onClick={() => {
                  setKind(option);
                  setCategoryId("");
                  resetSuggestion(); // the kind changes the candidates
                }}
              >
                {
                  {
                    expense: "Expense",
                    income: "Income",
                    transfer: "Transfer",
                  }[option]
                }
              </button>
            ))}
          </div>
        )}

        {/* The amount is the one thing you always change, so it's big and focused first. */}
        <label className="amount-field">
          <span className="visually-hidden">Amount in dollars</span>
          <span className="amount-prefix" aria-hidden="true">
            {/* a transfer has no sign: it just moves money */}
            {{ expense: "−$", income: "+$", transfer: "$" }[kind]}
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
            placeholder={
              isTransfer ? "e.g. Visa payment (optional)" : "e.g. No Frills"
            }
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={requestSuggestion}
          />
        </label>

        {isTransfer ? (
          <>
            <div className="field-pair">
              <label>
                From
                <select
                  ref={accountRef}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {accountOptions}
                </select>
              </label>
              <label>
                To
                <select
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {accountOptions}
                </select>
              </label>
            </div>
            {dateField}
            <p className="field-hint">
              ⇄ Moves money between your own accounts, e.g. paying a credit
              card. It isn't counted as spending or income.
            </p>
          </>
        ) : (
          <>
            <div className="field-pair">
              <label>
                Account
                <select
                  ref={accountRef}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {accountOptions}
                </select>
              </label>
              {dateField}
            </div>

            {type === "opening" ? (
              <p className="field-hint">
                Category: Opening balance. It sets where this account started,
                so it can be changed but not deleted.
              </p>
            ) : (
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
            )}
          </>
        )}

        {duplicate && (
          <p className="field-hint is-warning" role="alert">
            ⚠ Possible duplicate: {duplicate.description}{" "}
            <span className="nowrap">
              {formatSignedCents(duplicate.amount_cents)}
            </span>{" "}
            on {formatDate(duplicate.date)} is already in{" "}
            {duplicate.account_name}.{" "}
            <button
              type="button"
              className="link-button"
              onClick={() => handleSubmit(null, { allowDuplicate: true })}
              disabled={saving}
            >
              Add anyway
            </button>
          </p>
        )}

        {errors.length > 0 && (
          <ul className="form-errors" role="alert">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}

        <div className="dialog-actions">
          {editing && canDelete(editing.transaction) && (
            <button
              type="button"
              className="button-secondary dialog-delete"
              onClick={handleDelete}
              disabled={saving}
            >
              <span aria-hidden="true">🗑</span> Delete
            </button>
          )}
          <button type="button" className="button-secondary" onClick={close}>
            Cancel
          </button>
          <button
            ref={submitRef}
            type="submit"
            className="button-primary"
            disabled={saving}
          >
            {saving
              ? "Saving…"
              : editing
                ? "Save"
                : isTransfer
                  ? "Add transfer"
                  : "Add transaction"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
