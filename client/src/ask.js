/**
 * Rules for the "Ask your ledger" card. Pure functions, so they're easy to test.
 *
 * A conversation is a list of turns:
 *   { id, question, status: "loading" | "done" | "error", answer, basedOn, error }
 */

/** Clickable examples for the empty state (the "next step"). */
export const EXAMPLE_QUESTIONS = [
  "What did I spend the most on this month?",
  "Am I over budget on anything?",
  "How much did I spend on dining out last month?",
  "What's my net worth?",
];

/** How many earlier messages to send for follow-ups (3 question/answer pairs). */
export const HISTORY_MESSAGES = 6;

/**
 * Earlier turns as the API's `history`: only answered turns (a failed
 * question has no answer to build on), most recent last, capped.
 */
export function historyForRequest(turns) {
  return turns
    .filter((t) => t.status === "done")
    .flatMap((t) => [
      { role: "user", content: t.question },
      { role: "assistant", content: t.answer },
    ])
    .slice(-HISTORY_MESSAGES);
}

/** "Based on: spending by category (…); account balances", or null if nothing. */
export function basedOnText(basedOn) {
  return basedOn?.length ? `Based on: ${basedOn.join("; ")}` : null;
}

/** Turn a failed request into a message for the user. */
export function askErrorMessage(error) {
  if (error?.status === 503) return "AI isn't set up on the server";
  if (error?.status === 400) return error.message;
  if (error?.status === 429) return error.message; // the demo's AI limit, with when to retry
  return "Couldn't reach the AI, try again";
}
