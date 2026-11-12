/**
 * Categorize many transactions at once (bulk import).
 *
 *   1. the user's history first: free and instant (one index, built once)
 *   2. the rest are de-duplicated by merchant ("TIM HORTONS #123" ×12 → 1)
 *   3. unique merchants go to the AI in batches of BATCH_SIZE, expenses and
 *      income separately, a few batches at a time
 *
 * Like auto-categorize, the AI only proposes: an answer must name one of the
 * offered categories exactly, or the row stays uncategorized. A failed
 * batch leaves its rows uncategorized instead of failing the whole import.
 */
import { AiError } from "./client.js";
import { candidateCategories } from "./categorize.js";
import { normalizeMerchant } from "../merchants.js";

export const BATCH_SIZE = 50; // unique merchants per AI call
const CONCURRENCY = 3; // AI calls in flight at once

// Constant (no user data) so the provider can cache it.
const SYSTEM_PROMPT = `You categorize personal bank transactions.
You get a numbered list of transaction descriptions and the allowed categories.
For each transaction, pick the single best category from the list, using its exact name.
If none fits or the description is too vague to tell, use null.
Respond in json with one entry per transaction, using its number, for example:
{"results": [{"n": 1, "category": "Groceries"}, {"n": 2, "category": null}]}`;

/**
 * @param ai          client from createAiClient(), or null (history only)
 * @param items       [{ description, amountCents }]
 * @param categories  [{ id, name, kind }]
 * @param history     from createHistoryIndex(db)
 * @returns {{ results: [{ category: {id,name}|null, source: "history"|"ai"|null }],
 *             unknownMerchants, aiCalls, aiFailedBatches }}
 *   results are in the same order as items; unknownMerchants = how many
 *   unique merchants history didn't know (what the AI was/would be asked)
 */
export async function categorizeBatch(ai, { items, categories, history }) {
  const results = items.map(() => ({ category: null, source: null }));

  // 1. History, and group the rest by (kind, merchant).
  const pending = new Map(); // "expense|tim hortons" → { kind, description, indexes }
  items.forEach((item, i) => {
    const known = history.lookup(item);
    if (known) {
      results[i] = { category: known, source: "history" };
      return;
    }
    const merchant = normalizeMerchant(item.description);
    if (merchant === "") return; // nothing to go on (e.g. "#1234")
    const kind = item.amountCents < 0 ? "expense" : "income";
    const key = `${kind}|${merchant}`;
    if (!pending.has(key)) {
      pending.set(key, {
        kind,
        description: cleanForPrompt(item.description),
        indexes: [],
      });
    }
    pending.get(key).indexes.push(i);
  });

  if (!ai || pending.size === 0) {
    return {
      results,
      unknownMerchants: pending.size,
      aiCalls: 0,
      aiFailedBatches: 0,
    };
  }

  // 2. Batches of unique merchants, one kind per batch.
  const groups = [...pending.values()];
  const batches = [];
  for (const kind of ["expense", "income"]) {
    const ofKind = groups.filter((g) => g.kind === kind);
    for (let i = 0; i < ofKind.length; i += BATCH_SIZE) {
      batches.push({ kind, groups: ofKind.slice(i, i + BATCH_SIZE) });
    }
  }

  // 3. Ask the AI, a few batches at a time.
  let failed = 0;
  await forEachWithConcurrency(batches, CONCURRENCY, async (batch) => {
    let answers;
    try {
      answers = await categorizeOneBatch(ai, batch, categories);
    } catch (err) {
      if (!(err instanceof AiError)) throw err; // a real bug
      failed += 1; // these rows stay uncategorized; the user can pick
      return;
    }
    batch.groups.forEach((group, j) => {
      if (!answers[j]) return;
      for (const i of group.indexes)
        results[i] = { category: answers[j], source: "ai" };
    });
  });

  return {
    results,
    unknownMerchants: pending.size,
    aiCalls: batches.length,
    aiFailedBatches: failed,
  };
}

/** One AI call for up to BATCH_SIZE merchants of one kind. Returns one answer per group. */
async function categorizeOneBatch(ai, { kind, groups }, categories) {
  const candidates = candidateCategories(
    categories,
    kind === "expense" ? -1 : 1,
  );
  const { data } = await ai.completeJson({
    system: SYSTEM_PROMPT,
    user: [
      `Allowed categories: ${candidates.map((c) => c.name).join(", ")}`,
      "Transactions:",
      ...groups.map((g, j) => `${j + 1}. ${g.description}`),
    ].join("\n"),
    maxTokens: 40 * groups.length + 100, // ~15-25 tokens per answer, with room
  });

  // Validate: match by number (not position), exact category name of the right kind.
  const answers = groups.map(() => null);
  for (const entry of Array.isArray(data?.results) ? data.results : []) {
    const n = entry?.n;
    if (!Number.isInteger(n) || n < 1 || n > groups.length) continue;
    if (typeof entry.category !== "string") continue;
    const wanted = entry.category.trim().toLowerCase();
    const match = candidates.find((c) => c.name.toLowerCase() === wanted);
    if (match) answers[n - 1] = { id: match.id, name: match.name };
  }
  return answers;
}

/**
 * One line, at most 200 characters: a description with a line break in it
 * can't add fake lines (or instructions) to the numbered list.
 */
function cleanForPrompt(description) {
  return description.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Run `work` on every item, at most `limit` at a time. */
async function forEachWithConcurrency(items, limit, work) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}
