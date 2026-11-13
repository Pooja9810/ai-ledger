import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import { formatDate, formatSignedCents } from "../format.js";
import {
  detectMapping,
  fileProblem,
  MAX_IMPORT_ROWS,
  describeMapping,
  isConfident,
  readCsv,
  suggestFlip,
  toTransactions,
} from "../csv.js";
import {
  aiStatusNote,
  buildImportRows,
  groupByMerchant,
  importSummary,
  initialChoices,
} from "../importer.js";
import { Skeleton } from "./ui.jsx";

const DATE_FORMATS = [
  ["YMD", "2026-11-09 (year first)"],
  ["MDY", "11/09/2026 (month first)"],
  ["DMY", "09/11/2026 (day first)"],
  ["TEXT", "Nov 9, 2026"],
];

/**
 * Import transactions from a bank CSV, in three steps:
 *   1. choose the account and file
 *   2. check the detected columns (with a live preview)
 *   3. review categories, one line per merchant, then import
 * The file is read in the browser; only the approved rows are sent.
 *
 * Props: open, onClose, accounts, onImported(message)
 */
export function ImportDialog({ open, onClose, accounts, onImported }) {
  const dialogRef = useRef(null);
  const { data: categories } = useApi("/categories");

  const [step, setStep] = useState(1);
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState(null); // { name, headers, rows, firstLine }
  const [fileError, setFileError] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [flipSign, setFlipSign] = useState(false);
  const [suggest, setSuggest] = useState(null); // { status, aiStatus, choices }
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  // True when detection was confident and the column screen was skipped.
  const [skippedColumns, setSkippedColumns] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // DERIVED from rows + mapping + flip: change a dropdown, the preview updates.
  const parsed = useMemo(
    () =>
      file && mapping && mapping.date !== null && mapping.dateFormat
        ? toTransactions(file.rows, mapping, {
            flipSign,
            firstLine: file.firstLine,
          })
        : { transactions: [], problems: [] },
    [file, mapping, flipSign],
  );
  const groups = useMemo(
    () => groupByMerchant(parsed.transactions),
    [parsed.transactions],
  );

  function reset() {
    setStep(1);
    setFile(null);
    setFileError(null);
    setMapping(null);
    setFlipSign(false);
    setSuggest(null);
    setImporting(false);
    setImportErrors([]);
    setSkippedColumns(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function chooseFile(chosen) {
    setFileError(null);
    if (!chosen) return;
    let text;
    try {
      text = await chosen.text();
    } catch {
      setFileError("Couldn't read that file");
      return;
    }
    const problem = fileProblem(chosen.name, text);
    if (problem) {
      setFile(null);
      setFileError(problem);
      return;
    }
    const { headers, rows, firstLine, hasHeader } = readCsv(text);
    const dataRows = rows.filter((r) => r.some((c) => c !== ""));
    if (dataRows.length === 0) {
      setFileError("That file has no transactions in it");
      return;
    }
    if (dataRows.length > MAX_IMPORT_ROWS) {
      setFileError(
        `That file has ${dataRows.length} rows; import at most ${MAX_IMPORT_ROWS} at a time`,
      );
      return;
    }
    const detected = detectMapping(headers, rows);
    const first = toTransactions(rows, detected, { firstLine });
    const flipSuggested = suggestFlip(first.transactions, detected);
    setFile({
      name: chosen.name,
      headers,
      rows,
      firstLine,
      hasHeader,
      flipSuggested,
    });
    setMapping(detected);
    setFlipSign(flipSuggested);
  }

  // Step 3: ask for category suggestions (history first, then AI batches).
  async function goToCategories() {
    setStep(3);
    setSuggest({ status: "loading" });
    try {
      const { suggestions, ai } = await api("/ai/categorize-batch", {
        method: "POST",
        body: {
          items: parsed.transactions.map((t) => ({
            description: t.description,
            amount_cents: t.amount_cents,
          })),
        },
      });
      setSuggest({
        status: "done",
        aiStatus: ai,
        choices: initialChoices(groups, suggestions),
      });
    } catch {
      // Suggestions are a helper: the user can still pick categories.
      setSuggest({
        status: "done",
        aiStatus: "failed",
        choices: initialChoices(groups),
      });
    }
  }

  function chooseCategory(groupKey, categoryId) {
    setSuggest((s) => ({
      ...s,
      choices: { ...s.choices, [groupKey]: { categoryId, source: null } },
    }));
  }

  async function runImport() {
    setImporting(true);
    setImportErrors([]);
    try {
      const result = await api("/transactions/import", {
        method: "POST",
        body: {
          account_id: Number(accountId),
          rows: buildImportRows(parsed.transactions, groups, suggest.choices),
        },
      });
      reset();
      onImported(importSummary(result));
    } catch (err) {
      setImporting(false);
      setImportErrors(err.errors?.length ? err.errors : [err.message]);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog dialog-wide"
      aria-labelledby="import-title"
      onClose={close}
      onClick={(e) => {
        if (e.target === dialogRef.current) close();
      }}
    >
      <div className="form">
        <header className="dialog-header">
          <h2 id="import-title">Import from CSV</h2>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <ol className="import-steps" aria-label="Steps">
          {["Choose file", "Check columns", "Categories"].map((label, i) => (
            <li
              key={label}
              aria-current={step === i + 1 ? "step" : undefined}
              className={step === i + 1 ? "active" : step > i + 1 ? "done" : ""}
            >
              <span aria-hidden="true">{step > i + 1 ? "✓" : i + 1}</span>{" "}
              {label}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <StepChoose
            accounts={accounts}
            accountId={accountId}
            setAccountId={setAccountId}
            file={file}
            fileError={fileError}
            onFile={chooseFile}
            onNext={() => {
              // Nothing was guessed? Skip "check columns" (Change brings it back).
              const confident = isConfident({
                mapping,
                hasHeader: file.hasHeader,
                problems: parsed.problems,
                flipSuggested: file.flipSuggested,
                count: parsed.transactions.length,
              });
              setSkippedColumns(confident);
              if (confident) goToCategories();
              else setStep(2);
            }}
            onCancel={close}
          />
        )}
        {step === 2 && (
          <StepColumns
            file={file}
            mapping={mapping}
            setMapping={setMapping}
            flipSign={flipSign}
            setFlipSign={setFlipSign}
            parsed={parsed}
            onBack={() => setStep(1)}
            onNext={goToCategories}
          />
        )}
        {step === 3 && (
          <StepCategories
            groups={groups}
            categories={categories ?? []}
            suggest={suggest}
            count={parsed.transactions.length}
            onChoose={chooseCategory}
            importing={importing}
            importErrors={importErrors}
            detectedSummary={
              skippedColumns ? describeMapping(file.headers, mapping) : null
            }
            onChangeColumns={() => {
              setSkippedColumns(false);
              setStep(2);
            }}
            onBack={() => {
              setSkippedColumns(false);
              setStep(2);
            }}
            onImport={runImport}
          />
        )}
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------- step 1

function StepChoose({
  accounts,
  accountId,
  setAccountId,
  file,
  fileError,
  onFile,
  onNext,
  onCancel,
}) {
  return (
    <>
      <p className="caption">
        Download your transactions as a CSV from your bank's website, then
        choose the account it belongs to. The file is read on this computer;
        nothing is saved until you import.
      </p>
      <label>
        Account
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Choose…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
      {file && !fileError && (
        <p className="field-hint">
          ✓ {file.name}: {file.rows.filter((r) => r.some((c) => c)).length} rows
        </p>
      )}
      {fileError && (
        <p className="field-hint is-error" role="alert">
          ⚠ {fileError}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="button-primary"
          disabled={!accountId || !file || Boolean(fileError)}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- step 2

function StepColumns({
  file,
  mapping,
  setMapping,
  flipSign,
  setFlipSign,
  parsed,
  onBack,
  onNext,
}) {
  const debitCredit = mapping.amount === null;
  const set = (field) => (e) =>
    setMapping({
      ...mapping,
      [field]: e.target.value === "" ? null : Number(e.target.value),
    });
  const columnSelect = (field, label) => (
    <label>
      {label}
      <select value={mapping[field] ?? ""} onChange={set(field)}>
        <option value="">Choose…</option>
        {file.headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
  const { transactions, problems } = parsed;

  return (
    <>
      <p className="caption">
        We guessed which column is which. Check the preview below; fix anything
        that looks wrong.
      </p>
      <div className="field-pair">
        {columnSelect("date", "Date column")}
        <label>
          Date format
          <select
            value={mapping.dateFormat ?? ""}
            onChange={(e) =>
              setMapping({
                ...mapping,
                dateFormat: e.target.value || null,
                dateAmbiguous: false,
              })
            }
          >
            <option value="">Choose…</option>
            {DATE_FORMATS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {mapping.dateAmbiguous && (
        <p className="field-hint is-warning" role="status">
          ⚠ Every date in this file could be month-first or day-first (like
          03/04). Check the dates in the preview and change the format if
          they're wrong.
        </p>
      )}
      {columnSelect("description", "Description column")}

      <fieldset className="amount-style">
        <legend>Amounts</legend>
        <label className="inline">
          <input
            type="radio"
            checked={!debitCredit}
            onChange={() =>
              setMapping({
                ...mapping,
                amount: mapping.debit ?? mapping.credit ?? 0,
                debit: null,
                credit: null,
              })
            }
          />
          One amount column
        </label>
        <label className="inline">
          <input
            type="radio"
            checked={debitCredit}
            onChange={() =>
              setMapping({
                ...mapping,
                debit: mapping.amount ?? 0,
                credit: null,
                amount: null,
              })
            }
          />
          Separate withdrawals and deposits
        </label>
      </fieldset>
      {debitCredit ? (
        <div className="field-pair">
          {columnSelect("debit", "Withdrawals (money out)")}
          {columnSelect("credit", "Deposits (money in)")}
        </div>
      ) : (
        <>
          {columnSelect("amount", "Amount column")}
          <label className="inline">
            <input
              type="checkbox"
              checked={flipSign}
              onChange={(e) => setFlipSign(e.target.checked)}
            />
            Purchases show as positive numbers (usual for credit cards)
          </label>
        </>
      )}

      <section aria-label="Preview">
        <h3 className="import-subhead">
          Preview{" "}
          <span className="caption">
            first {Math.min(5, transactions.length)} of {transactions.length}
          </span>
        </h3>
        {transactions.length === 0 ? (
          <p className="field-hint is-error" role="alert">
            ⚠ No transactions could be read with these settings. Check the date
            column and format.
          </p>
        ) : (
          <table className="import-preview">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.slice(0, 5).map((t) => (
                <tr key={t.line}>
                  <td>{formatDate(t.date)}</td>
                  <td>{t.description}</td>
                  <td
                    className={`num amount${t.amount_cents > 0 ? " positive-text" : ""}`}
                  >
                    {formatSignedCents(t.amount_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {problems.length > 0 && (
        <details className="import-problems">
          <summary>
            ⚠ {problems.length} row{problems.length === 1 ? "" : "s"} can't be
            imported (they'll be skipped)
          </summary>
          <ul>
            {problems.slice(0, 20).map((p) => (
              <li key={p.line}>
                Line {p.line}: {p.reason}
              </li>
            ))}
            {problems.length > 20 && <li>…and {problems.length - 20} more</li>}
          </ul>
        </details>
      )}

      <div className="dialog-actions">
        <button type="button" className="button-secondary" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="button-primary"
          disabled={transactions.length === 0}
          onClick={onNext}
        >
          Next: categories
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- step 3

function StepCategories({
  groups,
  categories,
  suggest,
  count,
  onChoose,
  importing,
  importErrors,
  detectedSummary,
  onChangeColumns,
  onBack,
  onImport,
}) {
  const loading = suggest?.status !== "done";
  const note = loading ? null : aiStatusNote(suggest.aiStatus);

  return (
    <>
      {detectedSummary && (
        <p className="detected-summary" role="status">
          <span>
            ✓ Read {count} transaction{count === 1 ? "" : "s"} ·{" "}
            {detectedSummary}
          </span>{" "}
          <button
            type="button"
            className="link-button"
            onClick={onChangeColumns}
          >
            Change
          </button>
        </p>
      )}
      <p className="caption">
        One line per merchant: a category applies to all of its transactions.{" "}
        {groups.length} merchants, {count} transactions.
      </p>
      {note && (
        <p className="field-hint" role="status">
          ℹ {note}
        </p>
      )}

      {loading ? (
        <div className="merchant-list" aria-busy="true">
          <span className="caption">Suggesting categories…</span>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={40} />
          ))}
        </div>
      ) : (
        <ul className="merchant-list">
          {groups.map((g) => {
            const choice = suggest.choices[g.key];
            const options = categories.filter((c) => c.kind === g.kind);
            return (
              <li key={g.key}>
                <div className="merchant-info">
                  <span className="row-title">{g.label}</span>
                  <span className="caption">
                    {g.count > 1 ? `${g.count} transactions · ` : ""}
                    <span
                      className={`amount${g.totalCents > 0 ? " positive-text" : ""}`}
                    >
                      {formatSignedCents(g.totalCents)}
                    </span>
                  </span>
                </div>
                <div className="merchant-choice">
                  <select
                    aria-label={`Category for ${g.label}`}
                    value={choice.categoryId}
                    onChange={(e) => onChoose(g.key, e.target.value)}
                  >
                    <option value="">Uncategorized</option>
                    {options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {choice.source && (
                    <span className="field-hint">
                      {choice.source === "history"
                        ? "↺ from your history"
                        : "✨ suggested by AI"}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {importErrors.length > 0 && (
        <ul className="form-errors" role="alert">
          {importErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <div className="dialog-actions">
        <button
          type="button"
          className="button-secondary"
          onClick={onBack}
          disabled={importing}
        >
          Back
        </button>
        <button
          type="button"
          className="button-primary"
          disabled={loading || importing}
          onClick={onImport}
        >
          {importing
            ? "Importing…"
            : `Import ${count} transaction${count === 1 ? "" : "s"}`}
        </button>
      </div>
    </>
  );
}
