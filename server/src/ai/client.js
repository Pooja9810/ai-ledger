import OpenAI from "openai";

/**
 * The ONE place that knows which AI provider we use.
 * Features call `ai.completeJson(...)` and never import the SDK themselves,
 * so switching providers (or faking the AI in tests) only touches this file.
 *
 * Provider: DeepSeek, via its OpenAI-compatible API.
 */
export const AI_MODEL = "deepseek-flash";
const BASE_URL = "https://api.deepseek.com";

/** Thrown when the AI call fails or returns something unusable. */
export class AiError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = "AiError";
  }
}

/**
 * Build the AI client. Returns null when no API key is configured,
 * so the app can run without AI (routes then answer "AI not configured").
 *
 * `sdk` can be injected in tests to avoid real network calls.
 */
export function createAiClient({
  apiKey = process.env.DEEPSEEK_API_KEY,
  model = AI_MODEL,
  sdk,
} = {}) {
  if (!sdk && !apiKey) return null;

  const openai =
    sdk ??
    new OpenAI({
      baseURL: BASE_URL,
      apiKey,
      timeout: 30_000, // ms; a user is waiting, so fail rather than hang
      maxRetries: 2, // the SDK retries rate limits, 5xx and network errors
    });

  return {
    model,

    /**
     * Send a prompt, get back parsed JSON.
     * DeepSeek's JSON mode requires the word "json" in the prompt
     * and works best when the prompt shows an example of the format.
     *
     * Returns { data, usage }. Throws AiError if the answer is unusable.
     * Callers must still validate `data` (e.g. "is this a real category?").
     */
    async completeJson({ system, user, maxTokens = 500 }) {
      let res;
      try {
        res = await openai.chat.completions.create({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          thinking: { type: "disabled" }, // simple tasks: faster, cheaper
          max_tokens: maxTokens,
        });
      } catch (err) {
        // Network failure, bad key, rate limit after retries, etc.
        throw new AiError("AI request failed", { cause: err });
      }

      const choice = res.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new AiError("AI response was cut off (raise maxTokens)");
      }

      // DeepSeek returns blank content (not an error) when it couldn't
      // produce valid JSON, so check for that explicitly.
      const text = choice?.message?.content?.trim();
      if (!text) throw new AiError("AI returned an empty response");

      try {
        return { data: JSON.parse(text), usage: res.usage };
      } catch (err) {
        throw new AiError("AI returned invalid JSON", { cause: err });
      }
    },

    /**
     * The AGENT LOOP: let the model call our tools until it can answer.
     *
     *   repeat (max `maxRounds` times):
     *     send the conversation + tool menu
     *     if the model answers in text → done
     *     else run every tool it asked for, append the results, go again
     *
     * Generic: it knows nothing about ledgers. The caller supplies the tool
     * menu ({ name, description, parameters }) and `runTool(name, args)`,
     * which must return { result } or { error } (errors are sent back so
     * the model can correct itself).
     *
     * @param messages  earlier turns, [{ role: "user" | "assistant", content }]
     * @returns { text, toolRuns: [{ name, args, ok }], rounds, exhausted, usage }
     *          exhausted = true (and text = null) if it ran out of rounds
     * @throws AiError if a request fails or the final answer is empty/cut off
     */
    async runTools({
      system,
      messages,
      tools,
      runTool,
      maxRounds = 5,
      maxTokens = 1500,
    }) {
      // The provider-specific part: DeepSeek uses the OpenAI tools format.
      const toolSpecs = tools.map((tool) => ({
        type: "function",
        function: tool,
      }));
      const conversation = [{ role: "system", content: system }, ...messages];
      const toolRuns = [];
      const usage = { prompt_tokens: 0, completion_tokens: 0 };

      for (let round = 1; round <= maxRounds; round++) {
        let res;
        try {
          res = await openai.chat.completions.create({
            model,
            messages: [...conversation], // a snapshot: we keep appending to ours
            tools: toolSpecs,
            thinking: { type: "disabled" },
            max_tokens: maxTokens,
          });
        } catch (err) {
          throw new AiError("AI request failed", { cause: err });
        }
        usage.prompt_tokens += res.usage?.prompt_tokens ?? 0;
        usage.completion_tokens += res.usage?.completion_tokens ?? 0;

        const choice = res.choices?.[0];
        if (choice?.finish_reason === "length") {
          throw new AiError("AI response was cut off (raise maxTokens)");
        }
        const message = choice?.message ?? {};
        const calls = message.tool_calls ?? [];

        // No tool requests: this is the final answer.
        if (calls.length === 0) {
          const text = message.content?.trim();
          if (!text) throw new AiError("AI returned an empty response");
          return { text, toolRuns, rounds: round, exhausted: false, usage };
        }

        // Keep the model's request in the conversation, then answer each call.
        conversation.push({
          role: "assistant",
          content: message.content ?? "",
          tool_calls: calls,
        });
        for (const call of calls) {
          const name = call.function?.name ?? "";
          let args = null;
          try {
            args = JSON.parse(call.function?.arguments || "{}");
          } catch {
            // leave args null: reported back to the model below
          }
          const output =
            args === null
              ? { error: "arguments were not valid JSON" }
              : await runTool(name, args);
          toolRuns.push({ name, args, ok: !output.error });
          conversation.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(
              output.error ? { error: output.error } : output.result,
            ),
          });
        }
      }

      // Ran out of rounds: let the caller turn this into a friendly answer.
      return {
        text: null,
        toolRuns,
        rounds: maxRounds,
        exhausted: true,
        usage,
      };
    },
  };
}
