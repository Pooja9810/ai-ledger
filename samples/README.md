# Sample bank exports (fake data)

Realistic but **entirely made-up** bank statements for trying CSV import
(**Transactions → Import CSV**). Merchant names look like real statement text;
every amount, date and person is invented.

| File | Style | What it exercises |
|---|---|---|
| `chequing-2026-10-11.csv` | Header row, MM/DD/YYYY, separate Withdrawals / Deposits, running Balance | Debit/credit detection, ignoring the balance, payroll, rent, bills, a refund. Detection is confident, so the "check columns" step is skipped. |
| `visa-2026-11.csv` | Credit card: Transaction + Posting dates, purchases **positive**, `$` amounts, quoted descriptions with commas | Picking the transaction date, the suggested sign flip, quoting |

Regenerate (deterministic): `python3 samples/make_samples.py samples`

Tip: try these against the demo database (`cd server && npm run seed && npm run dev:demo`),
not your real ledger. Import the chequing file into the checking account first, then the
Visa file into the credit card. `PAYMENT - THANK YOU` in the Visa file and
`VISA PAYMENT - THANK YOU` in the chequing file are the same money moving between
accounts, so the import suggests linking them as one transfer instead of counting
them as spending and income.

Both files also contain a refund (`NO FRILLS … REFUND`, `AMZN MKTP CA RETURN`). These
come in as income or uncategorized, a known limitation (see
`docs/design/ai-features.md`, section 3.6).
