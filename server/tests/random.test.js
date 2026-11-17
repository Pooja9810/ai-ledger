import { describe, it, expect } from "vitest";
import { createRandom } from "../scripts/random.js";

describe("createRandom (seeded)", () => {
  it("gives the same sequence for the same seed", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("gives a different sequence for a different seed", () => {
    expect(createRandom(1).next()).not.toBe(createRandom(2).next());
  });

  it("int stays within min and max, and hits both ends", () => {
    const r = createRandom(7);
    const seen = new Set(Array.from({ length: 500 }, () => r.int(1, 3)));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it("chance(0.3) is true about 30% of the time", () => {
    const r = createRandom(7);
    const hits = Array.from({ length: 10000 }, () => r.chance(0.3)).filter(
      Boolean,
    ).length;
    expect(hits).toBeGreaterThan(2800);
    expect(hits).toBeLessThan(3200);
  });
});
