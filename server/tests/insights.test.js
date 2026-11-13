import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";
import { AiError } from "../src/ai/client.js";
import {
  buildMonthFacts,
  allowedNumbers,
  numbersCheckOut,
  writeInsights,
  previousMonth,
} from "../src/ai/insights.js";

let db;
const cat = (name) =>
  db.prepare("SELECT id FROM categories WHERE name = ?").get(name).id;
const add = (date, cents, description, category) =>
  db
    .prepare(
      "INSERT INTO transactions (account_id, category_id, date, amount_cents, description) VALUES (1, ?, ?, ?, ?)",
    )
    .run(category ? cat(category) : null, date, cents, description);

beforeEach(() => {
  db = openDatabase(":memory:");
  db.prepare(
    "INSERT INTO accounts (name, type) VALUES ('Checking', 'checking')",
  ).run();
  // October
  add("2026-10-05", -20000, "NO FRILLS", "Groceries");
  add("2026-10-10", -4000, "CHIPOTLE", "Dining Out");
  add("2026-10-15", 400000, "PAYROLL", "Salary");
  // November (in progress)
  add("2026-11-02", -12500, "NO FRILLS", "Groceries");
  add("2026-11-03", -30000, "STEAKHOUSE", "Dining Out");
  add("2026-11-05", -1000, "MYSTERY", null);
  db.prepare(
    "INSERT INTO budgets (category_id, monthly_limit_cents) VALUES (?, 20000)",
  ).run(cat("Dining Out"));
});

describe("buildMonthFacts (all numbers computed by our code)", () => {
  it("summarizes the month against last month", () => {
    const f = buildMonthFacts(db, "2026-11", "2026-11-12");
    expect(f).toMatchObject({
      month: "November 2026",
      status: "in progress: day 12 of 30",
      compared_with: "October 2026",
      income: "$0.00",
      spending: "$435.00", // 125 + 300 + 10
      last_month: { spending: "$240.00", income: "$4,000.00" },
      spending_change_vs_last_month: "+81.3%", // 240 → 435
      transactions: 3,
    });
    expect(f.top_categories[0]).toEqual({
      category: "Dining Out",
      spent: "$300.00",
      share_of_spending: "69%",
      last_month: "$40.00",
      change_vs_last_month: "+650.0%",
    });
    expect(
      f.top_categories.find((c) => c.category === "Uncategorized")
        .change_vs_last_month,
    ).toBe("new this month");
    expect(f.budgets[0]).toMatchObject({
      category: "Dining Out",
      status: "over by $100.00",
    });
    expect(f.biggest_purchases[0]).toEqual({
      date: "2026-11-03",
      description: "STEAKHOUSE",
      amount: "$300.00",
    });
  });

  it("marks a past month complete, and returns null for an empty month", () => {
    expect(buildMonthFacts(db, "2026-10", "2026-11-12").status).toBe(
      "complete",
    );
    expect(buildMonthFacts(db, "2026-08", "2026-11-12")).toBeNull();
  });

  it("knows the month before January", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-11")).toBe("2026-10");
  });
});

describe("the number guard", () => {
  const facts = {
    spending: "$435.00",
    change: "+81.3%",
    share: "69%",
    last: "$4,000.00",
  };
  const allowed = allowedNumbers(facts);

  it.each([
    "You spent $435.00 so far, up 81.3% on October.",
    "Dining out was 69% of spending.",
    "Income last month was $4,000.00.",
    "No numbers at all here.",
  ])("accepts: %s", (text) => {
    expect(numbersCheckOut(text, allowed)).toBe(true);
  });

  it.each([
    "You spent $435 so far.", // rounded: not as given
    "You spent $500.00.", // invented
    "Spending rose 81%.", // rounded percentage
    "About 70% went to dining.", // invented
  ])("rejects: %s", (text) => {
    expect(numbersCheckOut(text, allowed)).toBe(false);
  });
});

describe("writeInsights", () => {
  const fakeAi = (data) => ({
    completeJson: vi.fn().mockResolvedValue({ data, usage: {} }),
  });
  let facts;
  beforeEach(() => {
    facts = buildMonthFacts(db, "2026-11", "2026-11-12");
  });

  it("keeps good points, drops ones with invented numbers, normalizes tones", async () => {
    const out = await writeInsights(
      fakeAi({
        headline: "Dining out is running hot so far.",
        points: [
          { text: "Dining Out is over budget by $100.00.", tone: "attention" },
          { text: "You've spent $435.00 so far.", tone: "loud" },
          { text: "That's about $14.50 a day.", tone: "neutral" }, // invented
          { text: "  " },
        ],
      }),
      facts,
    );
    expect(out).toEqual({
      headline: "Dining out is running hot so far.",
      points: [
        { text: "Dining Out is over budget by $100.00.", tone: "attention" },
        { text: "You've spent $435.00 so far.", tone: "neutral" },
      ],
      dropped: 1,
    });
  });

  it("replaces a headline with an invented number", async () => {
    const out = await writeInsights(
      fakeAi({ headline: "You saved $999.99!", points: [] }),
      facts,
    );
    expect(out.headline).toBe("Here's November 2026 so far.");
  });

  it("sends only facts, with the rules in a constant prompt", async () => {
    const ai = fakeAi({ headline: "Hi.", points: [] });
    await writeInsights(ai, facts);
    const { system, user } = ai.completeJson.mock.calls[0][0];
    expect(system).toMatch(/Use ONLY numbers that appear in the facts/);
    expect(user).toContain('"spending": "$435.00"');
  });
});

describe("GET /api/ai/insights", () => {
  const AI_ANSWER = {
    headline: "Dining out is running hot so far.",
    points: [
      { text: "Dining Out is over budget by $100.00.", tone: "attention" },
    ],
  };
  const get = (app, month = "2026-11") =>
    request(app).get(`/api/ai/insights?month=${month}&today=2026-11-12`);

  it("writes once, then serves the cache until the data changes", async () => {
    const ai = {
      completeJson: vi.fn().mockResolvedValue({ data: AI_ANSWER, usage: {} }),
    };
    const app = createApp(db, { ai });

    const first = await get(app);
    expect(first.body).toMatchObject({
      month: "2026-11",
      headline: AI_ANSWER.headline,
      cached: false,
    });
    expect((await get(app)).body.cached).toBe(true);
    expect(ai.completeJson).toHaveBeenCalledTimes(1);

    add("2026-11-10", -500, "COFFEE", "Dining Out"); // data changed
    expect((await get(app)).body.cached).toBe(false);
    expect(ai.completeJson).toHaveBeenCalledTimes(2);
  });

  it("returns empty for a month with no transactions, without the AI", async () => {
    const ai = { completeJson: vi.fn() };
    const res = await get(createApp(db, { ai }), "2026-08");
    expect(res.body).toEqual({ month: "2026-08", empty: true });
    expect(ai.completeJson).not.toHaveBeenCalled();
  });

  it("validates input, and answers 503 / safe 502", async () => {
    expect(
      (await request(createApp(db)).get("/api/ai/insights?month=nov&today=x"))
        .status,
    ).toBe(400);
    expect((await get(createApp(db))).status).toBe(503);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = {
      completeJson: vi
        .fn()
        .mockRejectedValue(
          new AiError("down", { cause: new Error("sk-secret") }),
        ),
    };
    const res = await get(createApp(db, { ai: failing }));
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("sk-secret");
  });
});
