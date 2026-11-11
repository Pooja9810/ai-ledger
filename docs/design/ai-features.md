# Ledgerly AI features: design doc

**Status:** living document. Built features describe what the code does; planned
features are proposals that get updated when they're built.
**Last updated:** 2026-11-11

## Contents

1. [Overview](#1-overview)
2. [Shared foundation](#2-shared-foundation)
3. [Auto-categorize (built)](#3-auto-categorize-built)
4. [Natural-language entry (planned)](#4-natural-language-entry-planned)
5. [Ask your ledger (planned)](#5-ask-your-ledger-planned)
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
| Natural-language entry | "spent $12.50 on lunch yesterday" → filled form | Single call, JSON extraction | Planned |
| Ask your ledger | "How much did I spend on dining in October?" | Tool use (agent loop) | Planned |
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
| `503` | AI not configured on the server | Hide or skip the AI helper |
| `502` | The AI provider failed or returned junk | Fail quietly or offer a retry; safe generic message, details only in server logs |

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
- **History scan is linear.** If it ever becomes slow, store a normalized merchant
  column (this needs a migration).
- The CSV import doesn't use auto-categorize yet. Batching many descriptions into
  one request is the planned approach.

---

## 4. Natural-language entry (planned)

### Goal
Type `spent $12.50 on lunch yesterday at Chipotle` and get the Add Transaction form
pre-filled. **The user reviews and saves**; nothing is saved automatically.

### Proposed design
- `POST /api/ai/parse-transaction { text, today }` → `{ draft: { amount_cents, date, description, category_id, kind } }`.
- `today` comes from the **client**, since the transaction date is the user's local
  calendar day (see `CLAUDE.md`). It goes in the user message, not the system prompt,
  to keep the prompt cacheable.
- The AI returns **dollars as a string** (`"12.50"`). Our code converts it to cents with
  the existing parser, so the model never does money math.
- The category is resolved through the auto-categorize pipeline (history, then AI), not
  a separate guess.
- Every field is validated with the same rules as `POST /api/transactions`;
  invalid or missing fields stay empty in the form rather than failing the request.

### Open questions
- Should relative dates ("last Friday") be resolved by the AI or by our code?
  Proposal: the AI returns the phrase's resolved ISO date, and we validate that it's a real
  date and not in the future.
- One input box at the top of the dialog, or a separate quick-add bar on the dashboard?

---

## 5. Ask your ledger (planned)

### Goal
Answer questions like *"How much did I spend on dining in October compared to
September?"* using the user's real data.

### Proposed design: tool use
The model doesn't receive the ledger. It receives **tools** (function descriptions),
asks us to run them, and answers from the results:

| Tool | Returns |
|---|---|
| `get_spending_by_category({ from, to })` | Totals per category, in cents |
| `list_transactions({ from, to, category?, search?, limit })` | Matching rows (capped) |
| `get_account_balances()` | Derived balances |
| `get_budgets({ month })` | Limits and spending |

- **All tools are read-only** and are implemented with our existing SQL. The model can't
  write anything.
- **Agent loop with limits:** at most ~5 tool rounds per question, and a token cap.
- Tool results are **computed by our code**, so numbers are exact. The model only
  explains them; it's instructed not to do arithmetic that a tool can do.
- Tool inputs from the model are validated like any API input (dates, limits).
- Thinking may be turned **on** here, since multi-step questions benefit from it. Decide
  by measuring quality against cost.
- UI: a chat panel; answers are shown with the figures they're based on.

### Open questions
- Keep conversation history (follow-up questions) or one question at a time?
- Stream the answer token-by-token for responsiveness?

---

## 6. Receipt scanning (planned)

### Goal
Upload or photograph a receipt → pre-filled Add Transaction form for review.

### Proposed design
- `POST /api/ai/scan-receipt` (multipart upload) → same `draft` shape as
  natural-language entry, so both features share the form pre-fill code.
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
