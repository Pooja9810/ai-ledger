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

describe("home summary API (charts)", () => {
  let app;
  let accountId;
  const ids = {};

  beforeEach(async () => {
    const db = openDatabase(":memory:");
    app = createApp(db);
    accountId = (
      await request(app)
        .post("/api/accounts")
        .send({ name: "Checking", type: "checking" })
    ).body.id;
    for (const { id, name } of db
      .prepare("SELECT id, name FROM categories")
      .all()) {
      ids[name] = id;
    }
  });

  const add = (category, cents, date) =>
    request(app)
      .post("/api/transactions")
      .send({
        account_id: accountId,
        category_id: category ? ids[category] : null,
        date,
        amount_cents: cents,
      });
  const home = (q) => request(app).get(`/api/summary/home?${q}`);

  it("breaks spending down by category, largest first, uncategorized included", async () => {
    await add("Groceries", -12000, "2026-11-03");
    await add("Groceries", -3000, "2026-11-05");
    await add("Rent", -150000, "2026-11-01");
    await add(null, -2500, "2026-11-06");
    await add("Salary", 400000, "2026-11-02"); // income: not spending

    const res = await home("month=2026-11&today=2026-11-30");

    expect(res.status).toBe(200);
    expect(res.body.by_category).toEqual([
      { category: "Rent", cents: 150000 },
      { category: "Groceries", cents: 15000 },
      { category: "Uncategorized", cents: 2500 },
    ]);
    expect(res.body.spending_cents).toBe(167500);
    expect(res.body.income_cents).toBe(400000);
  });

  it("compares a month in progress with the same days of last month", async () => {
    await add("Groceries", -10000, "2026-10-05");
    await add("Groceries", -90000, "2026-10-20"); // after Oct 12: not compared
    await add("Groceries", -12000, "2026-11-04");

    const res = await home("month=2026-11&today=2026-11-12");

    expect(res.body.compare).toEqual({
      from: "2026-10-01",
      to: "2026-10-12",
      same_days: true,
      before_cents: 10000,
      change_percent: 20,
    });
  });

  it("compares a finished month with the whole previous month, Feb ending on the 28th", async () => {
    await add("Groceries", -30000, "2026-02-28");
    await add("Groceries", -10000, "2026-03-31");

    const done = await home("month=2026-03&today=2026-04-02");
    expect(done.body.compare).toMatchObject({
      to: "2026-02-28",
      same_days: false,
      change_percent: -66.7,
    });

    const midMarch31 = await home("month=2026-03&today=2026-03-31");
    expect(midMarch31.body.compare.to).toBe("2026-02-28");
  });

  it("has no percent change when last month had no spending", async () => {
    await add("Groceries", -1000, "2026-11-02");
    const res = await home("month=2026-11&today=2026-11-12");
    expect(res.body.compare.change_percent).toBeNull();
  });

  it("trends six months, skipping months before the ledger began, across a year boundary", async () => {
    await add("Groceries", -5000, "2025-11-15");
    await add("Groceries", -7000, "2026-01-10");

    const res = await home("month=2026-02&today=2026-02-10");

    expect(res.body.trend.map((t) => [t.month, t.spending_cents])).toEqual([
      ["2025-11", 5000],
      ["2025-12", 0],
      ["2026-01", 7000],
      ["2026-02", 0],
    ]);
  });

  it("trends income and saved (which can be negative) per month", async () => {
    await add("Salary", 300000, "2026-10-01");
    await add("Rent", -150000, "2026-10-02");
    await add("Rent", -150000, "2026-11-02");

    const res = await home("month=2026-11&today=2026-11-12");

    expect(res.body.trend).toEqual([
      {
        month: "2026-10",
        spending_cents: 150000,
        income_cents: 300000,
        net_cents: 150000,
      },
      {
        month: "2026-11",
        spending_cents: 150000,
        income_cents: 0,
        net_cents: -150000,
      },
    ]);
  });

  it("rejects a bad month or date", async () => {
    expect((await home("month=2026-13")).status).toBe(400);
    expect((await home("month=2026-11&today=soon")).status).toBe(400);
  });
});
