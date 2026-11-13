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
not your real ledger. Note that `VISA PAYMENT - THANK YOU` in the chequing file and
`PAYMENT - THANK YOU` in the Visa file are the same money moving between accounts:
until account-to-account transfers are supported, importing both counts it twice.
