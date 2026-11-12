import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";
import { AiError } from "../src/ai/client.js";

const AI_ANSWER = {
  kind: "expense",
  amount: "12.50",
  date: "2026-11-10",
  description: "Chipotle",
  category: "Dining Out",
};

function fakeAi(impl = async () => ({ data: { transactions: [AI_ANSWER] } })) {
  return { model: "fake", completeJson: vi.fn(impl) };
}

describe("POST /api/ai/parse-transaction", () => {
  let db;
  const catId = (name) =>
    db.prepare("SELECT id FROM categories WHERE name = ?").get(name).id;
  const body = {
    text: "lunch at Chipotle yesterday 12.50",
    today: "2026-11-11",
  };

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  it("returns drafts with the AI's category", async () => {
    const res = await request(createApp(db, { ai: fakeAi() }))
      .post("/api/ai/parse-transaction")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      drafts: [
        {
          kind: "expense",
          amount_cents: -1250,
          date: "2026-11-10",
          description: "Chipotle",
          category: { id: catId("Dining Out"), name: "Dining Out" },
          category_source: "ai",
        },
      ],
    });
  });

  it("prefers the user's history over the AI's category", async () => {
    const accountId = db
      .prepare(
        "INSERT INTO accounts (name, type) VALUES ('Checking', 'checking')",
      )
      .run().lastInsertRowid;
    db.prepare(
      `INSERT INTO transactions (account_id, category_id, date, amount_cents, description)
       VALUES (?, ?, '2026-11-01', -900, 'CHIPOTLE 0412')`,
    ).run(accountId, catId("Groceries")); // the user files Chipotle under Groceries

    const res = await request(createApp(db, { ai: fakeAi() }))
      .post("/api/ai/parse-transaction")
      .send(body);

    expect(res.body.drafts[0].category).toEqual({
      id: catId("Groceries"),
      name: "Groceries",
    });
    expect(res.body.drafts[0].category_source).toBe("history");
  });

  it("reports category_source null when there is no category", async () => {
    const ai = fakeAi(async () => ({
      data: { transactions: [{ ...AI_ANSWER, category: null }] },
    }));
    const res = await request(createApp(db, { ai }))
      .post("/api/ai/parse-transaction")
      .send(body);

    expect(res.body.drafts[0].category).toBeNull();
    expect(res.body.drafts[0].category_source).toBeNull();
  });

  it("returns several drafts, each with its own category source", async () => {
    const ai = fakeAi(async () => ({
      data: {
        transactions: [
          AI_ANSWER,
          { ...AI_ANSWER, description: "Five Guys", amount: "15" },
        ],
      },
    }));
    const res = await request(createApp(db, { ai }))
      .post("/api/ai/parse-transaction")
      .send(body);

    expect(res.body.drafts).toHaveLength(2);
    expect(res.body.drafts.map((d) => d.description)).toEqual([
      "Chipotle",
      "Five Guys",
    ]);
    expect(res.body.drafts[1]).toMatchObject({
      amount_cents: -1500,
      category_source: "ai",
    });
  });

  it("returns an empty list when nothing was found", async () => {
    const ai = fakeAi(async () => ({ data: { transactions: [] } }));
    const res = await request(createApp(db, { ai }))
      .post("/api/ai/parse-transaction")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ drafts: [] });
  });

  it("returns 400 for bad input without calling the AI", async () => {
    const ai = fakeAi();
    const res = await request(createApp(db, { ai }))
      .post("/api/ai/parse-transaction")
      .send({ text: "", today: "2026-02-30" });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      "text is required",
      "today must be a real date in YYYY-MM-DD format",
    ]);
    expect(ai.completeJson).not.toHaveBeenCalled();
  });

  it("returns 400 for text over 500 characters", async () => {
    const res = await request(createApp(db, { ai: fakeAi() }))
      .post("/api/ai/parse-transaction")
      .send({ ...body, text: "x".repeat(501) });

    expect(res.status).toBe(400);
  });

  it("returns 503 when AI is not configured", async () => {
    const res = await request(createApp(db))
      .post("/api/ai/parse-transaction")
      .send(body);

    expect(res.status).toBe(503);
  });

  it("returns 502 with a safe message when the AI fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ai = fakeAi(async () => {
      throw new AiError("AI request failed", { cause: new Error("sk-secret") });
    });

    const res = await request(createApp(db, { ai }))
      .post("/api/ai/parse-transaction")
      .send(body);

    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("sk-secret");
  });
});
