/**
 * "Ask your ledger": answer a question about the user's money by letting
 * the AI call our read-only ledger tools (see ledger-tools.js), in an agent
 * loop run by ai.runTools() (see client.js).
 */
import { TOOL_DEFINITIONS } from "./ledger-tools.js";
import { weekdayOf } from "../dates.js";

export const MAX_ROUNDS = 5;

// Constant (no dates or user data) so the provider can cache it.
const SYSTEM_PROMPT = `You answer questions about the user's personal finances using their ledger.
Rules:
- Use the tools for every number. Never guess or invent amounts, dates, merchants or categories.
- Quote amounts and percentages exactly as the tools return them. Do not add, subtract or calculate money yourself; if a comparison needs a number the tools don't give, describe it in words (e.g. "higher than September").
- Resolve relative dates ("last month", "this year") from the given today. A month means its first to last day.
- If a tool returns an error, fix the arguments and try again.
- If the data has no answer (e.g. no transactions in that period), say so plainly.
- If the question isn't about the user's finances, say you can only answer questions about their ledger.
- Answer in 1-4 short sentences of plain text. No markdown, tables or bullet points.`;

const TOO_MANY_STEPS =
  "That question needed more steps than I'm allowed. Try asking something narrower, like one month or one category at a time.";

/**
 * @param ai        client from createAiClient()
 * @param tools     from createLedgerTools(db)
 * @param question  the user's question
 * @param history   earlier turns, [{ role: "user" | "assistant", content }]
 * @param today     the user's local date, 'YYYY-MM-DD'
 * @returns { answer, based_on: ["spending by category (…)", …] }
 * @throws AiError if the AI call fails
 */
export async function askLedger(ai, tools, { question, history = [], today }) {
  const { text, toolRuns, exhausted } = await ai.runTools({
    system: SYSTEM_PROMPT,
    messages: [
      ...history,
      {
        role: "user",
        content: `Today: ${today} (${weekdayOf(today)})\nQuestion: ${question.trim()}`,
      },
    ],
    tools: TOOL_DEFINITIONS,
    runTool: (name, args) => tools.run(name, args),
    maxRounds: MAX_ROUNDS,
  });

  // "Based on": the successful lookups, in order, without duplicates.
  const based_on = [
    ...new Set(
      toolRuns.filter((r) => r.ok).map((r) => tools.describe(r.name, r.args)),
    ),
  ];

  return { answer: exhausted ? TOO_MANY_STEPS : text, based_on };
}
