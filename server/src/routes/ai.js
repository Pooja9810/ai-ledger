import { Router } from "express";
import { AiError } from "../ai/client.js";
import { suggestCategory } from "../ai/categorize.js";
import { findCategoryFromHistory } from "../merchants.js";

/**
 * AI endpoints. `ai` is the client from createAiClient(), or null when
 * no API key is configured (endpoints answer 503 when they need the AI).
 */
export function aiRouter(db, ai) {
  const router = Router();

  const listCategories = db.prepare("SELECT id, name, kind FROM categories");

  // 503: the feature is switched off on the server; not the caller's fault.
  const notConfigured = (res) =>
    res.status(503).json({ error: "AI features are not configured" });

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
      if (!(err instanceof AiError)) throw err; // real bug → error handler → 500
      // 502: the service we depend on failed. Log details, return a safe message.
      console.error("AI categorize failed:", err.message, err.cause ?? "");
      res.status(502).json({ error: "AI service is unavailable, try again" });
    }
  });

  return router;
}
