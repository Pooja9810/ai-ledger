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
- Transaction `date` = calendar day in the user's local time (`2026-11-09`).
  `created_at` timestamps = UTC (SQLite `datetime('now')`); convert only for display.
- API: REST under `/api/*`. Validate input in route code → 400 with `{ errors: [...] }`;
  DB constraints are the last line of defense. 5xx responses never leak internals.
- Multi-step writes use a DB transaction (`BEGIN`/`COMMIT`/`ROLLBACK`).
- Expenses are negative amounts, income is positive.
- Account balances are **derived** (SUM of transactions), never stored.
  New accounts get an "Opening balance" transaction.
- OPEN DESIGN ISSUE (decide before AI auto-categorization): opening balances are
  stored as uncategorized, so they look like "needs a category" and would distort
  income reports. Needs a non-income/expense marker (e.g. a transfer category kind).
- Schema lives in `server/src/db/schema.sql`. Transfers between accounts are
  deferred (planned: two linked transactions).
- Secrets live in `.env` (gitignored). Document required keys in `.env.example`.
- Commit small and often, with clear messages.

## UI design rules (client)
- Use only the tokens in `client/src/index.css` (colors, spacing, type, radius).
- Red is reserved for "needs attention" (over budget, errors), never for normal
  spending. Money in = green with "+"; money out = normal ink with a real minus (−).
- Status color is never the only signal: always pair it with an icon + text label.
- Every data view handles loading (skeleton), error, empty (with a next step), success.
- Verify UI changes by screenshot in light + dark; check phones at a true 390px
  width (headless Chrome can't go below ~500px, so use an iframe).

## Commands
Monorepo: `server/` (API) and `client/` (React + Vite).
- `cd client && npm run dev` — React app on http://localhost:5173; Vite proxies
  `/api/*` to the API on :3001, so run the server too (two terminals)
- `cd server && npm run dev` — start API on http://localhost:3001 (auto-restarts on save)
- `cd server && npm run seed && npm run dev:demo` — API on a fake-data `demo.db`
  (never touches the real `ledger.db`; use this when working on the UI)
- `cd server && npm test` / `cd client && npm test` — run tests once
- `cd server && npm run format` — format code with Prettier (defaults; `.prettierrc` at repo root)
- `cd server && npm run test:watch` — re-run tests on file changes

## Build order
1. Setup → 2. Backend API + tests → 3. React frontend → 4. AI features → 5. Polish & deploy
