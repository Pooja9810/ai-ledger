import { describe, it, expect, vi } from "vitest";
import { createAiClient, AiError } from "../src/ai/client.js";

/**
 * A fake of the OpenAI SDK: just enough shape for createAiClient.
 * `create` is a Vitest mock, so tests can control what it returns
 * and inspect what it was called with. No network, no cost.
 */
function fakeSdk(response) {
  const create =
    typeof response === "function"
      ? vi.fn(response)
      : vi.fn().mockResolvedValue(response);
  return { create, sdk: { chat: { completions: { create } } } };
}

function reply(content, finish_reason = "stop") {
  return {
    choices: [{ finish_reason, message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

describe("createAiClient", () => {
  it("returns null when no API key is configured", () => {
    expect(createAiClient({ apiKey: "" })).toBeNull();
  });

  it("sends a JSON-mode request and returns parsed data", async () => {
    const { create, sdk } = fakeSdk(reply('{"category": "Dining Out"}'));
    const ai = createAiClient({ sdk });

    const result = await ai.completeJson({ system: "sys json", user: "hi" });

    expect(result.data).toEqual({ category: "Dining Out" });
    expect(result.usage.prompt_tokens).toBe(10);
    const params = create.mock.calls[0][0];
    expect(params.response_format).toEqual({ type: "json_object" });
    expect(params.thinking).toEqual({ type: "disabled" });
    expect(params.messages).toEqual([
      { role: "system", content: "sys json" },
      { role: "user", content: "hi" },
    ]);
  });

  it("throws AiError on blank content (DeepSeek's invalid-JSON signal)", async () => {
    const { sdk } = fakeSdk(reply("   "));
    const ai = createAiClient({ sdk });
    await expect(ai.completeJson({ system: "", user: "" })).rejects.toThrow(
      new AiError("AI returned an empty response"),
    );
  });

  it("throws AiError when the response was cut off", async () => {
    const { sdk } = fakeSdk(reply('{"categ', "length"));
    const ai = createAiClient({ sdk });
    await expect(ai.completeJson({ system: "", user: "" })).rejects.toThrow(
      /cut off/,
    );
  });

  it("throws AiError on unparseable JSON", async () => {
    const { sdk } = fakeSdk(reply("not json"));
    const ai = createAiClient({ sdk });
    await expect(ai.completeJson({ system: "", user: "" })).rejects.toThrow(
      /invalid JSON/,
    );
  });

  it("wraps SDK/network errors in AiError, keeping the cause", async () => {
    const boom = new Error("ECONNRESET");
    const { sdk } = fakeSdk(() => Promise.reject(boom));
    const ai = createAiClient({ sdk });

    const err = await ai.completeJson({ system: "", user: "" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.cause).toBe(boom);
  });
});
