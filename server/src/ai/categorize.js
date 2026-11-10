/**
 * Auto-categorization: suggest one of the user's categories for a transaction.
 *
 * The AI only PROPOSES a category name; this code decides whether to accept it.
 * Anything that isn't exactly one of the offered categories becomes "no suggestion".
 */

// Kept constant (no dates, no per-request data) so the provider can cache it.
const SYSTEM_PROMPT = `You categorize personal bank transactions.
You will get a transaction description and a list of allowed categories.
Pick the single best category from the list. Use the exact name from the list.
If none fits or the description is too vague to tell, answer null.
Respond in json, for example: {"category": "Groceries"} or {"category": null}`;

/**
 * Which categories are candidates for this amount?
 * Expenses (negative) → expense categories; income (positive) → income ones.
 * 'transfer' categories are never suggested (see CLAUDE.md).
 */
export function candidateCategories(categories, amountCents) {
  const kind = amountCents < 0 ? "expense" : "income";
  return categories.filter((c) => c.kind === kind);
}

/**
 * Ask the AI for a category.
 * @param ai          client from createAiClient()
 * @param categories  [{ id, name, kind }] from the database
 * @returns { id, name } of an existing category, or null for "no suggestion"
 * @throws  AiError if the AI call itself fails
 */
export async function suggestCategory(
  ai,
  { description, amountCents, categories },
) {
  const candidates = candidateCategories(categories, amountCents);
  if (candidates.length === 0 || description.trim() === "") return null;

  const { data } = await ai.completeJson({
    system: SYSTEM_PROMPT,
    user: [
      `Allowed categories: ${candidates.map((c) => c.name).join(", ")}`,
      `Transaction: ${description.trim()}`,
    ].join("\n"),
    maxTokens: 50, // a one-field answer; keeps a bad response short and cheap
  });

  // Validate: must be a string naming one of the candidates (any letter case).
  const answer = data?.category;
  if (typeof answer !== "string") return null;
  const match = candidates.find(
    (c) => c.name.toLowerCase() === answer.trim().toLowerCase(),
  );
  return match ? { id: match.id, name: match.name } : null;
}
