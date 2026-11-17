import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createAiLimiter } from "../src/rate-limit.js";

/** A tiny app behind the limiter, with a clock we control. */
function setup(options) {
  const clock = { t: 0 };
  const app = express();
  app.set("trust proxy", true); // so tests can pick the visitor's IP
  app.use(createAiLimiter({ ...options, now: () => clock.t }));
  app.get("/", (req, res) => res.json({ ok: true }));
  const hit = (ip = "1.1.1.1") =>
    request(app).get("/").set("X-Forwarded-For", ip);
  return { clock, hit };
}

describe("AI rate limit", () => {
  it("lets a visitor make their requests, then says when to come back", async () => {
    const { hit } = setup({ perVisitorPerHour: 3 });
    for (let i = 0; i < 3; i++) expect((await hit()).status).toBe(200);
    const blocked = await hit();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/try again in 60 min/);
    expect(blocked.headers["retry-after"]).toBe("3600");
  });

  it("counts each visitor separately", async () => {
    const { hit } = setup({ perVisitorPerHour: 1 });
    expect((await hit("1.1.1.1")).status).toBe(200);
    expect((await hit("1.1.1.1")).status).toBe(429);
    expect((await hit("2.2.2.2")).status).toBe(200);
  });

  it("lets a visitor back in after their hour is over", async () => {
    const { clock, hit } = setup({ perVisitorPerHour: 1 });
    await hit();
    clock.t = 59 * 60 * 1000;
    expect((await hit()).status).toBe(429);
    clock.t = 60 * 60 * 1000;
    expect((await hit()).status).toBe(200);
  });

  it("stops everyone once the daily total is used, until the next day", async () => {
    const { clock, hit } = setup({ perVisitorPerHour: 100, totalPerDay: 2 });
    expect((await hit("1.1.1.1")).status).toBe(200);
    expect((await hit("2.2.2.2")).status).toBe(200);
    const blocked = await hit("3.3.3.3");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/for today/);
    clock.t = 24 * 60 * 60 * 1000;
    expect((await hit("3.3.3.3")).status).toBe(200);
  });

  it("doesn't count blocked requests against the daily total", async () => {
    const { hit } = setup({ perVisitorPerHour: 1, totalPerDay: 2 });
    await hit("1.1.1.1");
    await hit("1.1.1.1"); // blocked by the visitor limit
    await hit("1.1.1.1"); // blocked again
    expect((await hit("2.2.2.2")).status).toBe(200); // total is 2 of 2 now
  });
});
