import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAiClient, AiError } from "../src/ai/client.js";
import { askLedger, MAX_ROUNDS } from "../src/ai/ask-ledger.js";
import { createLedgerTools } from "../src/ai/ledger-tools.js";
import { openDatabase } from "../src/db/index.js";

// ---- A scripted fake of the provider SDK -------------------------------
// Each scripted reply is either a tool request or a final text answer.
const toolCall = (id, name, args) => ({
  id,
  type: "function",
  function: {
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args),
  },
});
const asksFor = (...calls) => ({
  choices: [
    {
      finish_reason: "tool_calls",
      message: { content: "", tool_calls: calls },
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
});
const answers = (text) => ({
  choices: [{ finish_reason: "stop", message: { content: text } }],
  usage: { prompt_tokens: 150, completion_tokens: 30 },
});

/** An AI client whose replies follow the script, one per round. */
function scriptedAi(...replies) {
  const create = vi.fn();
  for (const reply of replies) create.mockResolvedValueOnce(reply);
  const ai = createAiClient({ sdk: { chat: { completions: { create } } } });
  return { ai, create };
}

/** What was sent on round N. */
const sentOnRound = (create, n) => structuredClone(create.mock.calls[n - 1][0]);

// ---- runTools: the generic loop -----------------------------------------
describe("runTools (the agent loop)", () => {
  const tools = [
    {
      name: "get_x",
      description: "Gets x",
      parameters: { type: "object", properties: {} },
    },
  ];
  let runTool;
  beforeEach(() => {
    runTool = vi.fn(async () => ({ result: { x: 42 } }));
  });
  const run = (ai, extra = {}) =>
    ai.runTools({
      system: "sys",
      messages: [{ role: "user", content: "what is x?" }],
      tools,
      runTool,
      ...extra,
    });

  it("answers directly when no tool is needed (1 round)", async () => {
    const { ai, create } = scriptedAi(answers("Hello!"));
    const out = await run(ai);
    expect(out).toMatchObject({
      text: "Hello!",
      toolRuns: [],
      rounds: 1,
      exhausted: false,
    });
    expect(runTool).not.toHaveBeenCalled();
    // the menu is wrapped in the provider's format
    expect(create.mock.calls[0][0].tools).toEqual([
      { type: "function", function: tools[0] },
    ]);
  });

  it("runs a requested tool, sends the result back, then answers (2 rounds)", async () => {
    const { ai, create } = scriptedAi(
      asksFor(toolCall("call_1", "get_x", {})),
      answers("x is 42"),
    );
    const out = await run(ai);

    expect(out).toMatchObject({ text: "x is 42", rounds: 2 });
    expect(out.toolRuns).toEqual([{ name: "get_x", args: {}, ok: true }]);
    expect(runTool).toHaveBeenCalledWith("get_x", {});

    const round2 = sentOnRound(create, 2).messages;
    expect(round2.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ]);
    expect(round2[3]).toEqual({
      role: "tool",
      tool_call_id: "call_1", // links the result to the request
      content: '{"x":42}',
    });
  });

  it("runs several tools requested in the same round", async () => {
    const { ai, create } = scriptedAi(
      asksFor(toolCall("a", "get_x", {}), toolCall("b", "get_x", { n: 2 })),
      answers("done"),
    );
    const out = await run(ai);
    expect(out.toolRuns).toHaveLength(2);
    const toolMessages = sentOnRound(create, 2).messages.filter(
      (m) => m.role === "tool",
    );
    expect(toolMessages.map((m) => m.tool_call_id)).toEqual(["a", "b"]);
  });

  it("sends tool errors back so the model can correct itself", async () => {
    runTool = vi
      .fn()
      .mockResolvedValueOnce({ error: "from must be a real date" })
      .mockResolvedValueOnce({ result: { x: 1 } });
    const { ai, create } = scriptedAi(
      asksFor(toolCall("a", "get_x", { from: "October" })),
      asksFor(toolCall("b", "get_x", { from: "2026-10-01" })),
      answers("fixed it"),
    );
    const out = await run(ai);

    expect(out.text).toBe("fixed it");
    expect(out.toolRuns.map((r) => r.ok)).toEqual([false, true]);
    const errorMessage = sentOnRound(create, 2).messages.at(-1);
    expect(JSON.parse(errorMessage.content)).toEqual({
      error: "from must be a real date",
    });
  });

  it("reports malformed tool arguments back instead of crashing", async () => {
    const { ai, create } = scriptedAi(
      asksFor(toolCall("a", "get_x", "{not json")),
      answers("ok"),
    );
    const out = await run(ai);
    expect(runTool).not.toHaveBeenCalled();
    expect(out.toolRuns).toEqual([{ name: "get_x", args: null, ok: false }]);
    expect(sentOnRound(create, 2).messages.at(-1).content).toMatch(
      /not valid JSON/,
    );
  });

  it("stops after maxRounds and reports exhausted (no infinite loops)", async () => {
    const forever = asksFor(toolCall("a", "get_x", {}));
    const { ai, create } = scriptedAi(forever, forever, forever, forever);
    const out = await run(ai, { maxRounds: 3 });
    expect(out).toMatchObject({ text: null, exhausted: true, rounds: 3 });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("adds up token usage across rounds", async () => {
    const { ai } = scriptedAi(
      asksFor(toolCall("a", "get_x", {})),
      answers("x"),
    );
    const out = await run(ai);
    expect(out.usage).toEqual({ prompt_tokens: 250, completion_tokens: 50 });
  });

  it.each([
    ["an empty final answer", answers("   "), /empty response/],
    [
      "a cut-off response",
      { choices: [{ finish_reason: "length", message: { content: "Yo" } }] },
      /cut off/,
    ],
  ])("throws AiError for %s", async (_label, reply, message) => {
    const { ai } = scriptedAi(reply);
    await expect(run(ai)).rejects.toThrow(message);
  });

  it("wraps provider failures in AiError", async () => {
    const create = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const ai = createAiClient({ sdk: { chat: { completions: { create } } } });
    await expect(run(ai)).rejects.toBeInstanceOf(AiError);
  });
});

// ---- askLedger: real tools, real (in-memory) database, scripted AI -------
describe("askLedger", () => {
  let tools;
  beforeEach(() => {
    const db = openDatabase(":memory:");
    const accountId = db
      .prepare(
        "INSERT INTO accounts (name, type) VALUES ('Checking', 'checking')",
      )
      .run().lastInsertRowid;
    const dining = db
      .prepare("SELECT id FROM categories WHERE name = 'Dining Out'")
      .get().id;
    db.prepare(
      `INSERT INTO transactions (account_id, category_id, date, amount_cents, description)
       VALUES (?, ?, '2026-10-12', -3850, 'Five Guys')`,
    ).run(accountId, dining);
    tools = createLedgerTools(db);
  });

  const OCT = { from: "2026-10-01", to: "2026-10-31" };
  const ask = (ai, extra = {}) =>
    askLedger(ai, tools, {
      question: "  dining in October?  ",
      today: "2026-11-12",
      ...extra,
    });

  it("runs real SQL for the AI and returns the answer with 'based on'", async () => {
    const { ai, create } = scriptedAi(
      asksFor(toolCall("a", "get_spending_by_category", OCT)),
      answers("You spent $38.50 on Dining Out in October."),
    );
    const out = await ask(ai);

    expect(out).toEqual({
      answer: "You spent $38.50 on Dining Out in October.",
      based_on: ["spending by category (2026-10-01 to 2026-10-31)"],
    });
    // the AI received the real numbers from our database
    const toolResult = JSON.parse(
      sentOnRound(create, 2).messages.at(-1).content,
    );
    expect(toolResult.total_spent).toBe("$38.50");
  });

  it("sends today (with weekday), the trimmed question and earlier turns", async () => {
    const { ai, create } = scriptedAi(answers("Sure."));
    const history = [
      {
        role: "user",
        content: "Today: 2026-11-12 (Thursday)\nQuestion: dining in October?",
      },
      { role: "assistant", content: "You spent $38.50." },
    ];
    await ask(ai, { question: "and September?", history });

    const { messages, tools: menu } = sentOnRound(create, 1);
    expect(messages.slice(1, 3)).toEqual(history);
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: "Today: 2026-11-12 (Thursday)\nQuestion: and September?",
    });
    expect(menu).toHaveLength(5);
    expect(messages[0].content).toMatch(/Never guess or invent/);
  });

  it("lists only successful lookups, without duplicates", async () => {
    const { ai } = scriptedAi(
      asksFor(
        toolCall("a", "list_transactions", { ...OCT, category: "Coffee" }), // error
        toolCall("b", "get_spending_by_category", OCT),
      ),
      asksFor(toolCall("c", "get_spending_by_category", OCT)), // same lookup again
      answers("Done."),
    );
    const out = await ask(ai);
    expect(out.based_on).toEqual([
      "spending by category (2026-10-01 to 2026-10-31)",
    ]);
  });

  it(`gives a friendly answer after ${MAX_ROUNDS} rounds instead of failing`, async () => {
    const forever = asksFor(toolCall("a", "get_account_balances", {}));
    const { ai } = scriptedAi(...Array(MAX_ROUNDS).fill(forever));
    const out = await ask(ai);
    expect(out.answer).toMatch(/needed more steps/);
    expect(out.based_on).toEqual(["account balances"]);
  });
});
