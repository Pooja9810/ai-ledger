import { useState } from "react";
import { api } from "../api.js";
import { useApi } from "../hooks/useApi.js";
import { parseDollarsToCents, todayLocal } from "../format.js";

/**
 * Props:
 *   accounts – list of accounts for the dropdown
 *   onSaved  – called after a successful save, so the parent can refresh data
 */
export function AddTransactionForm({ accounts, onSaved }) {
  const { data: categories } = useApi("/categories");

  // One piece of state per field (controlled inputs).
  const [kind, setKind] = useState("expense"); // "expense" | "income"
  const [amount, setAmount] = useState(""); // what the user typed, as text
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayLocal);
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Only offer categories that match the selected kind.
  const matchingCategories = (categories ?? []).filter((c) => c.kind === kind);

  async function handleSubmit(event) {
    event.preventDefault(); // stop the browser from reloading the page

    // Quick checks in the browser for instant feedback.
    // (The server still validates everything; it's the authority.)
    const cents = parseDollarsToCents(amount);
    const problems = [];
    if (cents === null || cents === 0) {
      problems.push("Enter an amount like 12.50");
    }
    if (!accountId) problems.push("Choose an account");
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }

    setSaving(true);
    setErrors([]);
    try {
      await api("/transactions", {
        method: "POST",
        body: {
          account_id: Number(accountId),
          category_id: categoryId ? Number(categoryId) : null,
          date,
          amount_cents: kind === "expense" ? -cents : cents, // sign convention
          description,
        },
      });
      // Clear the fields you'd change for the next entry; keep account,
      // date, and kind, which are often the same when entering several.
      setAmount("");
      setDescription("");
      setCategoryId("");
      setJustSaved(true);
      onSaved();
    } catch (err) {
      // Show the server's validation messages if it sent any.
      setErrors(err.errors.length > 0 ? err.errors : [err.message]);
    } finally {
      setSaving(false); // runs whether it succeeded or failed
    }
  }

  return (
    <section className="card">
      <h2>Add transaction</h2>
      <form className="form" onSubmit={handleSubmit}>
        <div className="segmented" role="group" aria-label="Type">
          {["expense", "income"].map((option) => (
            <button
              key={option}
              type="button"
              className={kind === option ? "active" : ""}
              onClick={() => {
                setKind(option);
                setCategoryId(""); // the old category may not match the new kind
              }}
            >
              {option === "expense" ? "Expense" : "Income"}
            </button>
          ))}
        </div>

        <label>
          Amount ($)
          <input
            inputMode="decimal"
            placeholder="12.50"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setJustSaved(false);
            }}
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

        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>

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
          <ul className="error form-errors" role="alert">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}

        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving…" : "Add transaction"}
        </button>
        {justSaved && <p className="positive small">Saved ✓</p>}
      </form>
    </section>
  );
}
