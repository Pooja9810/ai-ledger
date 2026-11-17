/**
 * "Ask your ledger": answer a question about the user's money by letting
 * the AI call our read-only ledger tools (see ledger-tools.js), in an agent
 * loop run by ai.runTools() (see client.js).
 */
import { TOOL_DEFINITIONS } from "./ledger-tools.js";
import { weekdayOf } from "../dates.js";
import { chartFromToolRuns } from "./answer-chart.js";

export const MAX_ROUNDS = 5;

// Constant (no dates or user data) so the provider can cache it.
const SYSTEM_PROMPT = `You answer questions about the user's personal finances using their ledger.
Rules:
- Use the tools for every number. Never guess or invent amounts, dates, merchants or categories.
- Quote amounts and percentages exactly as the tools return them.
- Never do arithmetic yourself. For any sum, difference, average, ratio or percentage the tools don't already give, call the calculate tool and quote its answer.
- Averages "per month" count only months on or after ledger_starts (there is no data before it); say how many months the average covers, and mention when the history is short.
- Resolve relative dates ("last month", "this year") from the given today. A month means its first to last day.
- If a tool returns an error, fix the arguments and try again.
- If the data has no answer (e.g. no transactions in that period), say so plainly.
- If the question isn't about the user's finances, say you can only answer questions about their ledger.
- Answer the question directly, without hedging or contradicting yourself.
- Answer in 1-4 short sentences of plain text. No markdown, tables or bullet points.`;

const TOO_MANY_STEPS =
  "That question needed more steps than I'm allowed. Try asking something narrower, like one month or one category at a time.";

/**
 * @param ai        client from createAiClient()
 * @param tools     from createLedgerTools(db)
 * @param question  the user's question
 * @param history   earlier turns, [{ role: "user" | "assistant", content }]
 * @param today     the user's local date, 'YYYY-MM-DD'
 * @returns { answer, based_on: ["spending by category (…)", …], chart }
 *   chart: a small chart built from the tools' results, or null
 * @throws AiError if the AI call fails
 */
export async function askLedger(ai, tools, { question, history = [], today }) {
  // Keep each successful lookup's result too: the chart is drawn from these
  // numbers (computed by our code), never from the AI's words.
  const results = [];
  const runTool = (name, args) => {
    const output = tools.run(name, args);
    if (!output.error) results.push({ name, args, result: output.result });
    return output;
  };
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
    runTool,
    maxRounds: MAX_ROUNDS,
  });

  // "Based on": the successful lookups, in order, without duplicates.
  const based_on = [
    ...new Set(
      toolRuns.filter((r) => r.ok).map((r) => tools.describe(r.name, r.args)),
    ),
  ];

  if (exhausted) return { answer: TOO_MANY_STEPS, based_on, chart: null };
  return {
    answer: text,
    based_on,
    chart: chartFromToolRuns(results, question),
  };
}
