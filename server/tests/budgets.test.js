import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";

describe("budgets API", () => {
  let app;
  let db;
  let accountId;
  const categoryIds = {};

  beforeEach(async () => {
    db = openDatabase(":memory:");
    app = createApp(db);
    accountId = (
      await request(app)
        .post("/api/accounts")
        .send({ name: "Checking", type: "checking" })
    ).body.id;
    for (const { id, name } of db
      .prepare("SELECT id, name FROM categories")
      .all()) {
      categoryIds[name] = id;
    }
  });

  const setBudget = (category, cents) =>
    request(app)
      .put(`/api/budgets/${categoryIds[category]}`)
      .send({ monthly_limit_cents: cents });

  const spend = (category, cents, date) =>
    request(app).post("/api/transactions").send({
      account_id: accountId,
      category_id: categoryIds[category],
      date,
      amount_cents: -cents, // spending is negative
    });

  describe("PUT", () => {
    it("creates a budget", async () => {
      const res = await setBudget("Groceries", 40000);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        category_name: "Groceries",
        monthly_limit_cents: 40000,
      });
    });

    it("is idempotent: setting a budget twice updates it, never duplicates", async () => {
      await setBudget("Groceries", 40000);
      await setBudget("Groceries", 55000);

      const { count } = db
        .prepare("SELECT COUNT(*) AS count FROM budgets")
        .get();
      expect(count).toBe(1);
      const res = await request(app).get("/api/budgets");
      expect(res.body[0].monthly_limit_cents).toBe(55000);
    });

    it("rejects budgets on income categories", async () => {
      const res = await setBudget("Salary", 100000);
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        "budgets can only be set on expense categories",
      ]);
    });

    it("rejects budgets on the system transfer category", async () => {
      const res = await setBudget("Opening balance", 100000);
      expect(res.status).toBe(400);
    });

    it.each([0, -500, 12.5, "400"])("rejects a limit of %j", async (limit) => {
      const res = await setBudget("Groceries", limit);
      expect(res.status).toBe(400);
    });

    it("returns 404 for a category that does not exist", async () => {
      const res = await request(app)
        .put("/api/budgets/9999")
        .send({ monthly_limit_cents: 100 });
      expect(res.status).toBe(404);
    });
  });

  describe("GET", () => {
    it("adds up spending for the requested month only", async () => {
      await setBudget("Groceries", 40000);
      await spend("Groceries", 12000, "2026-11-03");
      await spend("Groceries", 8000, "2026-11-30");
      await spend("Groceries", 99999, "2026-10-31"); // October — must NOT count
      await spend("Dining Out", 5000, "2026-11-10"); // other category — must NOT count

      const res = await request(app).get("/api/budgets?month=2026-11");

      expect(res.body).toEqual([
        {
          category_id: categoryIds.Groceries,
          category_name: "Groceries",
          monthly_limit_cents: 40000,
          spent_cents: 20000,
          remaining_cents: 20000,
        },
      ]);
    });

    it("shows negative remaining when over budget", async () => {
      await setBudget("Dining Out", 10000);
      await spend("Dining Out", 13000, "2026-11-05");

      const res = await request(app).get("/api/budgets?month=2026-11");
      expect(res.body[0].remaining_cents).toBe(-3000);
    });

    it("still lists a budget with no spending (the ON vs WHERE trap)", async () => {
      await setBudget("Groceries", 40000);
      await setBudget("Transport", 15000);
      await spend("Groceries", 1000, "2026-11-05"); // nothing spent on Transport

      const res = await request(app).get("/api/budgets?month=2026-11");

      expect(res.body.map((b) => [b.category_name, b.spent_cents])).toEqual([
        ["Groceries", 1000],
        ["Transport", 0],
      ]);
    });

    it("rejects an invalid month", async () => {
      const res = await request(app).get("/api/budgets?month=2026-13");
      expect(res.status).toBe(400);
    });

    it("removes the budget when its category is deleted (CASCADE)", async () => {
      await setBudget("Groceries", 40000);
      await request(app).delete(`/api/categories/${categoryIds.Groceries}`);

      const res = await request(app).get("/api/budgets");
      expect(res.body).toEqual([]);
    });
  });

  describe("DELETE", () => {
    it("deletes a budget", async () => {
      await setBudget("Groceries", 40000); // helper: creates a $400 Groceries budget

      const res = await request(app).delete(
        `/api/budgets/${categoryIds.Groceries}`,
      );
      expect(res.status).toBe(204); // ← the SUCCESS status for DELETE

      const list = await request(app).get("/api/budgets");
      expect(list.body).toEqual([]); // ← after deleting the only budget, the list is...?
    });

    it("returns 404 for a real category that has no budget", async () => {
      const res = await request(app).delete(
        `/api/budgets/${categoryIds.Groceries}`,
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for a category that does not exist", async () => {
      const res = await request(app).delete("/api/budgets/9999");
      expect(res.status).toBe(404);
    });

    it("keeps the category when its budget is deleted", async () => {
      await setBudget("Groceries", 40000);
      await request(app).delete(`/api/budgets/${categoryIds.Groceries}`);

      const categories = await request(app).get("/api/categories");
      expect(categories.body.map((c) => c.name)).toContain("Groceries");
    });
  });
});
