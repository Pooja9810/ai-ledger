import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";
import { MAX_IMPORT_ROWS } from "../src/import-transactions.js";

describe("POST /api/transactions/import", () => {
  let db;
  let app;
  let checking;
  let savings;
  const cat = (name) =>
    db.prepare("SELECT id FROM categories WHERE name = ?").get(name).id;
  const countRows = () =>
    db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n;
  const post = (body) =>
    request(app).post("/api/transactions/import").send(body);

  beforeEach(() => {
    db = openDatabase(":memory:");
    app = createApp(db);
    const add = (name) =>
      db
        .prepare("INSERT INTO accounts (name, type) VALUES (?, 'checking')")
        .run(name).lastInsertRowid;
    checking = add("Checking");
    savings = add("Savings");
  });

  const coffee = {
    date: "2026-11-09",
    description: "TIM HORTONS #123",
    amount_cents: -400,
    category_id: null,
  };

  it("imports rows and reports the count", async () => {
    const res = await post({
      account_id: checking,
      rows: [
        { ...coffee, category_id: cat("Dining Out") },
        {
          date: "2026-11-10",
          description: "  ACME PAYROLL  ",
          amount_cents: 412500,
          category_id: cat("Salary"),
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ imported: 2, skipped_duplicates: 0 });
    const saved = db
      .prepare(
        "SELECT description, amount_cents, category_id FROM transactions ORDER BY date",
      )
      .all();
    expect(saved).toEqual([
      {
        description: "TIM HORTONS #123",
        amount_cents: -400,
        category_id: cat("Dining Out"),
      },
      {
        description: "ACME PAYROLL",
        amount_cents: 412500,
        category_id: cat("Salary"),
      }, // trimmed
    ]);
  });

  it("accepts uncategorized rows (category_id null or missing)", async () => {
    const { category_id, ...withoutCategory } = coffee;
    const res = await post({ account_id: checking, rows: [withoutCategory] });
    expect(res.status).toBe(201);
    expect(
      db.prepare("SELECT category_id FROM transactions").get().category_id,
    ).toBeNull();
  });

  describe("duplicates", () => {
    it("skips rows already in the ledger (importing the same file twice)", async () => {
      await post({ account_id: checking, rows: [coffee] });
      const res = await post({ account_id: checking, rows: [coffee] });
      expect(res.body).toEqual({ imported: 0, skipped_duplicates: 1 });
      expect(countRows()).toBe(1);
    });

    it("matches the merchant loosely (store numbers, case)", async () => {
      await post({ account_id: checking, rows: [coffee] });
      const res = await post({
        account_id: checking,
        rows: [{ ...coffee, description: "Tim Hortons #999" }],
      });
      expect(res.body.skipped_duplicates).toBe(1);
    });

    it("COUNTS matches: two real coffees vs one already saved → import one", async () => {
      await post({ account_id: checking, rows: [coffee] });
      const res = await post({ account_id: checking, rows: [coffee, coffee] });
      expect(res.body).toEqual({ imported: 1, skipped_duplicates: 1 });
      expect(countRows()).toBe(2);
    });

    it("keeps identical rows within one file (two coffees on the same day)", async () => {
      const res = await post({ account_id: checking, rows: [coffee, coffee] });
      expect(res.body).toEqual({ imported: 2, skipped_duplicates: 0 });
    });

    it.each([
      ["a different account", { account_id: "savings" }],
      ["a different date", { date: "2026-11-10" }],
      ["a different amount", { amount_cents: -450 }],
      ["a different merchant", { description: "STARBUCKS" }],
    ])("doesn't treat %s as a duplicate", async (_label, change) => {
      await post({ account_id: checking, rows: [coffee] });
      const { account_id: which, ...rowChange } = change;
      const res = await post({
        account_id: which === "savings" ? savings : checking,
        rows: [{ ...coffee, ...rowChange }],
      });
      expect(res.body.imported).toBe(1);
    });
  });

  describe("validation: all or nothing", () => {
    it("imports nothing if any row is invalid, and names the rows", async () => {
      const res = await post({
        account_id: checking,
        rows: [
          coffee,
          { ...coffee, date: "11/09/2026" },
          { ...coffee, amount_cents: 4.5 },
        ],
      });
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        "row 2: date must be a real date in YYYY-MM-DD format",
        "row 3: amount_cents must be a non-zero whole number of cents",
      ]);
      expect(countRows()).toBe(0); // the valid row 1 wasn't saved either
    });

    it("lists at most 10 row errors, then a count", async () => {
      const rows = Array.from({ length: 25 }, () => ({
        ...coffee,
        date: "bad",
      }));
      const res = await post({ account_id: checking, rows });
      expect(res.body.errors).toHaveLength(11);
      expect(res.body.errors.at(-1)).toBe("…and 15 more row errors");
    });

    it.each([
      [{ rows: [coffee] }, "account_id must be an integer"],
      [{ account_id: 999, rows: [coffee] }, "account_id does not exist"],
      [{ account_id: 1, rows: [] }, "rows must be a non-empty list"],
      [{ account_id: 1, rows: "nope" }, "rows must be a non-empty list"],
      [{ account_id: 1, rows: [null] }, "row 1: must be an object"],
      [
        { account_id: 1, rows: [{ ...coffee, category_id: 9999 }] },
        "row 1: category_id does not exist",
      ],
      [
        { account_id: 1, rows: [{ ...coffee, description: 42 }] },
        "row 1: description must be text of at most 500 characters",
      ],
      [
        { account_id: 1, rows: [{ ...coffee, amount_cents: 0 }] },
        "row 1: amount_cents must be a non-zero whole number of cents",
      ],
    ])("rejects %j", async (body, message) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(res.body.errors).toContain(message);
    });

    it("rejects transfer categories (account transfers aren't supported yet)", async () => {
      const res = await post({
        account_id: checking,
        rows: [{ ...coffee, category_id: cat("Opening balance") }],
      });
      expect(res.body.errors).toEqual([
        "row 1: transfer categories can't be imported",
      ]);
    });

    it(`rejects more than ${MAX_IMPORT_ROWS} rows`, async () => {
      const rows = Array(MAX_IMPORT_ROWS + 1).fill(coffee);
      const res = await post({ account_id: checking, rows });
      expect(res.body.errors).toEqual([
        `at most ${MAX_IMPORT_ROWS} rows per import`,
      ]);
    });
  });

  it(`accepts a full ${MAX_IMPORT_ROWS}-row import (bigger than Express's default 100 KB limit)`, async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => ({
      ...coffee,
      description: `MERCHANT NUMBER ${i} WITH A LONGER DESCRIPTION, TORONTO ON`,
    }));
    const res = await post({ account_id: checking, rows });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(MAX_IMPORT_ROWS);
  });

  it("keeps the default size limit on other routes", async () => {
    const res = await request(app)
      .post("/api/transactions")
      .send({ description: "x".repeat(200_000) });
    expect(res.status).toBe(413);
  });

  it("rolls back everything if the database fails mid-import", async () => {
    // Simulate a failure on the 2nd insert: drop the column it needs... can't
    // easily, so make the 2nd row violate a CHECK by bypassing validation.
    const { importTransactions } =
      await import("../src/import-transactions.js");
    expect(() =>
      importTransactions(db, {
        account_id: checking,
        rows: [
          coffee,
          { ...coffee, date: "2026-11-11", amount_cents: "not a number" },
        ],
      }),
    ).toThrow();
    expect(countRows()).toBe(0); // the 1st row was rolled back too
  });
});
