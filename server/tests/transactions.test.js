import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";

describe("transactions API", () => {
  let app;
  let db;
  let checkingId;
  let savingsId;
  let groceriesId;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    app = createApp(db);
    checkingId = (
      await request(app)
        .post("/api/accounts")
        .send({ name: "Checking", type: "checking" })
    ).body.id;
    savingsId = (
      await request(app)
        .post("/api/accounts")
        .send({ name: "Savings", type: "savings" })
    ).body.id;
    groceriesId = db
      .prepare("SELECT id FROM categories WHERE name = 'Groceries'")
      .get().id;
  });

  // Helper: create a transaction with sensible defaults, override what you need.
  const create = (overrides = {}) =>
    request(app)
      .post("/api/transactions")
      .send({
        account_id: checkingId,
        date: "2026-11-05",
        amount_cents: -1250,
        ...overrides,
      });

  describe("POST", () => {
    it("creates a transaction and returns it with account and category names", async () => {
      const res = await create({
        category_id: groceriesId,
        description: "  Whole Foods  ",
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        account_name: "Checking",
        category_name: "Groceries",
        amount_cents: -1250,
        description: "Whole Foods", // trimmed
      });
    });

    it("allows uncategorized transactions", async () => {
      const res = await create();
      expect(res.status).toBe(201);
      expect(res.body.category_id).toBeNull();
    });

    it("rejects missing required fields, listing each one", async () => {
      const res = await request(app).post("/api/transactions").send({});
      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveLength(3); // account_id, date, amount_cents
    });

    it("returns 400 (not 500) for an account or category that does not exist", async () => {
      const res = await create({ account_id: 9999, category_id: 9999 });
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        "account_id does not exist",
        "category_id does not exist",
      ]);
    });

    it.each([
      ["a float amount", { amount_cents: 12.5 }],
      ["a zero amount", { amount_cents: 0 }],
      ["an impossible date", { date: "2026-02-30" }],
      ["a badly formatted date", { date: "11/05/2026" }],
      ["an unknown field (typo)", { amount: 500 }],
    ])("rejects %s", async (_label, overrides) => {
      const res = await create(overrides);
      expect(res.status).toBe(400);
    });
  });

  describe("GET list with filters", () => {
    beforeEach(async () => {
      await create({
        date: "2026-10-15",
        amount_cents: -3000,
        category_id: groceriesId,
      });
      await create({ date: "2026-11-01", amount_cents: -2000 });
      await create({
        date: "2026-11-20",
        amount_cents: 500000,
        account_id: savingsId,
      });
    });

    const amounts = (res) => res.body.map((t) => t.amount_cents);

    it("returns all transactions, newest first", async () => {
      const res = await request(app).get("/api/transactions");
      expect(amounts(res)).toEqual([500000, -2000, -3000]);
    });

    it("filters by account", async () => {
      const res = await request(app).get(
        `/api/transactions?account_id=${savingsId}`,
      );
      expect(amounts(res)).toEqual([500000]);
    });

    it("filters by date range (inclusive)", async () => {
      const res = await request(app).get(
        "/api/transactions?from=2026-11-01&to=2026-11-30",
      );
      expect(amounts(res)).toEqual([500000, -2000]);
    });

    it("filters by category and by uncategorized", async () => {
      const byCategory = await request(app).get(
        `/api/transactions?category_id=${groceriesId}`,
      );
      expect(amounts(byCategory)).toEqual([-3000]);

      const uncategorized = await request(app).get(
        "/api/transactions?uncategorized=true",
      );
      expect(amounts(uncategorized)).toEqual([500000, -2000]);
    });

    it("combines filters", async () => {
      const res = await request(app).get(
        `/api/transactions?account_id=${checkingId}&from=2026-11-01`,
      );
      expect(amounts(res)).toEqual([-2000]);
    });

    it("rejects invalid filter values", async () => {
      const res = await request(app).get(
        "/api/transactions?account_id=abc&from=yesterday",
      );
      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveLength(2);
    });
  });

  describe("GET one", () => {
    it("returns 404 for missing or invalid ids", async () => {
      expect((await request(app).get("/api/transactions/9999")).status).toBe(
        404,
      );
      expect((await request(app).get("/api/transactions/abc")).status).toBe(
        404,
      );
    });
  });

  describe("PATCH", () => {
    it("updates only the fields that are sent", async () => {
      const { body: tx } = await create({ description: "Coffee" });

      const res = await request(app)
        .patch(`/api/transactions/${tx.id}`)
        .send({ category_id: groceriesId });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        category_name: "Groceries",
        description: "Coffee",
        amount_cents: -1250,
      });
    });

    it("can uncategorize by setting category_id to null", async () => {
      const { body: tx } = await create({ category_id: groceriesId });
      const res = await request(app)
        .patch(`/api/transactions/${tx.id}`)
        .send({ category_id: null });
      expect(res.body.category_id).toBeNull();
    });

    it("updates the account balance (derived, never stored)", async () => {
      const { body: tx } = await create({ amount_cents: -1000 });
      await request(app)
        .patch(`/api/transactions/${tx.id}`)
        .send({ amount_cents: -4000 });

      const account = await request(app).get(`/api/accounts/${checkingId}`);
      expect(account.body.balance_cents).toBe(-4000);
    });

    it("rejects an empty update", async () => {
      const { body: tx } = await create();
      const res = await request(app)
        .patch(`/api/transactions/${tx.id}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(["no fields to update"]);
    });

    it("rejects SQL injection attempts in field names", async () => {
      const { body: tx } = await create();
      const res = await request(app)
        .patch(`/api/transactions/${tx.id}`)
        .send({ "amount_cents = 0; DROP TABLE accounts; --": 1 });

      expect(res.status).toBe(400);
      expect((await request(app).get("/api/accounts")).body).toHaveLength(2); // still there
    });

    it("returns 404 for a transaction that does not exist", async () => {
      const res = await request(app)
        .patch("/api/transactions/9999")
        .send({ amount_cents: -1 });
      expect(res.status).toBe(404);
    });
  });
});
