import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";
import { AiError } from "../src/ai/client.js";

/** Fake AI client: completeJson resolves (or rejects) as told. No network. */
function fakeAi(impl) {
  return { model: "fake", completeJson: vi.fn(impl) };
}

describe("POST /api/ai/categorize", () => {
  let db;
  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  const body = { description: "STARBUCKS #1234", amount_cents: -575 };

  it("returns the suggested category", async () => {
    const ai = fakeAi(async () => ({ data: { category: "Dining Out" } }));
    const app = createApp(db, { ai });

    const res = await request(app).post("/api/ai/categorize").send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      suggestion: { id: expect.any(Number), name: "Dining Out" },
    });
  });

  it("returns suggestion: null when the AI has no confident match", async () => {
    const ai = fakeAi(async () => ({ data: { category: "Coffee" } }));
    const res = await request(createApp(db, { ai }))
      .post("/api/ai/categorize")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ suggestion: null });
  });

  it("returns 400 with all errors for bad input, without calling the AI", async () => {
    const ai = fakeAi(async () => ({ data: {} }));
    const res = await request(createApp(db, { ai }))
      .post("/api/ai/categorize")
      .send({ description: "  ", amount_cents: 12.5 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveLength(2);
    expect(ai.completeJson).not.toHaveBeenCalled();
  });

  it("returns 503 when AI is not configured", async () => {
    const res = await request(createApp(db)) // no ai → null
      .post("/api/ai/categorize")
      .send(body);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/);
  });

  it("returns 502 with a safe message when the AI service fails", async () => {
    const ai = fakeAi(async () => {
      throw new AiError("AI request failed", {
        cause: new Error("401 invalid key sk-secret"),
      });
    });
    vi.spyOn(console, "error").mockImplementation(() => {}); // keep test output clean

    const res = await request(createApp(db, { ai }))
      .post("/api/ai/categorize")
      .send(body);

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "AI service is unavailable, try again" });
    expect(JSON.stringify(res.body)).not.toContain("sk-secret"); // no leaks
  });
});
