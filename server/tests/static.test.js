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
    "<!doctype html><html><head><title>Ledgerly</title></head><body></body></html>",
  );
  mkdirSync(join(clientDir, "assets"));
  writeFileSync(join(clientDir, "assets", "app.js"), "console.log('hi')");
  // Big enough to be worth compressing (small responses are sent as-is).
  writeFileSync(
    join(clientDir, "assets", "big.js"),
    "console.log('ledgerly');\n".repeat(400),
  );
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

  it("puts the config in the page, so the demo banner needs no extra request", async () => {
    const demoApp = createApp(openDatabase(":memory:"), {
      clientDir,
      demo: true,
    });
    for (const path of ["/", "/index.html", "/some/page"]) {
      const res = await request(demoApp).get(path);
      expect(res.text).toContain(
        `<meta name="ledgerly-config" content='{"demo":true,"resets_every_minutes":60}' />`,
      );
      expect(res.headers["cache-control"]).toBe("no-cache");
    }
    const normal = await request(app()).get("/");
    expect(normal.text).toContain(`content='{"demo":false}'`);
  });

  it("compresses responses for browsers that accept gzip", async () => {
    const res = await request(app())
      .get("/assets/big.js")
      .set("Accept-Encoding", "gzip");
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("lets browsers keep content-named build files for a year", async () => {
    const res = await request(app()).get("/assets/app.js");
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    const page = await request(app()).get("/");
    expect(page.headers["cache-control"]).not.toMatch(/immutable/); // index.html must update
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
