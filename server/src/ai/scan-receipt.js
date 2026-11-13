/**
 * Receipt scanning: read a photo of a receipt into DRAFT transactions for
 * the user to review in the Add Transaction form, the same shape and the
 * same field validation as natural-language entry (parse-transaction.js).
 * The photo is never stored.
 */
import { weekdayOf } from "../dates.js";
import { candidateCategories } from "./categorize.js";
import { MAX_DRAFTS, validateDraft } from "./parse-transaction.js";

// Constant (no dates or user data) so the provider can cache it.
const SYSTEM_PROMPT = `You read photos of purchase receipts for a personal finance app.
Respond in json as {"transactions": [ ... ]} with one object per receipt in the photo (usually one).
If the photo is not a receipt or nothing is readable, respond {"transactions": []}.
Each object has exactly these keys:
- "kind": "expense" for a purchase; "income" only for a refund or return receipt
- "amount": the FINAL total actually paid (after tax, tip and discounts), not the subtotal, as written without a currency symbol, e.g. "30.08"
- "date": the purchase date on the receipt as YYYY-MM-DD. Use the given today to decide between month-first and day-first. If no date is printed, use null.
- "description": the store or merchant name as printed, in a short readable form (e.g. "Maple Leaf Market")
- "category": one exact name from the allowed categories for that kind, or null if none fits
Use null for any field you cannot read. Never invent an amount.
Example: {"transactions": [{"kind": "expense", "amount": "30.08", "date": "2026-03-14", "description": "Maple Leaf Market", "category": "Groceries"}]}`;

/**
 * @param ai          client from createAiClient()
 * @param image       data URL of the photo ("data:image/jpeg;base64,…")
 * @param today       the user's local date, 'YYYY-MM-DD'
 * @param categories  [{ id, name, kind }]
 * @returns drafts, like parseTransactions(): [{ kind, amount_cents, date, description, category }]
 * @throws AiError if the AI call fails
 */
export async function scanReceipt(ai, { image, today, categories }) {
  const names = (sign) =>
    candidateCategories(categories, sign)
      .map((c) => c.name)
      .join(", ");

  const { data } = await ai.completeJson({
    system: SYSTEM_PROMPT,
    images: [image],
    user: [
      `Today: ${today} (${weekdayOf(today)})`,
      `Expense categories: ${names(-1)}`,
      `Income categories: ${names(1)}`,
      "Read this receipt.",
    ].join("\n"),
    maxTokens: 400,
  });

  const items = Array.isArray(data?.transactions) ? data.transactions : [];
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => validateDraft(item, { today, categories }))
    .filter((draft) => draft.amount_cents !== null || draft.description !== "")
    .slice(0, MAX_DRAFTS);
}

// ------------------------------------------------------------ image checks

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // the browser shrinks photos to ~300 KB

// The first bytes ("magic numbers") identify a file type for real; the label
// in the data URL is just a claim made by whoever sent it.
const SIGNATURES = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) =>
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/gif": (b) => b.subarray(0, 4).toString("latin1") === "GIF8",
  "image/webp": (b) =>
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP",
};

/**
 * Check an uploaded image data URL. Returns an error message, or null if OK.
 */
export function imageProblem(image) {
  if (typeof image !== "string") return "image must be a data URL";
  const match =
    /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
      image,
    );
  if (!match) return "image must be a JPEG, PNG, WebP or GIF data URL";
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) return "image is empty";
  if (bytes.length > MAX_IMAGE_BYTES)
    return "image is too large (at most 5 MB)";
  if (!SIGNATURES[match[1]](bytes))
    return "image content doesn't match its type";
  return null;
}
