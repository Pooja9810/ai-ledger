import { describe, it, expect } from "vitest";
import request from "supertest";
import { createDemoSite } from "../src/demo.js";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";

const today = () => "2026-11-16";
const count = (db) =>
  db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n;

describe("demo site (made-up data, reset every hour)", () => {
  it("starts with six months of demo data", async () => {
    const site = createDemoSite({ today });
    const res = await request(site.handle).get("/api/accounts");
    expect(res.status).toBe(200);
    expect(res.body.map((a) => a.name)).toContain("Everyday Chequing");
    expect(count(site.db())).toBeGreaterThan(250);
  });

  it("puts everything back on reset, including what visitors deleted", async () => {
    const site = createDemoSite({ today });
    const before = count(site.db());
    const { body: rows } = await request(site.handle).get("/api/transactions");
    const normal = rows.find((t) => t.transfer_id === null);
    await request(site.handle).delete(`/api/transactions/${normal.id}`);
    const created = await request(site.handle)
      .post("/api/categories")
      .send({ name: "Visitor test", kind: "expense" });
    expect(created.status).toBe(201);
    expect(count(site.db())).toBe(before - 1);

    site.reset();

    expect(count(site.db())).toBe(before);
    const { body: categories } = await request(site.handle).get(
      "/api/categories",
    );
    expect(categories.map((c) => c.name)).not.toContain("Visitor test");
  });

  it("tells the browser it's a demo", async () => {
    const site = createDemoSite({ today });
    const res = await request(site.handle).get("/api/config");
    expect(res.body).toEqual({ demo: true, resets_every_minutes: 60 });
  });

  it("isn't a demo when run normally", async () => {
    const res = await request(createApp(openDatabase(":memory:"))).get(
      "/api/config",
    );
    expect(res.body).toEqual({ demo: false });
  });
});
