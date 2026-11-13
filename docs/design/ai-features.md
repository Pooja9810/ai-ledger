# Ledgerly AI features: design doc

**Status:** living document. Built features describe what the code does; planned
features are proposals that get updated when they're built.
**Last updated:** 2026-11-13 (transfers between accounts + transfer matching on import)

## Contents

1. [Overview](#1-overview)
2. [Shared foundation](#2-shared-foundation)
3. [Auto-categorize (built)](#3-auto-categorize-built), including [CSV import with batch categorization](#37-bulk-csv-import-with-batch-categorization) and [transfers](#38-transfers-between-accounts-and-matching-them-on-import)
4. [Natural-language entry (built)](#4-natural-language-entry-built)
5. [Ask your ledger (built)](#5-ask-your-ledger-built)
6. [Receipt scanning (planned)](#6-receipt-scanning-planned)
7. [Monthly insights (planned)](#7-monthly-insights-planned)
8. [Decision log](#8-decision-log)

---

## 1. Overview

Ledgerly is a personal ledger you can talk to. AI is used where it removes
tedious work, but **the AI only ever proposes; our code validates and the user
decides.** No AI output is written to the database without passing the same
validation as user input, and nothing is saved without the user confirming it.

| Feature | What the user gets | AI technique | Status |
|---|---|---|---|
| Auto-categorize | Category filled in as you type a transaction | Single call, JSON output | ✅ Built |
| CSV import | A bank export → reviewed, categorized transactions | History index + batched AI calls (50 merchants per call) | ✅ Built |
| Natural-language entry (typed or 🎙 spoken) | "spent $12.50 on lunch yesterday" → filled form | Browser speech-to-text + single call, JSON extraction | ✅ Built |
| Ask your ledger (typed or 🎙 spoken) | "How much did I spend on dining in October?" | Tool use (agent loop) over read-only SQL tools + a calculator | ✅ Built |
| Receipt scanning | Photo of a receipt → filled form | Image input + JSON extraction | Planned |
| Monthly insights | Short written summary of the month | Single call, text generation over pre-computed numbers | Planned |

---

## 2. Shared foundation

### 2.1 Provider and model

- **Provider:** DeepSeek, via its OpenAI-compatible API (`https://api.deepseek.com`)
  using the `openai` npm package.
- **Model:** `deepseek-flash`, the fast, low-cost tier. It supports JSON output, tool
  calls and image input. `deepseek-v4-pro` is the stronger option if a feature
  needs it.
- **Why:** cost. See the [decision log](#8-decision-log) for the alternatives compared.

### 2.2 One module talks to the provider

`server/src/ai/client.js` is the **only** file that imports the SDK or knows the
provider's name. Features call our own interface:

```js
const ai = createAiClient();             // null when DEEPSEEK_API_KEY is missing
const { data, usage } = await ai.completeJson({ system, user, maxTokens });
```

It has two methods:
- `completeJson({ system, user, maxTokens })`: one call, parsed JSON back. Used by
  auto-categorize and natural-language entry.
- `runTools({ system, messages, tools, runTool, maxRounds })`: the **agent loop** used
  by ask your ledger (see section 5).

`completeJson` requests JSON mode with thinking turned off, parses the answer, and turns
every unusable outcome into one `AiError`:

| Outcome | How we detect it |
|---|---|
| Network / auth / rate-limit failure (after 2 SDK retries) | SDK throws |
| Answer cut off | `finish_reason === "length"` |
| Model couldn't produce valid JSON | DeepSeek returns **blank content**, not an error |
| Malformed JSON | `JSON.parse` throws |

**Why this design:** switching providers touches one file; every feature gets
the same error handling; tests inject a fake (see 2.5).

### 2.3 Configuration and secrets

- The key lives in `server/.env` (gitignored) as `DEEPSEEK_API_KEY`, documented in
  `server/.env.example`. It's loaded with Node's built-in `--env-file-if-exists`, so
  there's no `dotenv` dependency.
- The key is used **only on the server**. The browser never sees it; the React
  app calls our API, and our API calls DeepSeek.
- Without a key, the server still starts (it logs "AI disabled"), and only features
  that actually need the AI answer `503`.

### 2.4 HTTP error contract for AI endpoints

| Status | Meaning | UI behaviour |
|---|---|---|
| `400` | Bad input (`{ errors: [...] }`) | Show the errors |
| `503` | AI not configured on the server | Automatic helpers: stay silent. User-triggered actions: say so ("AI isn't set up on the server") |
| `502` | The AI provider failed or returned junk | Automatic helpers: stay silent. User-triggered actions: "Couldn't reach the AI, try again". Details only in server logs |

**Rule of thumb:** if the user didn't ask (auto-categorize on blur), failures are
silent. If the user clicked something ("✨ Fill"), they get an answer, shown as
⚠ + text and the only red in the AI UI.

5xx responses never include provider error text, since those can contain sensitive
details. This is enforced by a test.

### 2.5 Testing

- **Unit and route tests never call the real API.** `createAiClient({ sdk })` and
  `createApp(db, { ai })` accept fakes, so `npm test` is free, fast and offline.
- Prompts are tested by inspecting what the fake received (e.g. "only expense
  categories were offered").
- Real API calls happen only in manual smoke tests during development.

### 2.6 Cost model

DeepSeek bills per token. `deepseek-flash` prices per 1M tokens (Nov 2026):

| | Off-peak | Peak (weekdays 01:00–04:00, 06:00–10:00 UTC) |
|---|---|---|
| Input (cache miss) | $0.15 | $0.30 |
| Input (cache hit) | $0.003 | $0.006 |
| Output | $0.60 | $1.20 |

**Cost principles used by every feature:**
1. **Don't call the AI when code can answer** (e.g. history reuse in auto-categorize).
2. **Keep system prompts constant**, with no dates or user data in them, so repeated
   prefixes become cache hits. Per-request data goes in the user message.
3. **Thinking off for simple tasks;** turn it on only where reasoning measurably helps.
4. **Cap inputs and outputs** (input length validation, `maxTokens`).
5. **Send only the data needed:** tools fetch data on demand rather than pasting
   the whole ledger into the prompt.

---

## 3. Auto-categorize (built)

### 3.1 Goal

When adding a transaction, suggest one of the user's existing categories from the
description, e.g. `UBER *EATS` → Dining Out. The suggestion must be **free when
possible**, **never wrong in a harmful way**, and **never override the user**.

### 3.2 Flow

```
Form: user leaves the Description (or Amount) field
  │
  ▼
POST /api/ai/categorize { description, amount_cents }
  │
  ├─ 400 if input invalid
  │
  ├─ 1. History: same merchant categorized before? ──yes──► { suggestion, source: "history" }
  │                                                          (free, ~5 ms, works without AI key)
  ├─ 2. No AI key? ──► 503
  │
  └─ 3. AI: pick from candidate categories ──► { suggestion | null, source: "ai" | null }
                                     (AI failure ──► 502)
```

### 3.3 Implementation (steps A–D)

| Step | Piece | File(s) |
|---|---|---|
| A | `suggestCategory(ai, { description, amountCents, categories })` | `server/src/ai/categorize.js` |
| B | `POST /api/ai/categorize` endpoint | `server/src/routes/ai.js` |
| C | History reuse: `normalizeMerchant`, `findCategoryFromHistory` | `server/src/merchants.js` |
| D | Suggestion in the Add Transaction form | `client/src/suggestions.js`, `AddTransactionDialog.jsx` |

**A: The AI call.**
- Candidate categories come from the database at request time, filtered by the
  amount's sign: expense categories for negative amounts, income categories for
  positive ones. `transfer` categories are never offered.
- The AI answers with a category **name** (`{"category": "Dining Out"}`) or `null`
  when unsure. Our code maps the name to an id with a case-insensitive exact match.
  Anything else (an invented category, wrong kind, wrong type) becomes "no suggestion".
- Blank descriptions skip the AI call; `maxTokens: 50`.

**B: The endpoint.** It validates input (description required, ≤ 500 characters to cap
cost; non-zero integer `amount_cents`) and follows the error contract in 2.4.

**C: History reuse.**
- `normalizeMerchant` lowercases and replaces every non-letter with a space:
  `STARBUCKS #1234 SEATTLE WA` → `starbucks seattle wa`.
- It looks up the **most recent** past transaction with the same key, so the user's
  latest correction wins. Only categories of the right kind are reused, never
  `transfer`.
- Matching runs in JavaScript over categorized rows, because SQLite has no regex replace.
  That's fine at personal-ledger scale (thousands of rows).

**D: The UI.**
- Triggered on **blur** of the description or amount field: one request per entry,
  no calls while typing. Repeat requests for the same description and sign are skipped.
- The category is filled in only if it's empty or was filled by an earlier
  suggestion. **A category the user picked is never overwritten.**
- Stale answers (the user switched Expense/Income or edited the description mid-request)
  are ignored using a request key.
- A muted hint (`✨ Suggested by AI` / `✨ Suggested from your past transactions`,
  `aria-live="polite"`) shows while the selected category is the suggested one.
- Any failure is silent, and the form works exactly as without AI.

### 3.4 Alternatives considered

| Decision | Chosen | Rejected and why |
|---|---|---|
| AI returns | Category name | Category id: models are unreliable with arbitrary numbers |
| Merchant matching | Normalized text | Exact text (misses store numbers); rules table (schema change, migration and management UI; possible later) |
| Conflicting history | Most recent wins | Most frequent: ignores the user's corrections |
| UI trigger | On blur | While typing (several paid calls per entry); a button (extra click) |
| Client tests | Pure functions | React Testing Library: more setup; a candidate for the Polish step |

### 3.5 Results (manual smoke tests, demo data)

| Description | Suggestion | Source | Time |
|---|---|---|---|
| `AMZN MKTP US*2K4 #9876` | Shopping | history | 0.005 s |
| `UBER *EATS` | Dining Out | ai | 0.81 s |
| `UBER *TRIP HELP.UBER.COM` | Transport | ai | – |
| `WHOLEFDS MKT 10234` | Groceries | ai | – |
| `ACME CORP PAYROLL DIR DEP` (+) | Salary | ai | – |
| `POS PURCHASE 4471` | *(none)* | – | – |

A typical AI call is ~74 input + 8 output tokens, about **$0.00002**.

### 3.6 Known limitations

- **Random codes defeat normalization.** `AMZN MKTP US*2K4` and `US*7X1` normalize
  to different keys, so each new Amazon code falls through to the AI. The result is
  still correct, but each one costs a call. Possible fixes include prefix matching or a
  rules table; any fix must keep `UBER EATS` and `UBER TRIP` apart.
- **History is loaded per request.** `createHistoryIndex()` reads all categorized
  transactions into a `Map` once per request: fine for thousands of rows. If it ever
  gets slow, store a normalized merchant column (this needs a migration).
- Bulk categorization for CSV import is covered in 3.7.

### 3.7 Bulk: CSV import with batch categorization

**Goal:** turn a bank export (hundreds of rows, in whatever format the bank uses)
into reviewed, categorized transactions in one go: the realistic way data gets
into a personal ledger without paid bank-sync services.

**Why it's hard:** banks differ in column names, date order (`03/04/2026` = March 4
or April 3?), one signed amount column vs separate withdrawals/deposits, credit cards
showing purchases as **positive**, `$1,234.56` / `(4.25)` / `4.25-` amounts,
running-balance columns, and files with no header row at all.

**Flow:**

```
① Choose account + file ── read IN THE BROWSER (papaparse); the raw file never leaves.
                            Spreadsheets/PDFs/binary files are rejected here with how-to-export help
② Check columns ────────── detected mapping, editable; live preview; problem rows by line
                            SKIPPED when detection is confident (see below)
③ Categories ───────────── POST /api/ai/categorize-batch → one line per MERCHANT
                            + POST /api/transfers/match → "possible transfers" (see 3.8)
   Import ──────────────── POST /api/transactions/import → all or nothing
```

| Piece | File | Notes |
|---|---|---|
| Parsing & detection | `client/src/csv.js` | Header names first, then content; ambiguous dates flagged; integer-cent amounts; credit-card flip suggested when a single amount column is >70% positive; blank lines kept so line numbers match the file |
| Merchant grouping | `client/src/importer.js` | Same normalization as the server, so groups match how history and AI categorize |
| Dialog | `client/src/components/ImportDialog.jsx` | Transactions are **derived** (`useMemo`) from rows + mapping + flip, so the preview always equals what's imported |
| Batch categorization | `server/src/ai/categorize-batch.js` | History index → de-duplicate by merchant → AI batches of 50, expense and income separately, 3 at a time |
| Import | `server/src/import-transactions.js` | Re-validates every row; duplicates counted; one DB transaction |

**Asking only when needed:** the column step is skipped (with a summary line,
*"✓ Read 56 transactions · Date (month first) · Description · Withdrawals / Deposits ·
Change"*) only when nothing was guessed: every needed column found **by header name**,
an **unambiguous** date format, **no** unreadable rows, and **no** suggested sign flip
(a flip changes every amount, so the user confirms it). A wrong guess doesn't error; it
silently corrupts data (wrong months, income shown as spending), so anything guessed
still stops for confirmation.

**Not a CSV at all:** the file picker's `accept=".csv"` is only a suggestion. A CSV
re-saved in Numbers produced 953 garbage "can't read the date" rows in testing.
`fileProblem()` now rejects `.numbers`/`.xlsx`/`.xls`/`.ods`/`.pdf` with how-to-export
help, and binary content (zip signature, null bytes, mostly unreadable bytes) even when
named `.csv`, on step 1.

**Batch categorization details:**
- **History first, from an index built once** (`createHistoryIndex`): one scan into a
  `Map`, not one scan per row.
- **De-duplicate by merchant:** `TIM HORTONS #4521 TORONTO ON` and `#0877` are one
  AI decision.
- **Numbered prompt, answers matched by number** (`{"n": 3, "category": …}`), not
  position, so a skipped or reordered answer can't shift every category by one.
- **Descriptions flattened to one line** (≤ 200 chars) so a description containing a
  line break can't inject a fake list item or instruction.
- **Partial failure stays partial:** a failed batch leaves its rows uncategorized; the
  response says `ai: "used" | "not_needed" | "unavailable" | "partial" | "failed"` and
  the dialog explains it. Works without an AI key (history only).

**Import details:**
- **All or nothing:** any invalid row → 400 listing up to 10 problems by row number;
  a database failure mid-way → `ROLLBACK`. Never half an import.
- **Duplicates are counted, not just matched:** same account, date, amount and
  normalized merchant. If the ledger has one "Tim Hortons −$4.25 on Nov 2" and the file
  has two, one is skipped and one imported, since two same-day coffees are real.
- **Body size:** Express's default 100 KB limit would reject imports over ~1,100 rows.
  The two bulk routes get 2 MB; every other route keeps 100 KB (a basic denial-of-service
  guard). A test caught this.

**Results (fake bank export, demo data):** 12 lines with no header, withdrawals/deposits
and a balance column. Detection: date, description, debit/credit correct and the balance
ignored. 1 bad date flagged and skipped; **11 rows → 8 merchants → 2 AI calls**
(expense + income); all sensible, and "POS PURCHASE 0042" honestly left
uncategorized. **Re-importing the same file: "Imported 0 transactions · 11 duplicates
skipped"**, and every category now came from **history** (free). A 40-row batch test:
16 unique merchants, 2 AI calls, 1.1 s, ~$0.0002 (vs 40 single calls).

**Alternatives considered:**

| Decision | Chosen | Rejected and why |
|---|---|---|
| Column mapping | Header names + content heuristics, user confirms | Ask the AI to map columns (a paid call for something rules handle; less predictable) |
| CSV parsing | `papaparse` | Hand-written parser (quotes, embedded commas and line breaks are easy to get subtly wrong) |
| Where to parse | In the browser | Upload the raw file (slower preview; the raw file leaves the computer) |
| Category review | One line per merchant | One dropdown per row (300+ dropdowns; slow at 2,000 rows) |
| Duplicates | Skip, counted per key | Import everything (re-imports double the ledger); skip any match (drops genuine repeat purchases) |
| Batch size | 50 merchants per call, 3 calls in flight | One call per row (slow, costly); one giant call (long outputs, one failure loses all) |

**Known limitations:**
- A merchant whose transactions belong in different categories (a Costco grocery run
  vs a TV) gets one category at import; fix individual rows afterwards.
- A line break **inside** a quoted description shifts later line numbers in error
  messages by one (parsing itself is correct).
- Detection can't know which account a file belongs to; the user picks it. One account
  per file.
- Transfers between accounts are handled by pair matching (3.8). A transfer whose other
  side is never imported (e.g. a payment to a card you don't track) stays an ordinary
  expense; enter it as a transfer by hand if needed.

### 3.8 Transfers between accounts (and matching them on import)

**Problem:** paying a credit card appears twice: "VISA PAYMENT −$600" in chequing and
"PAYMENT +$600" on the card. Imported as ordinary rows, that is **$600 of spending and
$600 of income** that never happened (the real spending is the card purchases).

**Model: linked transfer pairs.** A transfer is two transactions, −amount in one
account and +amount in the other, sharing a `transfer_id` (new `transfers` table,
`ON DELETE CASCADE`). Both use the system category **"Account transfer"** (kind
`transfer`), which every spending, income, budget and AI-tool query already ignores.
Balances, derived as `SUM` per account, need no change.

| Piece | Where |
|---|---|
| Migration 2 (table, column, index, category) | `server/src/db/migrations.js`, `schema.sql` |
| Create / get / edit / delete as a pair | `server/src/transfers.js`, `POST/GET/PATCH/DELETE /api/transfers` |
| Guards | `PATCH/DELETE /api/transactions/:id` on one half → **409** pointing to the transfer; ordinary transactions can't use transfer categories |
| Form | Add Transaction: **Expense \| Income \| Transfer** (From/To, no category) |
| List | ⇄ avatar, "To Visa Card" / "From Everyday Checking", normal ink |
| Matching on import | `server/src/transfer-matching.js`, `POST /api/transfers/match`; rows may carry `link_transaction_id` |

**Matching rules** (suggestions only; the user ticks/unticks each):
- **Pair:** an untransferred transaction in **another** account with the **opposite**
  amount, within **3 days**, where **at least one description reads like a transfer**
  (payment, pymt, transfer, xfer, e-transfer, interac…). Closest date wins; each
  existing transaction is used at most once.
- **Already recorded:** a row matching an existing transfer half in the **same** account
  (e.g. a transfer entered by hand) is offered as "skip it".
- Linking happens inside the import's database transaction: the existing row becomes one
  half, the new row the other. Links are validated (exists, other account, opposite
  amount, not already a transfer, not linked twice).

**Results (both sample files, fresh database):** importing chequing then Visa suggests
*"PAYMENT +$600 (Nov 4) ⇄ VISA PAYMENT −$600 in Everyday Checking (Nov 3)"*; toast
*"Imported 15 transactions · 1 transfer linked"*. November spending:
$2,941.61 − $600.00 (payment no longer spending) + $424.03 (card purchases) =
**$2,765.64**, matching the app; balances match each file's own running balance.
Importing in the opposite order, or importing a file again, also works ("already
recorded as a transfer: skip it").

**Alternatives considered:**

| Decision | Chosen | Rejected and why |
|---|---|---|
| Data model | Linked pair of transactions + `transfer` category | One row with from/to (every balance query would change); **full double-entry** (journal entries + postings; gives splits and guaranteed balance but rewrites every query, the AI tools and import. The pair already applies double-entry's zero-sum idea where it's needed. Revisit if split transactions are wanted.) |
| Keeping halves consistent | `transfers` table + `ON DELETE CASCADE`, one DB transaction per write, 409 on single-half edits | Application-only checks (the database couldn't stop a stray delete) |
| Matching signal | Opposite amount + 3 days + transfer-like wording | Amount and date only (coincidences: a −$40 top-up vs a +$40 e-transfer from a friend) |
| Confirmation | Suggested and pre-ticked, user can untick | Link automatically (a wrong link hides real spending) |

**Known limitations:**
- Matching misses transfers described with no transfer-like words on **either** side, or
  posted more than 3 days apart; those can be entered as transfers by hand.
- One account per file, and transfers between more than two accounts (e.g. splitting a
  paycheck) aren't modelled; that is where full double-entry would help.
- An existing ordinary transaction can't yet be converted into a transfer from the list
  (only via import matching or by re-entering it).

---

## 4. Natural-language entry (built)

### 4.1 Goal

Type a note like `spent $12.50 on lunch at Chipotle yesterday`, press **✨ Fill**,
and the Add Transaction form fills itself in. One note may describe **several**
transactions (`coffee at Tims for 4 and chips at Five Guys for 15`); they fill in
one after another. **The user reviews and saves each one; nothing is saved
automatically.**

### 4.2 Flow

```
Dialog: user types a note, presses ✨ Fill (or Enter in the box)
  │
  ▼
POST /api/ai/parse-transaction { text, today }      (today = browser's local date)
  │
  ├─ 400 if input invalid ──────────────────────────► "⚠ <error>"
  ├─ 503 if no AI key ──────────────────────────────► "⚠ AI isn't set up on the server"
  │
  ├─ 1. ONE AI call → a LIST of transactions, each with kind, amount (as text),
  │      date, description, category
  │      (AI failure ──► 502 ──► "⚠ Couldn't reach the AI, try again")
  ├─ 2. Our code validates every field of every item (invalid → empty, never an
  │      error); drops empty items; keeps at most 5
  ├─ 3. History overrides the AI's category per item if the merchant was seen before
  │
  ▼
{ drafts: [{ kind, amount_cents, date, description, category, category_source }, …] }
  │
  ▼
Form: first draft fills only the fields the AI found → "ℹ Couldn't find an amount…"
      if needed; the rest wait in a queue ("⏭ 1 more: Five Guys −$15.00 · fills
      after you save"); focus moves to the first thing missing (amount → Account →
      Add transaction)
  │
  ▼  user saves
Dialog stays open → next queued draft fills in (account and date carry over) → …
```

### 4.3 Implementation (steps A–C)

| Step | Piece | File(s) |
|---|---|---|
| A | `parseTransactions(ai, { text, today, categories })` + server dollar parser | `server/src/ai/parse-transaction.js`, `server/src/money.js` |
| B | `POST /api/ai/parse-transaction` endpoint | `server/src/routes/ai.js` |
| C | "✨ Fill" box at the top of the Add Transaction dialog, plus the queue for several drafts | `client/src/draft.js`, `AddTransactionDialog.jsx`, `App.jsx` |

**A: One call, a list of drafts, every field validated.**
- **The answer is always a list:** `{"transactions": [...]}`, even for one item. The
  prompt says *one object per separate purchase; never merge separate purchases,
  never split one purchase into parts*, and shows a two-item example. Up to
  `MAX_DRAFTS = 5` are kept (caps cost and keeps the queue reviewable). Items with
  neither an amount nor a description are dropped, and a bare single object (no list)
  is tolerated.
- **One AI call, not two.** The kind (expense or income) isn't known until the note is read,
  so the AI gets *both* category lists and picks a category in the same answer as
  the other fields. That's half the cost and latency of parsing first and then categorizing.
- The user message carries `Today: 2026-11-11 (Wednesday)`. The weekday lets the
  model resolve "last Friday" correctly. The system prompt stays constant and cacheable.
- **The AI never does money math.** It returns the amount as written (`"12.50"`); our
  `parseDollarsToCents` (a server copy of the client's parser) converts it to cents.
- Validation per field, for each item independently. Invalid values become empty,
  so the form keeps its default:

| Field | Rule | If invalid |
|---|---|---|
| `kind` | `"expense"` or `"income"` | Defaults to `expense`, the form's default |
| `amount` | Our parser → whole cents, non-zero | `null` |
| `date` | A real date and **not after `today`** | `null` (form keeps today) |
| `description` | String, trimmed, ≤ 200 characters | `""` |
| `category` | An exact name from the list **of the right kind**, never `transfer` | `null` |

**B: The endpoint.** It validates `text` (required, ≤ 500 characters) and `today` (a real
date). Unlike `/categorize`, there's no AI-free path, so a missing key is always `503`.
It returns `{ drafts: [...] }` (an empty list when nothing was found). The user's
history overrides the AI's category per draft (`category_source: "history"`). The
502 handling is shared with `/categorize` through an `aiFailed()` helper.

**C: The UI.**
- The Fill box sits at the top of the dialog. **Enter fills; it doesn't submit** the form.
- Only fields the AI found are changed. The category is replaced if the AI found one,
  or cleared if the kind flipped (the old one would be the wrong kind). **Account is
  never touched.**
- The AI's category shows the same `✨ Suggested by AI / from your past
  transactions` hint, and counts as "auto-filled": a later auto-suggestion may
  replace it, but a category the user picks is never overwritten.
- After a fill, leaving the description field doesn't call `/categorize` again for
  the same description.
- **Several drafts:** the first fills the form; the rest wait in a queue shown as
  `⏭ 1 more: Five Guys −$15.00 · fills after you save`. After each save the dialog
  **stays open** (`onSaved(message, { keepOpen })`) and the next draft fills in through
  the same `applyDraft()` used for the first, so both paths behave identically.
  Account (and date, if the draft has none) carry over. Cancel discards the queue.
- Focus goes to the first thing still needed: amount, then Account, otherwise the
  **Add transaction** button, so a complete draft is one keypress from saved
  (after the user has looked at it).
- If nothing is found: `ℹ Couldn't find a transaction in that; try adding a place
  or an amount`.
- Late answers (the dialog was closed mid-request) are ignored using a request counter.
- Amounts become form text with integer math only (`1999` → `"19.99"`; float division
  would risk `19.989999…`).

### 4.4 Alternatives considered

| Decision | Chosen | Rejected and why |
|---|---|---|
| Resolving relative dates | The AI returns an ISO date; code checks it's real and not in the future | `chrono-node` date library: exact, but a new dependency that struggles with unusual phrasing |
| Where the box lives | Top of the Add Transaction dialog | Dashboard quick-add bar: still needs a review step, so it would open the dialog anyway |
| Category | Picked in the same AI call | A second call through `/categorize`: twice the cost and latency |
| Several transactions in one note | AI returns a list; queue them through the normal form | A review list with per-row editing and "Save all" (much more UI); fill the first and warn (re-typing the rest) |
| Shared dollar parser | Copied into `server/src/money.js` | A shared package for client and server: cleaner, but heavy setup for one function |

### 4.5 Results (manual smoke tests, today = Wed 2026-11-11)

| Note | Kind | Amount | Date | Description | Category |
|---|---|---|---|---|---|
| spent $12.50 on lunch at Chipotle yesterday | expense | −1250 | 2026-11-10 | Chipotle | Dining Out |
| got paid 4,125 from ACME today | income | +412500 | 2026-11-11 | ACME | Salary |
| groceries at trader joes last friday 86.42 | expense | −8642 | **2026-11-06** | Trader Joe's | Groceries |
| uber home 23 | expense | −2300 | 2026-11-11 | Uber | Transport |
| coffee | expense | **null** (not invented) | 2026-11-11 | Coffee | Dining Out |
| bought a laptop tomorrow for 1200 | expense | −120000 | **null** (future, rejected by code) | Laptop purchase | Shopping |

About 1.2 s and **~$0.00004** per fill.

**Several transactions in one note.** Before the list shape, the same note gave
three different wrong answers in three runs:

| Run (single-draft shape) | Result | Problem |
|---|---|---|
| 1 | −1500, "Five Guys" | Dropped the coffee |
| 2 | −1900, "Tim Hortons and Five Guys" | Merged both |
| 3 | no amount, "Tim Hortons and Five Guys" | Lost the amount |

With the list shape, three runs out of three were correct:

| Note | Drafts |
|---|---|
| bought coffe from tims for 4 and chips from five guys for 15 today | Tim Hortons −400 Dining Out · Five Guys −1500 Dining Out |
| groceries 86.42 at no frills, got paid 4125 from acme, and uber home 23 last friday | No Frills −8642 Groceries · Acme **+412500 Salary** · Uber −2300 Transport (2026-11-06) |
| lunch at chipotle 12 plus 2 tip | **One** draft: Chipotle −1400 (not split) |

**Lesson:** when the model gave inconsistent answers, the fix wasn't a cleverer
prompt but an output **shape** that can represent the real input. A one-object
schema forced the model to improvise when there were two purchases.

### 4.6 Known limitations

- **History rarely matches bank-style descriptions.** The AI writes clean names
  (`Amazon`), while imported history has bank text (`AMZN MKTP US*2K4`), so the
  history override mostly applies to merchants entered by hand or with Fill. This shares a
  root cause with the merchant-matching limitation in 3.6.
- **`today` is trusted from the browser.** A wrong client clock shifts relative
  dates. That's acceptable for a single-user app; a multi-user deploy could reject values
  more than a day from the server's date.
- **The AI sometimes does simple arithmetic.** "12 plus 2 tip" came back as one
  draft of $14.00. That's correct, but it bends the "the AI never does money math"
  principle. The user sees the amount before saving. A stricter design would ask for
  the parts and sum them in code.
- **A date in an ambiguous note may apply to only some items** ("… and uber home 23
  last friday" dated only the Uber). The review step catches this.
- **The queue lives only in the open dialog.** Closing it discards the remaining
  drafts, and there's no "skip this one" yet (Cancel discards all).
- **Kind defaults to expense** when the AI can't tell. The user sees and can flip
  the toggle before saving.
- Voice input is unavailable in Firefox (no API) and Brave (no speech service);
  typing works everywhere. See 4.7.

### 4.7 Voice input and Quick add

**Goal:** add a transaction by speaking, e.g. *"bought bread from No Frills"*, or
by typing from a shortcut in the header.

**How it works:** voice is just another way to type into the ✨ Fill box.
Speech-to-text happens in the **browser**, and the resulting text goes through the
same `/api/ai/parse-transaction` endpoint, with no server changes.

```
🎙 speak ──► browser speech recognition ──► text in the Fill box ──► (pause) ──► auto-Fill
⌨️ type ─────────────────────────────────────────┘                    (Enter / ✨ Fill)
```

| Piece | File | Notes |
|---|---|---|
| Speech wrapper | `client/src/speech.js` | Feature detection (standard and `webkit` names), one phrase per tap, live transcript, friendly error messages. Tested with a fake recognizer. |
| 🎙 mic in the Fill box | `AddTransactionDialog.jsx` | Words stream into the box; **auto-fills when the speaker pauses**. ■ stops early. Closing the dialog discards the speech. The listening state uses the accent color, not red. |
| "🎙 Quick add" header button | `App.jsx` | Opens the dialog with the Fill box focused; icon-only on phones. The `N` shortcut still opens the plain form. |

**Browser support and privacy:**

| Browser | Voice | Speech is transcribed by |
|---|---|---|
| Chrome / Edge | ✅ | Google (audio is sent to Google's servers) |
| Safari | ✅ | Apple dictation (may need to be enabled in macOS settings) |
| Brave | Hidden | Brave exposes the API but has no speech service (every attempt fails with `network`), so the app detects `navigator.brave` and hides the mic |
| Firefox | Hidden | No Web Speech API |

Only the **text** reaches Ledgerly's server and DeepSeek; audio never does.

**Implementation note:** speech ends about a second after it starts, inside a
callback created when listening began. To avoid acting on stale form values,
that callback calls the latest `fillFromText` through a ref.

**Alternatives considered:** recording audio and sending it to a paid speech-to-text
API. That works in every browser with consistent quality, but needs a second provider,
an API key, audio uploads and per-minute cost. Showing the transcript and waiting for
a ✨ Fill click was also considered; auto-fill was chosen because the form is reviewed
anyway and the transcript stays visible.

---

## 5. Ask your ledger (built)

### 5.1 Goal

Answer questions like *"Did I spend more on dining in October than September?"*
or *"Am I over budget on anything?"* from the user's real data, with a short
plain-English answer and a note of what it's **based on**. Follow-ups ("and the
month before that?") work.

### 5.2 Key concepts

- **Tool:** a function in our code that the AI may *ask* us to run. It has a
  **menu entry** the AI sees (name, description, inputs as JSON Schema) and a
  **real implementation** it never sees (SQL on the user's database).
- **Agent loop:** the AI decides the steps. Each round it either answers, or asks for
  one or more tools; we run them, send the results back, and it goes again,
  up to 5 rounds.
- The AI **never touches the database** and can only request what's on the menu.
  There is no tool that changes data.

### 5.3 Flow

```
Dashboard card: "Did I spend more on dining in October than September?"
                (amounts below are illustrative)
  │
  ▼
POST /api/ai/ask { question, today, history }   (history = last 6 messages)
  │
  ├─ 400 bad input · 503 no AI key
  ▼
askLedger() → ai.runTools(system prompt, messages, tool menu)
  │
  │  round 1  AI: "run get_spending_by_category(Oct) and (Sep)"
  │           us: 2 SQL queries → formatted results back
  │  round 2  AI: "run calculate(percent_change, [$356.10, $412.30])"
  │           us: exact math in cents → "+15.8%"
  │  round 3  AI: final answer (no tool requests) → loop ends
  │           (max 5 rounds → friendly "try something narrower")
  ▼
{ answer, based_on: ["spending by category (October 2026)", …] }   (AI failure → 502)
  │
  ▼
Card: question bubble → answer → "Based on: …" in small muted text
```

### 5.4 Implementation (steps A–E)

| Step | Piece | File(s) |
|---|---|---|
| A | Read-only tools: menu + SQL + validation | `server/src/ai/ledger-tools.js`, `formatCents` in `money.js` |
| B | Generic agent loop + ledger-specific `askLedger()` | `runTools()` in `server/src/ai/client.js`, `server/src/ai/ask-ledger.js` |
| C | `POST /api/ai/ask` endpoint | `server/src/routes/ai.js` |
| D | Dashboard card | `client/src/ask.js`, `client/src/components/AskLedgerCard.jsx` |
| E | Calculator tool, friendly date labels, this doc | `server/src/ai/calculator.js`, `server/src/dates.js` |

**A: The tools.** All are read-only and use the **same definitions as the dashboard**:
spending = expense categories + uncategorized money out; `transfer` never counts.

| Tool | Returns | Limits |
|---|---|---|
| `get_spending_by_category({ from, to })` | Total, per-category spent, share of total, count, `ledger_starts` | |
| `list_transactions({ from, to, category?, search?, limit? })` | Rows newest first, plus count and total of **all** matches | ≤ 50 rows; transfers hidden |
| `get_account_balances()` | Balance per account and net worth | |
| `get_budgets({ month })` | Limit, spent, % used, "over by $x" / "$y left" | |
| `get_monthly_totals({ from_month, to_month })` | Income, spending, net per month, `ledger_starts` | ≤ 24 months |
| `calculate({ operation, values })` | Exact result of add / subtract / multiply / divide / average / percent_of / percent_change | ≤ 50 values; no `eval` |

- **Amounts and percentages are computed and formatted by our code** (`"$1,234.56"`,
  `"72%"`). The AI quotes them; it never does money math.
- **Bad inputs return `{ error }`, not an exception.** The AI reads the message in the
  next round and fixes its call (e.g. an unknown category gets the list of valid ones).
- **No SQL injection:** AI-provided text (search, category) only ever goes into `?`
  placeholders. A test searches for `'; DROP TABLE transactions; --`.
- `run()` only accepts tools on the menu (`Object.hasOwn`, so `"toString"` isn't a tool).

**B: The loop.**
- `runTools()` in `client.js` is **generic**: it knows the provider's tool format but
  nothing about ledgers. `askLedger()` knows the ledger but nothing about DeepSeek.
  The menu is provider-neutral (`{ name, description, parameters }`); `client.js`
  wraps it into DeepSeek's `{ type: "function", function }`.
- Guards: max 5 rounds (returns `exhausted`, turned into a friendly answer);
  malformed tool arguments are reported back to the model; an empty or cut-off final
  answer is an `AiError` (→ 502); token usage is summed across rounds.
- Each request sends a **snapshot** of the conversation (`[...conversation]`).
  Passing the array we keep appending to would alias it; a test caught this.
- The system prompt (constant, so cacheable): use tools for every number; quote amounts
  exactly; **never do arithmetic, use `calculate`**; per-month averages count only
  months since `ledger_starts`; resolve relative dates from the given today; retry after
  tool errors; say so when there's no data; refuse off-topic questions; answer directly
  in 1–4 plain sentences.
- **"Based on"** = labels of the *successful* tool runs, de-duplicated, with friendly
  dates ("spending by category (Nov 1–12, 2026)", "calculation (divide)").

**C: The endpoint.** It validates the question (≤ 500 characters), `today` (a real date) and
`history` (≤ 20 items, each `{ role: "user" | "assistant", content ≤ 2000 }`).
**Only the last 6 messages are sent** to the AI, stripped to `role` and `content`.
Any other role (e.g. `"system"`) is rejected: history comes from the browser, so it is
untrusted input and must not be able to inject operator instructions (prompt injection).

**D: The card.** It sits under the summary numbers and handles all four states:
- **empty:** clickable example questions
- **loading:** "Looking at your ledger…" with skeleton lines
- **error:** ⚠ + text + **Try again** for that question only
- **success:** the answer + "Based on"

One question at a time. Follow-ups send the last 3 *answered* question/answer
pairs, and failed questions aren't sent. 🎙 reuses `speech.js` and asks when the
speaker pauses. **Clear** drops the conversation; a late answer whose turn was cleared is
ignored automatically (its id no longer exists).

### 5.5 Alternatives considered

| Decision | Chosen | Rejected and why |
|---|---|---|
| How the AI gets data | Tools fetch exactly what's needed | Pasting the ledger into the prompt: costly, slow, shares more data than needed |
| Follow-ups | Last 6 messages from the browser | One question at a time (follow-ups fail); full history (cost grows every question) |
| Where it lives | Dashboard card | Chat panel behind a header button (one more button in a busy phone header) |
| Trust | "Based on" line per answer | Answer only (wrong answers are hard to spot) |
| Calculations | `calculate` tool with fixed operations | Prompt rule alone (the model computed anyway, see 5.6); a free-form expression with `eval` (lets AI-sent text run as code on the server) |
| Thinking | Off | On: possibly better multi-step planning, but slower and more tokens; answers were already correct. Revisit if quality drops |
| Streaming | Not yet | Token-by-token display: nicer for long answers, but answers are 1–4 sentences and arrive in 2–4 s |

### 5.6 Results (manual smoke tests, demo data, today = 2026-11-12)

| Question | Answer | Tools | Rounds |
|---|---|---|---|
| What is my checking account balance? | $8,205.45; net worth $19,716.78 | balances | 2 |
| How much did I spend on dining out last month? | $46.10 in October, 3% of spending | spending (Oct) | 2 |
| *and the month before that?* (follow-up) | No transactions in September | spending (**Sep**) | 2 |
| Am I over budget on anything this month? | Dining Out: $294.59 of $200.00, over by $94.59 | budgets | 2 |
| By what percent did dining change Oct → Nov? | +539.0% ($46.10 → $294.59) | spending ×2, calculate | 3 |
| What is the capital of France? | Only answers questions about the ledger | none | 1 |

About **2–5 s** and **$0.0004–0.0012** per question. Roughly 1,000 input tokens per
request are the constant prompt and menu, which are cacheable.

**Before/after: "how much did I spend on dining out on average this year".**
Without a calculator, the AI computed averages itself, divided by **10.4 months**
(though data only starts in September) and contradicted itself:
*"…about $32.76 per month… I can't give a single average figure…"*. After adding
`calculate` and `ledger_starts`: *"You spent $340.69 on dining out this year,
averaging **$170.35 per month**. Note that your ledger only starts on 2026-09-27,
so that average covers just 2 months of data."*

**Lessons:** (1) A prompt rule is weaker than giving the model the right tool.
(2) A calculator fixes **arithmetic**, not **judgement**: the old division was correct,
but the divisor was wrong. The fix needed `ledger_starts` too.

### 5.7 Known limitations

- **Rounding mid-chain:** multi-step math rounds at each step. "Per week at this
  month's rate" became $294.59 ÷ 12 = $24.55, then × 7 = **$171.85**, where exact is
  $171.84. A `scale` operation (× a ÷ b in one step) would avoid this.
- **Which months count** for averages is a judgement: with data starting Sep 27 the AI
  divided by the 2 months that had dining, not 3 calendar months. It says how many
  months the average covers.
- **History is client-held.** Earlier answers come back from the browser; a tampered
  history could put words in the assistant's mouth (but not system instructions).
  Acceptable for a single-user app.
- The conversation is lost on reload, and there's no streaming.
- Questions about things the tools can't see (e.g. merchants' locations, future bills)
  get "no data" answers; new tools would be needed.

---

## 6. Receipt scanning (planned)

### Goal
Upload or photograph a receipt → pre-filled Add Transaction form for review.

### Proposed design
- `POST /api/ai/scan-receipt` (multipart upload) → same `{ drafts: [...] }` shape as
  natural-language entry, so both features share the form pre-fill and queue code
  (several receipts in one photo would simply queue).
- Uses `deepseek-flash` image input. The exact request format needs verifying against
  DeepSeek's vision docs before building.
- Limits: image type (JPEG, PNG, HEIC converted on the client), max size (~5 MB).
  Downscale on the client to cut tokens and upload time.
- **Privacy:** the image isn't stored by default; only the confirmed transaction is
  saved.
- Totals: use the receipt's final total (after tax and tip); itemization is out of scope.

### Open questions
- Store receipt images as attachments (needs a storage design)?
- What if the receipt's total can't be read? Return a partial draft with the amount empty.

---

## 7. Monthly insights (planned)

### Goal
A short, plain-language summary of the month, e.g. *"You spent 18% less on
dining than last month; Groceries went over budget by $42."*

### Proposed design
- **Numbers are computed in SQL**, using the same queries as the summary and budgets
  endpoints. The AI receives the pre-computed figures and **only writes the prose**,
  so it can't invent or miscalculate amounts.
- Respects `CLAUDE.md`: `transfer` is excluded, amounts are cents converted for display.
- **Cached per month** in the database. It's regenerated when that month's transactions
  change, or on demand, so viewing the dashboard doesn't cost a call each time.
- UI: a card on the dashboard, with "needs attention" items (over budget) following
  the red-only-for-attention rule.

### Open questions
- Generate automatically at month end, or only when the user opens the card?
- Check that every number in the generated text appears in the input figures
  (a cheap hallucination guard)?

---

## 8. Decision log

| Date | Decision | Why | Alternatives |
|---|---|---|---|
| 2026-11-10 | **DeepSeek (`deepseek-flash`)** as the AI provider | Cost was the deciding factor | Claude Haiku 5.5 (actually slightly cheaper on paper at $0.10/$0.50 per 1M; differences are fractions of a cent per call at this scale), Claude Opus 5.5 (higher quality ceiling, ~25–35× the cost), local models (free but weaker and hard to deploy). Note: DeepSeek processes data on servers in China; this was considered acceptable for this project. |
| 2026-11-10 | `openai` SDK against DeepSeek's OpenAI-compatible endpoint | DeepSeek's primary documented path | DeepSeek's Anthropic-compatible endpoint (compatibility layers lag on features) |
| 2026-11-10 | `.env` loaded with Node's `--env-file-if-exists` | Built into Node 24; the server runs without a key | `dotenv` package |
| 2026-11-10 | Key retrieved from 1Password into `.env` | Key never pasted or shown in chat | `op run` with `op://` references (blocked by macOS app-data permissions in iTerm; possible upgrade later) |
| 2026-11-11 | History before AI for categorization | Free, instant, follows the user's own choices | AI only |
| 2026-11-11 | Natural-language entry: the AI resolves relative dates; the box lives in the dialog | Handles any phrasing; review happens where the fields are | `chrono-node`; dashboard quick-add bar |
| 2026-11-11 | Parse and categorize in one AI call | Kind is unknown until the note is read; one call halves cost and latency | Parse, then call `/categorize` |
| 2026-11-11 | Voice input via the browser's Web Speech API, auto-fill on pause, "Quick add" opens the dialog | Free, no server changes, reuses parse-transaction; the review step stays | Paid speech-to-text API; transcript-then-click; separate quick-add pop-up |
| 2026-11-11 | Several transactions per note: the AI returns a list (max 5), queued through the normal form | The one-object shape gave dropped, merged or amount-less results; the queue keeps review per transaction with little new UI | Review list with "Save all"; fill the first and warn |
| 2026-11-11 | Hide the mic in Brave | Brave has the API but no speech service, so it always fails with `network` | Show it and explain the error |
| 2026-11-13 | Transfers as linked transaction pairs (`transfers` table, `transfer_id`, "Account transfer" category), not full double-entry | Fixes double-counted card payments with one additive migration; every existing query keeps working | One row with from/to; full double-entry (rewrite of all queries, AI tools and import) |
| 2026-11-13 | Suggest transfer pairs on import: opposite amount, ±3 days, transfer-like wording, user confirms | Removes the double count without hiding real spending by mistake | Amount/date only; automatic linking |
| 2026-11-12 | Skip the import's column step only when nothing was guessed; reject non-CSV files on step 1 | Less friction for clear files, while guessed mappings (which silently corrupt data) still get confirmed | Always ask; never ask |
| 2026-11-12 | CSV import: parse in the browser (papaparse), heuristic column mapping the user confirms, categories reviewed per merchant, all-or-nothing import with counted duplicates | Free and private (no bank-sync service), predictable, scales to 2,000 rows | Bank-sync APIs (cost, approvals, third-party access); AI column mapping; per-row review |
| 2026-11-12 | Batch categorization: history index, de-duplicated merchants, AI batches of 50 matched by number | 40 rows → 2 calls; repeat imports are free | One AI call per row |
| 2026-11-12 | Ask your ledger via tool use: 5 read-only SQL tools, a generic agent loop (max 5 rounds), dashboard card with "Based on" | Exact numbers from SQL, minimal data sent, the AI can't change anything; answers are traceable | Paste the ledger into the prompt; chat panel |
| 2026-11-12 | Follow-ups: last 6 messages from the browser, user/assistant roles only | Context for "and the month before?" at bounded cost; blocks injected system messages | No memory; full history |
| 2026-11-12 | A `calculate` tool (fixed operations, integer cents) + `ledger_starts` | The model computed averages itself, with the wrong divisor; a prompt rule alone wasn't enough | Prompt rule only; free-form expressions with `eval` (code execution risk) |
| 2026-11-11 | Failures: silent for automatic helpers, shown for user-triggered actions | Don't nag about things the user didn't ask for; always answer a click | Always silent, or always shown |
