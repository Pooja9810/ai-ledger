import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";

describe("categories API", () => {
  let app;
  let db;

  beforeEach(() => {
    db = openDatabase(":memory:");
    app = createApp(db);
  });

  describe("GET", () => {
    it("lists the 11 default categories", async () => {
      const res = await request(app).get("/api/categories");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(11);
      expect(res.body[0]).toEqual({
        id: expect.any(Number),
        name: "Dining Out", // expense comes before income, then alphabetical
        kind: "expense",
      });
    });
  });

  describe("POST", () => {
    it("creates a category", async () => {
      const res = await request(app)
        .post("/api/categories")
        .send({ name: "  Pets  ", kind: "expense" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: "Pets", kind: "expense" });
    });

    it("returns 409 for a duplicate name, ignoring upper/lower case", async () => {
      const res = await request(app)
        .post("/api/categories")
        .send({ name: "groceries", kind: "expense" });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/);
    });

    it("returns 400 with all validation errors", async () => {
      const res = await request(app)
        .post("/api/categories")
        .send({ name: "", kind: "savings" });

      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveLength(2);
    });
  });

  describe("DELETE", () => {
    it("deletes a category", async () => {
      const { body: pets } = await request(app)
        .post("/api/categories")
        .send({ name: "Pets", kind: "expense" });

      const res = await request(app).delete(`/api/categories/${pets.id}`);
      expect(res.status).toBe(204);

      const list = await request(app).get("/api/categories");
      expect(list.body).toHaveLength(11); // 11 defaults, + Pets, − Pets
    });

    it("returns 404 for a category that does not exist", async () => {
      const res = await request(app).delete(`/api/categories/9999`);
      expect(res.status).toBe(404);
    });

    it("keeps transactions but uncategorizes them", async () => {
      // Arrange: an account, a category, and a transaction in that category
      const { body: account } = await request(app)
        .post("/api/accounts")
        .send({ name: "Checking", type: "checking" });
      const { body: pets } = await request(app)
        .post("/api/categories")
        .send({ name: "Pets", kind: "expense" });
      const { body: tx } = await request(app).post("/api/transactions").send({
        account_id: account.id,
        category_id: pets.id,
        date: "2026-11-10",
        amount_cents: -4500,
      });

      // Act: delete the category
      await request(app).delete(`/api/categories/${pets.id}`);

      // Assert: the transaction survives, with no category
      const after = await request(app).get(`/api/transactions/${tx.id}`);
      expect(after.status).toBe(200);
      expect(after.body.category_id).toBeNull(); // hint: search db.test.js for "Null"
    });

    it("refuses to delete the system 'Opening balance' category", async () => {
      const list = await request(app).get("/api/categories");
      const opening = list.body.find((c) => c.name === "Opening balance");
      expect(opening.kind).toBe("transfer");

      const res = await request(app).delete(`/api/categories/${opening.id}`);
      expect(res.status).toBe(409);
    });
  });
});
