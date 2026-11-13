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

/**
 * Where a transfer half's money went or came from, for the transaction
 * list: "To Visa Card" (money out) or "From Everyday Checking" (money in).
 * `partner` is the other half if it's loaded; otherwise just "Transfer".
 */
export function transferDirection(transaction, partner) {
  if (!partner) return "Transfer";
  return transaction.amount_cents < 0
    ? `To ${partner.account_name}`
    : `From ${partner.account_name}`;
}

/** Map each transfer half's id to the other half (both must be in the list). */
export function transferPartners(transactions = []) {
  const byTransfer = new Map();
  for (const t of transactions) {
    if (t.transfer_id === null || t.transfer_id === undefined) continue;
    byTransfer.set(t.transfer_id, [
      ...(byTransfer.get(t.transfer_id) ?? []),
      t,
    ]);
  }
  const partners = new Map();
  for (const halves of byTransfer.values()) {
    if (halves.length !== 2) continue;
    partners.set(halves[0].id, halves[1]);
    partners.set(halves[1].id, halves[0]);
  }
  return partners;
}
