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
    it("lists the 10 default categories", async () => {
      const res = await request(app).get("/api/categories");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(10);
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

  // 🏋️ YOUR EXERCISE: describe("DELETE", ...) goes here
});
