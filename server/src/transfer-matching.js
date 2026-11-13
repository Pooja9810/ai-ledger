/**
 * Find likely transfer pairs while importing a bank file.
 *
 * The two halves of a transfer (e.g. a credit-card payment) arrive in
 * separate files: "VISA PAYMENT −$600" in the chequing export and
 * "PAYMENT +$600" in the Visa export. When the second file is imported,
 * each new row is compared with transactions ALREADY in the ledger.
 *
 * Suggestions only: the user confirms each one in the import dialog.
 */

export const MATCH_WINDOW_DAYS = 3; // banks post the two sides a few days apart

// At least one side must read like a transfer. Opposite amounts alone are
// common by coincidence (a −$40 transit top-up vs a +$40 e-transfer from a friend).
const TRANSFER_WORDS =
  /payment|pymt|pmt|transfer|xfer|e-?transfer|interac|paiement|virement/i;
export const looksLikeTransfer = (description) =>
  TRANSFER_WORDS.test(description ?? "");

/** Whole days between two 'YYYY-MM-DD' dates (UTC, so no daylight-saving surprises). */
function daysApart(a, b) {
  const day = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return Math.abs(day(a) - day(b));
}

/**
 * @param account_id  the account the file belongs to
 * @param rows        [{ date, description, amount_cents }] from the file
 * @returns [{ row, type: "pair", transaction: { id, account_name, date, description, amount_cents } }
 *         | { row, type: "already_transfer", transfer_id, date, description }]
 *   `row` is the index into `rows`. At most one match per row, and each
 *   existing transaction is matched at most once (closest date wins).
 */
export function findTransferMatches(db, { account_id, rows }) {
  if (rows.length === 0) return [];
  const dates = rows.map((r) => r.date).sort();
  const window = (sign) => `date(?, '${sign}${MATCH_WINDOW_DAYS} days')`;

  // Untransferred transactions in OTHER accounts (opening balances excluded).
  const others = db
    .prepare(
      `SELECT t.id, t.account_id, a.name AS account_name, t.date, t.description, t.amount_cents
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.account_id <> ? AND t.transfer_id IS NULL
         AND (c.kind IS NULL OR c.kind <> 'transfer')
         AND t.date BETWEEN ${window("-")} AND ${window("+")}`,
    )
    .all(account_id, dates[0], dates.at(-1));

  // Transfer halves already in THIS account (e.g. a transfer entered by hand).
  const ownTransferHalves = db
    .prepare(
      `SELECT id, transfer_id, date, description, amount_cents FROM transactions
       WHERE account_id = ? AND transfer_id IS NOT NULL
         AND date BETWEEN ${window("-")} AND ${window("+")}`,
    )
    .all(account_id, dates[0], dates.at(-1));

  const used = new Set(); // existing transaction ids already matched
  const closest = (candidates, row) =>
    candidates
      .filter(
        (c) =>
          !used.has(c.id) && daysApart(c.date, row.date) <= MATCH_WINDOW_DAYS,
      )
      .sort(
        (a, b) =>
          daysApart(a.date, row.date) - daysApart(b.date, row.date) ||
          a.id - b.id,
      )[0];

  const matches = [];
  rows.forEach((row, i) => {
    if (!Number.isInteger(row.amount_cents) || row.amount_cents === 0) return;

    // Already recorded as a transfer here? (same account, same amount)
    const half = closest(
      ownTransferHalves.filter((t) => t.amount_cents === row.amount_cents),
      row,
    );
    if (half) {
      used.add(half.id);
      matches.push({
        row: i,
        type: "already_transfer",
        transfer_id: half.transfer_id,
        date: half.date,
        description: half.description,
      });
      return;
    }

    // The other half in another account: opposite amount, and transfer-like.
    const other = closest(
      others.filter(
        (t) =>
          t.amount_cents === -row.amount_cents &&
          (looksLikeTransfer(row.description) ||
            looksLikeTransfer(t.description)),
      ),
      row,
    );
    if (other) {
      used.add(other.id);
      const { account_id: _ignored, ...transaction } = other;
      matches.push({ row: i, type: "pair", transaction });
    }
  });
  return matches;
}
