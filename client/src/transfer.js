/**
 * Rules for the Transfer option in the Add Transaction form.
 * Pure functions, so they're easy to test.
 */
import { formatCents } from "./format.js";

/**
 * What's missing before a transfer can be saved? (The server checks again.)
 * @param cents   parsed amount, or null
 * @param fromId  "From" select value ("" = not chosen)
 * @param toId    "To" select value
 * @returns a list of messages (empty = OK)
 */
export function transferProblems({ cents, fromId, toId }) {
  const problems = [];
  if (!cents) problems.push("Enter an amount like 600.00");
  if (!fromId) problems.push("Choose the account the money comes from");
  if (!toId) problems.push("Choose the account the money goes to");
  if (fromId && toId && fromId === toId) {
    problems.push("Choose two different accounts");
  }
  return problems;
}

/** Toast after saving: "Transferred $600.00 · Chequing → Visa". */
export function transferSavedMessage(transfer) {
  return `Transferred ${formatCents(transfer.amount_cents)} · ${transfer.from_account_name} → ${transfer.to_account_name}`;
}
