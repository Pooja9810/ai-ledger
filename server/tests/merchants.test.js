import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";
import {
  normalizeMerchant,
  findCategoryFromHistory,
} from "../src/merchants.js";

describe("normalizeMerchant", () => {
  it.each([
    ["STARBUCKS #1234 SEATTLE WA", "starbucks seattle wa"],
    ["Starbucks #5678 Seattle WA", "starbucks seattle wa"],
    ["UBER *EATS", "uber eats"],
    ["UBER *TRIP", "uber trip"],
    ["WHOLEFDS MKT 10234", "wholefds mkt"],
    ["  #1234  ", ""],
  ])("%s → %s", (input, expected) => {
    expect(normalizeMerchant(input)).toBe(expected);
  });
});

describe("findCategoryFromHistory", () => {
  let db;
  let accountId;
  const cat = (name) =>
    db.prepare("SELECT id FROM categories WHERE name = ?").get(name).id;
  const addTx = (description, amountCents, categoryName, date = "2026-11-01") =>
    db
      .prepare(
        `INSERT INTO transactions (account_id, category_id, date, amount_cents, description)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        accountId,
        categoryName ? cat(categoryName) : null,
        date,
        amountCents,
        description,
      );

  beforeEach(() => {
    db = openDatabase(":memory:");
    accountId = db
      .prepare(
        "INSERT INTO accounts (name, type) VALUES ('Checking', 'checking')",
      )
      .run().lastInsertRowid;
  });

  it("reuses the category of the same merchant, ignoring store numbers", () => {
    addTx("STARBUCKS #1234 SEATTLE WA", -575, "Dining Out");
    const found = findCategoryFromHistory(db, {
      description: "STARBUCKS #9999 SEATTLE WA",
      amountCents: -650,
    });
    expect(found).toEqual({ id: cat("Dining Out"), name: "Dining Out" });
  });

  it("keeps different merchants apart (UBER EATS vs UBER TRIP)", () => {
    addTx("UBER *TRIP", -2310, "Transport");
    expect(
      findCategoryFromHistory(db, {
        description: "UBER *EATS",
        amountCents: -3150,
      }),
    ).toBeNull();
  });

  it("prefers the most recent choice (the user's latest correction)", () => {
    addTx("COSTCO WHSE #123", -9000, "Groceries", "2026-10-01");
    addTx("COSTCO WHSE #123", -4000, "Shopping", "2026-11-05");
    expect(
      findCategoryFromHistory(db, {
        description: "COSTCO WHSE #456",
        amountCents: -1000,
      }).name,
    ).toBe("Shopping");
  });

  it("ignores past categories of the wrong kind for this amount", () => {
    addTx("ACME CORP", 50000, "Salary"); // income
    expect(
      findCategoryFromHistory(db, {
        description: "ACME CORP",
        amountCents: -100,
      }),
    ).toBeNull();
  });

  it("never reuses transfer categories or uncategorized rows", () => {
    addTx("Opening balance", -100, "Opening balance");
    addTx("MYSTERY SHOP", -100, null);
    for (const description of ["Opening balance", "MYSTERY SHOP"]) {
      expect(
        findCategoryFromHistory(db, { description, amountCents: -50 }),
      ).toBeNull();
    }
  });

  it("skips the lookup when nothing is left after normalizing", () => {
    addTx("#1234", -100, "Shopping");
    expect(
      findCategoryFromHistory(db, { description: "#5678", amountCents: -100 }),
    ).toBeNull();
  });

  describe("via POST /api/ai/categorize", () => {
    it("answers from history without calling the AI", async () => {
      addTx("STARBUCKS #1234", -575, "Dining Out");
      const ai = { model: "fake", completeJson: vi.fn() };

      const res = await request(createApp(db, { ai }))
        .post("/api/ai/categorize")
        .send({ description: "STARBUCKS #42", amount_cents: -500 });

      expect(res.body).toEqual({
        suggestion: { id: cat("Dining Out"), name: "Dining Out" },
        source: "history",
      });
      expect(ai.completeJson).not.toHaveBeenCalled(); // free!
    });

    it("still answers from history when AI is not configured", async () => {
      addTx("STARBUCKS #1234", -575, "Dining Out");
      const res = await request(createApp(db)) // no AI key
        .post("/api/ai/categorize")
        .send({ description: "STARBUCKS #42", amount_cents: -500 });

      expect(res.status).toBe(200);
      expect(res.body.source).toBe("history");
    });
  });
});
