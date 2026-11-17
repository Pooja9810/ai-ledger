import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";

// A stand-in for client/dist (the built React app).
let clientDir;
beforeAll(() => {
  clientDir = mkdtempSync(join(tmpdir(), "ledgerly-dist-"));
  writeFileSync(
    join(clientDir, "index.html"),
    "<!doctype html><title>Ledgerly</title>",
  );
  mkdirSync(join(clientDir, "assets"));
  writeFileSync(join(clientDir, "assets", "app.js"), "console.log('hi')");
});

describe("serving the built React app (one server for everything)", () => {
  const app = () => createApp(openDatabase(":memory:"), { clientDir });

  it("serves index.html at /", async () => {
    const res = await request(app()).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<title>Ledgerly</title>");
  });

  it("serves built files like JavaScript", async () => {
    const res = await request(app()).get("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
  });

  it("answers other page addresses with index.html, so React can load", async () => {
    const res = await request(app()).get("/some/page");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<title>Ledgerly</title>");
  });

  it("still answers unknown /api addresses with a JSON 404", async () => {
    const res = await request(app()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("keeps the API working alongside the app", async () => {
    const res = await request(app()).get("/api/health");
    expect(res.body).toEqual({ status: "ok" });
  });

  it("serves no pages when there's no built app (local development)", async () => {
    const res = await request(createApp(openDatabase(":memory:"))).get("/");
    expect(res.status).toBe(404);
  });
});
