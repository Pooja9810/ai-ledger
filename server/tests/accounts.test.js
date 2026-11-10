import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";

describe("accounts API", () => {
  let app;
  let db;

  beforeEach(() => {
    db = openDatabase(":memory:");
    app = createApp(db);
  });

  it("reports health", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("starts with no accounts", async () => {
    const res = await request(app).get("/api/accounts");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("creates an account with a zero balance", async () => {
    const res = await request(app)
      .post("/api/accounts")
      .send({ name: "Checking", type: "checking" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Checking",
      type: "checking",
      balance_cents: 0,
    });
    expect(res.body.id).toBeTypeOf("number");
  });

  it("creates an opening-balance transaction when one is given", async () => {
    const res = await request(app).post("/api/accounts").send({
      name: "Savings",
      type: "savings",
      opening_balance_cents: 200000,
    });

    expect(res.status).toBe(201);
    expect(res.body.balance_cents).toBe(200000);

    const tx = db
      .prepare("SELECT * FROM transactions WHERE account_id = ?")
      .get(res.body.id);
    expect(tx).toMatchObject({
      description: "Opening balance",
      amount_cents: 200000,
    });
  });

  it("trims whitespace from account names", async () => {
    const res = await request(app)
      .post("/api/accounts")
      .send({ name: "  Wallet  ", type: "cash" });
    expect(res.body.name).toBe("Wallet");
  });

  it("lists accounts with balances derived from transactions", async () => {
    await request(app)
      .post("/api/accounts")
      .send({ name: "A", type: "cash", opening_balance_cents: 5000 });
    await request(app).post("/api/accounts").send({ name: "B", type: "cash" });

    const res = await request(app).get("/api/accounts");

    expect(res.body.map((a) => [a.name, a.balance_cents])).toEqual([
      ["A", 5000],
      ["B", 0], // still listed even with no transactions — that's the LEFT JOIN
    ]);
  });

  it("returns 400 with ALL validation errors at once", async () => {
    const res = await request(app)
      .post("/api/accounts")
      .send({ name: "   ", type: "piggy_bank", opening_balance_cents: 12.5 });

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveLength(3);
  });

  it("returns 400 for malformed JSON instead of crashing", async () => {
    const res = await request(app)
      .post("/api/accounts")
      .set("Content-Type", "application/json")
      .send('{"name": "oops"'); // missing closing brace

    expect(res.status).toBe(400);
  });

  it("returns 404 for an account that does not exist", async () => {
    const res = await request(app).get("/api/accounts/9999");
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
  });
});
