# Ledgerly — AI-powered personal ledger

Portfolio project. A personal finance ledger you can talk to: core ledger
(accounts, transactions, categories, budgets, dashboard, CSV import) plus AI
features (natural-language entry, auto-categorization, "ask your ledger" via
tool use, receipt scanning, monthly insights).

## Working with the developer (important)
- The developer is learning. For every non-trivial step, explain **what**,
  **why**, **alternatives considered**, and **expected outcome**.
- Work in small steps. Don't generate large amounts of unexplained code.
- Occasionally ask the developer to predict an outcome or make a decision.
- Mark key concepts with 💡.

## Stack
- Backend: Node.js (v24) + Express, JavaScript with ES modules (`import`/`export`)
- Database: SQLite via Node's built-in `node:sqlite` (no `better-sqlite3`;
  avoids native compilation). Raw SQL; may migrate to PostgreSQL later.
- Frontend: React + Vite
- AI: Claude API via `@anthropic-ai/sdk`
- Tests: Vitest

## Conventions
- **Money is stored as integer cents** (`$12.50` → `1250`). Never use floats
  for money. Convert to dollars only for display.
- Dates stored as ISO 8601 strings (`2026-11-09`).
- Expenses are negative amounts, income is positive.
- Account balances are **derived** (SUM of transactions), never stored.
  New accounts get an "Opening balance" transaction.
- Schema lives in `server/src/db/schema.sql`. Transfers between accounts are
  deferred (planned: two linked transactions).
- Secrets live in `.env` (gitignored). Document required keys in `.env.example`.
- Commit small and often, with clear messages.

## Commands
Monorepo: `server/` (API) and `client/` (React, not yet created).
- `cd server && npm test` — run tests once
- `cd server && npm run test:watch` — re-run tests on file changes

## Build order
1. Setup → 2. Backend API + tests → 3. React frontend → 4. AI features → 5. Polish & deploy
