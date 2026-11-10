import { Router } from "express";
import { AiError } from "../ai/client.js";
import { suggestCategory } from "../ai/categorize.js";

/**
 * AI endpoints. `ai` is the client from createAiClient(), or null when
 * no API key is configured (every endpoint then answers 503).
 */
export function aiRouter(db, ai) {
  const router = Router();

  const listCategories = db.prepare("SELECT id, name, kind FROM categories");

  // 503: the feature is switched off on the server; not the caller's fault.
  router.use((req, res, next) => {
    if (!ai) {
      return res.status(503).json({ error: "AI features are not configured" });
    }
    next();
  });

  // POST /api/ai/categorize  { description, amount_cents }
  // → 200 { suggestion: { id, name } }  or  { suggestion: null } (no confident match)
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

    try {
      const suggestion = await suggestCategory(ai, {
        description,
        amountCents: amount_cents,
        categories: listCategories.all(),
      });
      res.json({ suggestion });
    } catch (err) {
      if (!(err instanceof AiError)) throw err; // real bug → error handler → 500
      // 502: the service we depend on failed. Log details, return a safe message.
      console.error("AI categorize failed:", err.message, err.cause ?? "");
      res.status(502).json({ error: "AI service is unavailable, try again" });
    }
  });

  return router;
}
