/**
 * Natural-language entry: turn a note like "spent $12.50 on lunch at
 * Chipotle yesterday" into DRAFT transactions for the user to review.
 * One note may describe several ("coffee at Tims for 4 and chips at
 * Five Guys for 15"), so the answer is always a list.
 *
 * The AI extracts fields; this code validates every one of them with the
 * same rules as user input. Anything invalid becomes empty (null) so the
 * form falls back to its normal default. Nothing here saves anything.
 */
import { isValidDate } from "../validation.js";
import { weekdayOf } from "../dates.js";
import { parseDollarsToCents } from "../money.js";
import { candidateCategories } from "./categorize.js";

// Constant (no dates or user data) so the provider can cache it.
const SYSTEM_PROMPT = `You turn a short note about personal money transactions into fields.
The note may describe one transaction or several.
Respond in json as {"transactions": [ ... ]} with one object per separate purchase or payment.
Never merge separate purchases into one, and never split a single purchase into parts.
Each object has exactly these keys:
- "kind": "expense" (money spent) or "income" (money received)
- "amount": the amount as written, digits with an optional 2-decimal part, no currency symbol, e.g. "12.50"
- "date": the transaction date as YYYY-MM-DD. Resolve relative dates ("yesterday", "last Friday") from the given today. If no date is mentioned, use today.
- "description": a short merchant or payee name (e.g. "Chipotle"), or a 2-4 word summary if there is none
- "category": one exact name from the allowed categories for that kind, or null if none fits
Use null for any field you cannot determine. Never invent an amount.
Example for "lunch at Chipotle 12.50 and gas 40 yesterday":
{"transactions": [{"kind": "expense", "amount": "12.50", "date": "2026-03-14", "description": "Chipotle", "category": "Dining Out"}, {"kind": "expense", "amount": "40", "date": "2026-03-14", "description": "Gas", "category": "Transport"}]}`;

/** At most this many drafts per note: caps cost and keeps the queue reviewable. */
export const MAX_DRAFTS = 5;

/**
 * @param ai          client from createAiClient()
 * @param text        the user's note
 * @param today       the user's local date, 'YYYY-MM-DD' (from the browser)
 * @param categories  [{ id, name, kind }] from the database
 * @returns Array of up to MAX_DRAFTS drafts, each
 *   { kind, amount_cents, date, description, category }
 *   kind: 'expense' | 'income'; amount_cents: signed cents or null;
 *   date: 'YYYY-MM-DD' or null; description: string ('' if unknown);
 *   category: { id, name } or null. Empty array if nothing was found.
 * @throws AiError if the AI call fails
 */
export async function parseTransactions(ai, { text, today, categories }) {
  const names = (kind) =>
    candidateCategories(categories, kind === "expense" ? -1 : 1)
      .map((c) => c.name)
      .join(", ");

  const { data } = await ai.completeJson({
    system: SYSTEM_PROMPT,
    user: [
      `Today: ${today} (${weekdayOf(today)})`,
      `Expense categories: ${names("expense")}`,
      `Income categories: ${names("income")}`,
      `Note: ${text.trim()}`,
    ].join("\n"),
    maxTokens: 600, // room for several items
  });

  // Expect { transactions: [...] }; tolerate a single bare object too.
  const items = Array.isArray(data?.transactions)
    ? data.transactions
    : data && typeof data === "object" && !("transactions" in data)
      ? [data]
      : [];

  return (
    items
      .filter((item) => item && typeof item === "object")
      .map((item) => validateDraft(item, { today, categories }))
      // Drop items with nothing usable (no amount and no description).
      .filter(
        (draft) => draft.amount_cents !== null || draft.description !== "",
      )
      .slice(0, MAX_DRAFTS)
  );
}

/**
 * Validate one AI item; the AI only proposes. Invalid fields become empty.
 * Shared with receipt scanning, so both follow exactly the same rules.
 */
export function validateDraft(data, { today, categories }) {
  const kind = data.kind === "income" ? "income" : "expense"; // form default

  const cents =
    typeof data.amount === "string" || typeof data.amount === "number"
      ? parseDollarsToCents(String(data.amount))
      : null;
  const amount_cents = cents ? (kind === "expense" ? -cents : cents) : null;

  // Real date, not in the future. ISO dates compare correctly as text.
  const date = isValidDate(data.date) && data.date <= today ? data.date : null;

  const description =
    typeof data.description === "string"
      ? data.description.trim().slice(0, 200)
      : "";

  const candidates = candidateCategories(
    categories,
    kind === "expense" ? -1 : 1,
  );
  const answer =
    typeof data.category === "string"
      ? data.category.trim().toLowerCase()
      : null;
  const match = candidates.find((c) => c.name.toLowerCase() === answer);
  const category = match ? { id: match.id, name: match.name } : null;

  return { kind, amount_cents, date, description, category };
}
