# Ledgerly

**A personal finance ledger you can talk to.** Type, say or photograph a purchase and
it fills itself in; import a bank CSV and it categorizes everything; ask *"Am I over
budget on anything?"* and get an answer from your real data, with every number computed
by code, never invented by the AI.

**▶ Try it live: [ledgerly-demo-gca0.onrender.com](https://ledgerly-demo-gca0.onrender.com)**
(made-up data that resets every hour; on the free plan, the first visit after a quiet
spell can take up to a minute to wake the server). Things to try:
- **Ask your ledger:** *"Which month did I spend the most on dining out?"*
- **Quick add:** *"coffee at Tims for 4 and chips at Five Guys for 15"*, or 📷 a receipt
- **Import CSV:** download [`visa-2026-11.csv`](samples/visa-2026-11.csv) and import it
  into the **Visa** account; known merchants are categorized from history, the rest by AI
- **Click any transaction** to edit or delete it (with Undo)

![Ledgerly dashboard: summary, AI monthly insights, Ask your ledger, accounts and transactions](docs/screenshots/dashboard.png)

> **Design principle:** the AI only *proposes*. Code validates every field, computes every
> number, and the user confirms before anything is saved.

---

## Features

**Core ledger**
- Accounts (checking, savings, credit card, cash) with balances **derived** from transactions
- Transactions with search and filters, categories, monthly budgets with pace markers
- **Edit or delete** any transaction by clicking it; deletes take effect at once, with
  **Undo** in the confirmation (a transfer is edited or deleted as a pair)
- **Transfers between accounts** stored as linked pairs, so a credit-card payment isn't
  counted as both spending and income
- **CSV import** from any bank: column auto-detection, date-format detection, sign
  flipping for credit cards, duplicate skipping, and suggested **transfer pairs** across files

**AI features** (DeepSeek `deepseek-flash`)

| Feature | What it does |
|---|---|
| **Auto-categorize** | Suggests a category as you type; reuses your own history first (free, instant) |
| **✨ Fill** (typed or 🎙 spoken) | *"coffee at Tims for 4 and chips at Five Guys for 15 today"* → two draft transactions, filled in one after another |
| **📷 Receipt scanning** | A photo → store, final total, date and category, shrunk in the browser and never stored |
| **Ask your ledger** | Answers questions with an **agent loop** over read-only SQL tools plus a calculator tool |
| **Monthly insights** | A written summary of the month; a guard drops any sentence with a number not in the computed facts |
| **Batch categorization** | A 300-row bank file → a few AI calls (history first, de-duplicated merchants, batches of 50) |

| | | |
|---|---|---|
| ![✨ Fill: one sentence, two transactions](docs/screenshots/fill.png) | ![Ask your ledger with a 'based on' line](docs/screenshots/ask-your-ledger.png) | ![Receipt scanning](docs/screenshots/receipt-scan.png) |
| **✨ Fill** with a queue for the second purchase | **Ask your ledger** shows what each answer is based on | **📷 Receipt** read into the form |
| ![CSV import suggesting a transfer pair](docs/screenshots/import-transfer-match.png) | ![Transfers in the transaction list](docs/screenshots/transfers-in-list.png) | ![Dashboard on a phone, dark mode](docs/screenshots/dashboard-phone-dark.png) |
| **CSV import** spotting a card payment in two files | **Transfers** shown as ⇄ pairs | Phone width, **dark mode** |

---

## How the AI is designed

These are the parts most worth reading in the code:

1. **One provider module.** [`server/src/ai/client.js`](server/src/ai/client.js) is the only
   file that knows about DeepSeek. Features call `completeJson()` or `runTools()`; tests
   inject a fake, so the test suite is free, fast and offline.
2. **Never trust model output.** Every field the AI returns goes through the same
   validation as user input (real dates, not in the future; amounts parsed by our code
   into integer cents; categories must exist and be the right kind). Invalid → empty, not
   an error.
3. **Tool use with guardrails.** *Ask your ledger* gives the model six read-only tools
   (spending by category, transactions, balances, budgets, monthly totals, calculator).
   The model never touches the database; the loop is capped at 5 rounds; bad tool
   arguments are returned as errors so it can correct itself; AI text only reaches SQL
   through `?` placeholders.
4. **Numbers come from code.** Tools return pre-formatted amounts and percentages; a
   `calculate` tool does exact integer-cent arithmetic; monthly insights are checked
   number by number against the facts.
5. **The cheapest AI call is no AI call.** The user's own history answers first; the
   AI is asked only about unknown merchants, in batches.
6. **Output shape over prompt tweaks.** When "two purchases in one sentence" gave three
   different wrong answers, the fix was a *list* schema, not a cleverer prompt.

The full reasoning (alternatives, results, costs and known limitations for every
feature) is in the **[design doc](docs/design/ai-features.md)**, including a decision log.

---

## Architecture

```
React (Vite) ──/api──► Express ──► SQLite (node:sqlite, raw SQL, migrations)
                          │
                          └──► server/src/ai/client.js ──► DeepSeek API
```

- **Money is integer cents** everywhere; dollars only for display.
- **Balances are derived** (`SUM` of transactions), never stored.
- **Multi-step writes** (imports, transfers) use database transactions: all or nothing.
- **Schema changes** go through numbered migrations (`PRAGMA user_version`), each tested
  against a frozen copy of the previous schema.
- **The API key stays on the server**; the browser never sees it.

| | |
|---|---|
| Backend | Node.js 24, Express 5, `node:sqlite` |
| Frontend | React, Vite, plain CSS with design tokens (light + dark) |
| AI | DeepSeek via the `openai` SDK (OpenAI-compatible API) |
| Parsing | `papaparse` for CSV |
| Tests | Vitest + Supertest: **420 server tests, 215 client tests** |

---

## Running it locally

**Requirements:** Node.js 24+, and a [DeepSeek API key](https://platform.deepseek.com)
for the AI features. The ledger works without one; AI features say they're unavailable.

```bash
git clone https://github.com/Pooja9810/ai-ledger.git && cd ai-ledger
cd server && npm install && cp .env.example .env   # add DEEPSEEK_API_KEY to .env
cd ../client && npm install
```

Two terminals:

```bash
# 1. API with six months of fake demo data (never touches your real ledger.db)
cd server && npm run seed && npm run dev:demo        # http://localhost:3001

# 2. Web app (proxies /api to the server)
cd client && npm run dev                             # http://localhost:5173
```

Use `npm run dev` instead of `dev:demo` for your real ledger (`server/ledger.db`).
To try CSV import, use the fake bank exports in **[`samples/`](samples/)**.

**Tests:** `cd server && npm test` · `cd client && npm test`

### The hosted demo

The live demo runs on [Render](https://render.com) from [`render.yaml`](render.yaml)
(a Blueprint: the service's build, start command and settings are in git).
One Express server serves both the API and the built React app. With `DEMO_MODE=true`:

- **Made-up data only, in memory.** Every hour the server builds a fresh database with
  the generated demo data and switches to it in one step, so no visitor sees a
  half-reset ledger and the real `ledger.db` is never involved.
- **AI requests are limited** (30 per visitor per hour, 500 per day; adjustable with
  `AI_LIMIT_PER_VISITOR_PER_HOUR` and `AI_LIMIT_PER_DAY`), since each call costs money.
- The API key is a secret setting in Render, never in the repository.

---

## Project structure

```
server/src/
  ai/            client.js (provider), categorize*, parse-transaction, scan-receipt,
                 ledger-tools + calculator + ask-ledger (agent), insights
  routes/        accounts, transactions (+ import), transfers, categories, budgets,
                 summary, ai
  db/            schema.sql (latest schema), migrations.js
  import-transactions.js, transfer-matching.js, transfers.js, merchants.js
client/src/
  components/    dashboard cards, Add Transaction dialog, Import dialog
  *.js           pure, tested logic: csv, importer, draft, ask, speech, image, transfer…
docs/design/     ai-features.md, the design doc and decision log
samples/         fake bank CSVs + generator
```

---

## Known limitations & next steps

- Single user, no authentication yet (a requirement before any public deployment with
  real data).
- Merchant matching is text-based: `AMZN MKTP` vs `Amazon` won't match history.
- Transfers link two accounts; split transactions (one receipt, several categories)
  would call for full double-entry, considered and deferred (see the design doc).
- Receipt numbers for exact duplicate detection: designed, deferred until needed.
- Refunds are filed as income (the app assumes a positive amount is income); see the
  design doc for the planned fix.
- Undo re-creates a deleted row (new id). A transfer matched from two CSV rows comes back
  with one shared description.

---

## About this project

Built as a portfolio project by **Pooja** with
[Claude Code](https://claude.com/claude-code) as an AI pair programmer. The design
decisions (provider choice, data model, matching rules, UX trade-offs) were discussed and
made step by step, and are recorded with their reasoning in the
[design doc](docs/design/ai-features.md).
