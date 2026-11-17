/**
 * A tiny SEEDED random number generator (mulberry32).
 *
 * Math.random() gives different numbers every run. This gives the SAME
 * sequence for the same seed, so the demo data is random-looking but
 * repeatable: same input, same data, same screenshots.
 */
export function createRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // 0 ≤ n < 1
  };
  return {
    next,
    /** Whole number from min to max, both included. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** true with the given probability (0.3 → 30% of the time). */
    chance: (p) => next() < p,
    /** One item from a list. */
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}
