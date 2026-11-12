import { describe, it, expect } from "vitest";
import {
  historyForRequest,
  basedOnText,
  askErrorMessage,
  EXAMPLE_QUESTIONS,
  HISTORY_MESSAGES,
} from "./ask.js";

const done = (n) => ({
  id: n,
  question: `q${n}`,
  status: "done",
  answer: `a${n}`,
});

describe("historyForRequest", () => {
  it("is empty for a new conversation", () => {
    expect(historyForRequest([])).toEqual([]);
  });

  it("turns answered questions into user/assistant messages, in order", () => {
    expect(historyForRequest([done(1), done(2)])).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ]);
  });

  it("skips failed and still-loading turns", () => {
    const turns = [
      done(1),
      { id: 2, question: "q2", status: "error", error: "boom" },
      { id: 3, question: "q3", status: "loading" },
    ];
    expect(historyForRequest(turns)).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it(`keeps only the last ${HISTORY_MESSAGES} messages`, () => {
    const history = historyForRequest([1, 2, 3, 4, 5].map(done));
    expect(history).toHaveLength(HISTORY_MESSAGES);
    expect(history[0]).toEqual({ role: "user", content: "q3" });
    expect(history.at(-1)).toEqual({ role: "assistant", content: "a5" });
  });
});

describe("basedOnText", () => {
  it("joins the lookups", () => {
    expect(basedOnText(["account balances", "budgets (2026-11)"])).toBe(
      "Based on: account balances; budgets (2026-11)",
    );
  });
  it.each([[[]], [undefined]])("is null for %j", (input) => {
    expect(basedOnText(input)).toBeNull();
  });
});

describe("askErrorMessage", () => {
  it.each([
    [{ status: 503 }, "AI isn't set up on the server"],
    [{ status: 400, message: "question is required" }, "question is required"],
    [{ status: 502 }, "Couldn't reach the AI, try again"],
    [new TypeError("Failed to fetch"), "Couldn't reach the AI, try again"],
  ])("%j → %s", (error, expected) => {
    expect(askErrorMessage(error)).toBe(expected);
  });
});

describe("EXAMPLE_QUESTIONS", () => {
  it("offers a few short questions", () => {
    expect(EXAMPLE_QUESTIONS.length).toBeGreaterThanOrEqual(3);
    for (const q of EXAMPLE_QUESTIONS) expect(q.length).toBeLessThan(60);
  });
});
