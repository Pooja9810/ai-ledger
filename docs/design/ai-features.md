# Ledgerly AI features: design doc

**Status:** living document. Built features describe what the code does; planned
features are proposals that get updated when they're built.
**Last updated:** 2026-11-11 (natural-language entry + voice input built)

## Contents

1. [Overview](#1-overview)
2. [Shared foundation](#2-shared-foundation)
3. [Auto-categorize (built)](#3-auto-categorize-built)
4. [Natural-language entry (built)](#4-natural-language-entry-built)
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
| Natural-language entry (typed or 🎙 spoken) | "spent $12.50 on lunch yesterday" → filled form | Browser speech-to-text + single call, JSON extraction | ✅ Built |
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
- **History scan is linear.** If it ever becomes slow, store a normalized merchant
  column (this needs a migration).
- The CSV import doesn't use auto-categorize yet. Batching many descriptions into
  one request is the planned approach.

---

## 4. Natural-language entry (built)

### 4.1 Goal

Type a note like `spent $12.50 on lunch at Chipotle yesterday`, press **✨ Fill**,
and the Add Transaction form fills itself in. **The user reviews and saves;
nothing is saved automatically.**

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
  ├─ 1. ONE AI call: kind, amount (as text), date, description, category
  │      (AI failure ──► 502 ──► "⚠ Couldn't reach the AI, try again")
  ├─ 2. Our code validates every field (invalid → empty, never an error)
  ├─ 3. History overrides the AI's category if this merchant was seen before
  │
  ▼
{ draft: { kind, amount_cents, date, description, category, category_source } }
  │
  ▼
Form: fill only the fields the AI found → "ℹ Couldn't find an amount…" if needed
      → focus moves to the first thing still missing (amount, else Account)
```

### 4.3 Implementation (steps A–C)

| Step | Piece | File(s) |
|---|---|---|
| A | `parseTransaction(ai, { text, today, categories })` + server dollar parser | `server/src/ai/parse-transaction.js`, `server/src/money.js` |
| B | `POST /api/ai/parse-transaction` endpoint | `server/src/routes/ai.js` |
| C | "✨ Fill" box at the top of the Add Transaction dialog | `client/src/draft.js`, `AddTransactionDialog.jsx` |

**A: One call, every field validated.**
- **One AI call, not two.** The kind (expense or income) isn't known until the note is read,
  so the AI gets *both* category lists and picks a category in the same answer as
  the other fields. That's half the cost and latency of parsing first and then categorizing.
- The user message carries `Today: 2026-11-11 (Wednesday)`. The weekday lets the
  model resolve "last Friday" correctly. The system prompt stays constant and cacheable.
- **The AI never does money math.** It returns the amount as written (`"12.50"`); our
  `parseDollarsToCents` (a server copy of the client's parser) converts it to cents.
- Validation per field. Invalid values become empty, so the form keeps its default:

| Field | Rule | If invalid |
|---|---|---|
| `kind` | `"expense"` or `"income"` | Defaults to `expense`, the form's default |
| `amount` | Our parser → whole cents, non-zero | `null` |
| `date` | A real date and **not after `today`** | `null` (form keeps today) |
| `description` | String, trimmed, ≤ 200 characters | `""` |
| `category` | An exact name from the list **of the right kind**, never `transfer` | `null` |

**B: The endpoint.** It validates `text` (required, ≤ 500 characters) and `today` (a real
date). Unlike `/categorize`, there's no AI-free path, so a missing key is always `503`.
The user's history overrides the AI's category (`category_source: "history"`). The
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
- Late answers (the dialog was closed mid-request) are ignored using a request counter.
- Amounts become form text with integer math only (`1999` → `"19.99"`; float division
  would risk `19.989999…`).

### 4.4 Alternatives considered

| Decision | Chosen | Rejected and why |
|---|---|---|
| Resolving relative dates | The AI returns an ISO date; code checks it's real and not in the future | `chrono-node` date library: exact, but a new dependency that struggles with unusual phrasing |
| Where the box lives | Top of the Add Transaction dialog | Dashboard quick-add bar: still needs a review step, so it would open the dialog anyway |
| Category | Picked in the same AI call | A second call through `/categorize`: twice the cost and latency |
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

### 4.6 Known limitations

- **History rarely matches bank-style descriptions.** The AI writes clean names
  (`Amazon`), while imported history has bank text (`AMZN MKTP US*2K4`), so the
  history override mostly applies to merchants entered by hand or with Fill. This shares a
  root cause with the merchant-matching limitation in 3.6.
- **`today` is trusted from the browser.** A wrong client clock shifts relative
  dates. That's acceptable for a single-user app; a multi-user deploy could reject values
  more than a day from the server's date.
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
| 2026-11-11 | Natural-language entry: the AI resolves relative dates; the box lives in the dialog | Handles any phrasing; review happens where the fields are | `chrono-node`; dashboard quick-add bar |
| 2026-11-11 | Parse and categorize in one AI call | Kind is unknown until the note is read; one call halves cost and latency | Parse, then call `/categorize` |
| 2026-11-11 | Voice input via the browser's Web Speech API, auto-fill on pause, "Quick add" opens the dialog | Free, no server changes, reuses parse-transaction; the review step stays | Paid speech-to-text API; transcript-then-click; separate quick-add pop-up |
| 2026-11-11 | Hide the mic in Brave | Brave has the API but no speech service, so it always fails with `network` | Show it and explain the error |
| 2026-11-11 | Failures: silent for automatic helpers, shown for user-triggered actions | Don't nag about things the user didn't ask for; always answer a click | Always silent, or always shown |
