import { Router } from "express";
import { AiError } from "../ai/client.js";
import { suggestCategory } from "../ai/categorize.js";
import { parseTransactions } from "../ai/parse-transaction.js";
import { imageProblem, scanReceipt } from "../ai/scan-receipt.js";
import {
  buildMonthFacts,
  dataFingerprint,
  writeInsights,
} from "../ai/insights.js";
import { MONTH_PATTERN } from "../dates.js";
import { askLedger } from "../ai/ask-ledger.js";
import { createLedgerTools } from "../ai/ledger-tools.js";
import { categorizeBatch } from "../ai/categorize-batch.js";
import { createHistoryIndex, findCategoryFromHistory } from "../merchants.js";
import { MAX_IMPORT_ROWS } from "../import-transactions.js";
import { isValidDate } from "../validation.js";

// Follow-up history limits for /ask.
const HISTORY_MAX = 20; // accepted from the client
const HISTORY_SENT = 6; // actually sent to the AI (3 question/answer pairs)
const HISTORY_CONTENT_MAX = 2000; // characters per message

function isValidHistory(history) {
  return (
    Array.isArray(history) &&
    history.length <= HISTORY_MAX &&
    history.every(
      (turn) =>
        turn !== null &&
        typeof turn === "object" &&
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string" &&
        turn.content.length <= HISTORY_CONTENT_MAX,
    )
  );
}

/**
 * AI endpoints. `ai` is the client from createAiClient(), or null when
 * no API key is configured (endpoints answer 503 when they need the AI).
 */
export function aiRouter(db, ai) {
  const router = Router();

  const listCategories = db.prepare("SELECT id, name, kind FROM categories");
  const ledgerTools = createLedgerTools(db); // read-only tools for /ask
  // Insights cache: "month|today|fingerprint" → result. In memory: rewritten
  // after a restart or whenever the month's data changes.
  const insightsCache = new Map();

  // 503: the feature is switched off on the server; not the caller's fault.
  const notConfigured = (res) =>
    res.status(503).json({ error: "AI features are not configured" });

  // The user's own history beats the AI's category pick (same rule as
  // /categorize). Adds category_source: "history" | "ai" | null to each draft.
  function withHistory(drafts) {
    return drafts.map((draft) => {
      const fromHistory = draft.description
        ? findCategoryFromHistory(db, {
            description: draft.description,
            amountCents: draft.kind === "expense" ? -1 : 1, // only the sign matters
          })
        : null;
      const category = fromHistory ?? draft.category;
      const category_source = fromHistory ? "history" : category ? "ai" : null;
      return { ...draft, category, category_source };
    });
  }

  // 502: the AI service we depend on failed. Log the details server-side,
  // send only a safe generic message. Anything that isn't an AiError is a
  // real bug: rethrow so the app's error handler answers 500.
  function aiFailed(res, label, err) {
    if (!(err instanceof AiError)) throw err;
    console.error(`AI ${label} failed:`, err.message, err.cause ?? "");
    res.status(502).json({ error: "AI service is unavailable, try again" });
  }

  // POST /api/ai/categorize  { description, amount_cents }
  // → 200 { suggestion: { id, name }, source: "history" | "ai" }
  //   or  { suggestion: null, source: null } (no confident match)
  router.post("/categorize", async (req, res) => {
    const { description, amount_cents } = req.body ?? {};
    const errors = [];
    if (typeof description !== "string" || description.trim() === "") {
      errors.push("description is required");
    } else if (description.length > 500) {
      errors.push("description must be at most 500 characters"); // caps cost
    }
    if (!Number.isInteger(amount_cents) || amount_cents === 0) {
      errors.push("amount_cents must be a non-zero whole number of cents");
    }
    if (errors.length > 0) return res.status(400).json({ errors });

    const input = { description, amountCents: amount_cents };

    // 1. The user's own history: free, instant, works without an AI key.
    const fromHistory = findCategoryFromHistory(db, input);
    if (fromHistory) {
      return res.json({ suggestion: fromHistory, source: "history" });
    }

    // 2. Otherwise ask the AI, if it's configured.
    if (!ai) return notConfigured(res);
    try {
      const suggestion = await suggestCategory(ai, {
        ...input,
        categories: listCategories.all(),
      });
      res.json({ suggestion, source: suggestion ? "ai" : null });
    } catch (err) {
      aiFailed(res, "categorize", err);
    }
  });

  // POST /api/ai/categorize-batch  { items: [{ description, amount_cents }] }
  // → 200 { suggestions: [{ category: { id, name } | null, source }], ai }
  // For bulk import: history first, then unique merchants in AI batches.
  // Works without an AI key (history only). `ai` tells the UI what happened:
  //   "used" | "not_needed" | "unavailable" (no key) | "partial" | "failed"
  router.post("/categorize-batch", async (req, res) => {
    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ errors: ["items must be a non-empty list"] });
    }
    if (items.length > MAX_IMPORT_ROWS) {
      return res
        .status(400)
        .json({ errors: [`at most ${MAX_IMPORT_ROWS} items per request`] });
    }
    const bad = items.findIndex(
      (it) =>
        it === null ||
        typeof it !== "object" ||
        typeof it.description !== "string" ||
        it.description.length > 500 ||
        !Number.isInteger(it.amount_cents) ||
        it.amount_cents === 0,
    );
    if (bad !== -1) {
      return res.status(400).json({
        errors: [
          `item ${bad + 1}: needs a description (at most 500 characters) and a non-zero whole amount_cents`,
        ],
      });
    }

    const { results, unknownMerchants, aiCalls, aiFailedBatches } =
      await categorizeBatch(ai, {
        items: items.map((it) => ({
          description: it.description,
          amountCents: it.amount_cents,
        })),
        categories: listCategories.all(),
        history: createHistoryIndex(db),
      });

    if (aiFailedBatches > 0) {
      console.error(
        `AI categorize-batch: ${aiFailedBatches}/${aiCalls} batches failed`,
      );
    }
    const status =
      unknownMerchants === 0
        ? "not_needed" // history knew everything
        : !ai
          ? "unavailable"
          : aiFailedBatches === 0
            ? "used"
            : aiFailedBatches < aiCalls
              ? "partial"
              : "failed";
    res.json({ suggestions: results, ai: status });
  });

  // GET /api/ai/insights?month=YYYY-MM&today=YYYY-MM-DD
  // → { month, empty: true } for a month with no transactions (no AI call), or
  //   { month, headline, points: [{ text, tone }], cached }
  router.get("/insights", async (req, res) => {
    const { month, today } = req.query;
    const errors = [];
    if (typeof month !== "string" || !MONTH_PATTERN.test(month)) {
      errors.push("month must be in YYYY-MM format");
    }
    if (!isValidDate(today))
      errors.push("today must be a real date in YYYY-MM-DD format");
    if (errors.length > 0) return res.status(400).json({ errors });

    const facts = buildMonthFacts(db, month, today);
    if (!facts) return res.json({ month, empty: true });

    // "today" is part of the key: "day 12 of 30" changes the summary.
    const key = `${month}|${today}|${dataFingerprint(db, month)}`;
    if (insightsCache.has(key)) {
      return res.json({ ...insightsCache.get(key), cached: true });
    }
    if (!ai) return notConfigured(res);
    try {
      const { headline, points } = await writeInsights(ai, facts);
      const result = { month, headline, points };
      for (const k of insightsCache.keys()) {
        if (k.startsWith(`${month}|`)) insightsCache.delete(k); // keep one per month
      }
      insightsCache.set(key, result);
      res.json({ ...result, cached: false });
    } catch (err) {
      aiFailed(res, "insights", err);
    }
  });

  // POST /api/ai/parse-transaction  { text, today: 'YYYY-MM-DD' }
  // → 200 { drafts: [{ kind, amount_cents, date, description, category,
  //                    category_source: "history" | "ai" | null }, ...] }
  // One note can describe several transactions (up to MAX_DRAFTS).
  // DRAFTS for the user to review in the form; nothing is saved here.
  // `today` comes from the browser: the user's local calendar day.
  router.post("/parse-transaction", async (req, res) => {
    const { text, today } = req.body ?? {};
    const errors = [];
    if (typeof text !== "string" || text.trim() === "") {
      errors.push("text is required");
    } else if (text.length > 500) {
      errors.push("text must be at most 500 characters"); // caps cost
    }
    if (!isValidDate(today)) {
      errors.push("today must be a real date in YYYY-MM-DD format");
    }
    if (errors.length > 0) return res.status(400).json({ errors });

    if (!ai) return notConfigured(res); // only the AI can read a sentence

    let drafts;
    try {
      drafts = await parseTransactions(ai, {
        text,
        today,
        categories: listCategories.all(),
      });
    } catch (err) {
      return aiFailed(res, "parse-transaction", err);
    }

    res.json({ drafts: withHistory(drafts) });
  });

  // POST /api/ai/scan-receipt  { image: "data:image/jpeg;base64,…", today }
  // → 200 { drafts: [...] }, the same shape as /parse-transaction.
  // The photo is only passed to the AI; it is never stored.
  router.post("/scan-receipt", async (req, res) => {
    const { image, today } = req.body ?? {};
    const errors = [];
    const problem = imageProblem(image);
    if (problem) errors.push(problem);
    if (!isValidDate(today)) {
      errors.push("today must be a real date in YYYY-MM-DD format");
    }
    if (errors.length > 0) return res.status(400).json({ errors });

    if (!ai) return notConfigured(res); // only the AI can read a photo

    let drafts;
    try {
      drafts = await scanReceipt(ai, {
        image,
        today,
        categories: listCategories.all(),
      });
    } catch (err) {
      return aiFailed(res, "scan-receipt", err);
    }
    res.json({ drafts: withHistory(drafts) });
  });

  // POST /api/ai/ask  { question, today: 'YYYY-MM-DD', history?: [{ role, content }] }
  // → 200 { answer, based_on: ["spending by category (…)", …], chart }
  // The AI answers by calling read-only ledger tools (see ai/ask-ledger.js).
  // `history` holds earlier turns for follow-ups ("and the month before?");
  // only the most recent HISTORY_SENT messages go to the AI, to cap cost.
  router.post("/ask", async (req, res) => {
    const { question, today, history = [] } = req.body ?? {};
    const errors = [];
    if (typeof question !== "string" || question.trim() === "") {
      errors.push("question is required");
    } else if (question.length > 500) {
      errors.push("question must be at most 500 characters"); // caps cost
    }
    if (!isValidDate(today)) {
      errors.push("today must be a real date in YYYY-MM-DD format");
    }
    if (!isValidHistory(history)) {
      errors.push(
        `history must be a list of at most ${HISTORY_MAX} { role: "user" | "assistant", content } items, each at most ${HISTORY_CONTENT_MAX} characters`,
      );
    }
    if (errors.length > 0) return res.status(400).json({ errors });

    if (!ai) return notConfigured(res); // only the AI can read a question

    try {
      const { answer, based_on, chart } = await askLedger(ai, ledgerTools, {
        question,
        today,
        history: history
          .slice(-HISTORY_SENT)
          .map(({ role, content }) => ({ role, content })), // drop any extra fields
      });
      res.json({ answer, based_on, chart });
    } catch (err) {
      aiFailed(res, "ask", err);
    }
  });

  return router;
}
