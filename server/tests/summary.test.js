import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";

describe("summary API", () => {
  let app;
  let db;
  let accountId;
  const categoryIds = {};

  beforeEach(async () => {
    db = openDatabase(":memory:");
    app = createApp(db);
    accountId = (
      await request(app).post("/api/accounts").send({
        name: "Checking",
        type: "checking",
        opening_balance_cents: 100000, // uncategorized, dated today
      })
    ).body.id;
    for (const { id, name } of db
      .prepare("SELECT id, name FROM categories")
      .all()) {
      categoryIds[name] = id;
    }
  });

  const add = (category, cents, date) =>
    request(app)
      .post("/api/transactions")
      .send({
        account_id: accountId,
        category_id: category ? categoryIds[category] : null,
        date,
        amount_cents: cents,
      });

  it("totals income, spending, and net for one month", async () => {
    await add("Salary", 400000, "2026-11-01");
    await add("Groceries", -12000, "2026-11-03");
    await add(null, -3000, "2026-11-04"); // uncategorized spending still counts
    await add("Groceries", -99999, "2026-10-31"); // other month: ignored

    const res = await request(app).get("/api/summary?month=2026-11");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      month: "2026-11",
      income_cents: 400000,
      spending_cents: 15000,
      net_cents: 385000,
    });
  });

  it("does not count opening balances (transfer kind) as income", async () => {
    const thisMonth = new Date().toLocaleDateString("en-CA").slice(0, 7);
    const res = await request(app).get(`/api/summary?month=${thisMonth}`);
    expect(res.body.income_cents).toBe(0); // the $1,000 opening balance is excluded
  });

  it("reports net worth across all time and accounts", async () => {
    await add("Groceries", -2500, "2026-01-15");
    const res = await request(app).get("/api/summary?month=2026-11");
    expect(res.body.net_worth_cents).toBe(100000 - 2500);
  });

  it("returns zeros for a month with no activity", async () => {
    const res = await request(app).get("/api/summary?month=1999-01");
    expect(res.body).toMatchObject({
      income_cents: 0,
      spending_cents: 0,
      net_cents: 0,
    });
  });

  it("rejects an invalid month", async () => {
    const res = await request(app).get("/api/summary?month=nope");
    expect(res.status).toBe(400);
  });
});
