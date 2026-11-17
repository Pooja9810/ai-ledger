/**
 * A limit on AI requests, for the public demo: every AI call costs money on
 * the owner's API key. Two limits for two risks:
 *   - per visitor (by IP address): one person can't hammer it
 *   - in total per day: many visitors or bots together can't either
 *
 * Fixed windows kept in memory: simple, and enough for one small server.
 * (Counters reset if the server restarts; the DeepSeek spending cap is the
 * final safety net.) `now` is injectable so tests can fast-forward time.
 */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function createAiLimiter({
  perVisitorPerHour = 30,
  totalPerDay = 500,
  now = Date.now,
} = {}) {
  const visitors = new Map(); // ip → { count, resetAt }
  let total = { count: 0, resetAt: now() + DAY };

  const minutesUntil = (t) => Math.max(1, Math.ceil((t - now()) / 60000));

  return function aiLimit(req, res, next) {
    const t = now();
    if (t >= total.resetAt) total = { count: 0, resetAt: t + DAY };
    if (total.count >= totalPerDay) {
      res.set("Retry-After", String(Math.ceil((total.resetAt - t) / 1000)));
      return res.status(429).json({
        error:
          "The demo has used its AI allowance for today; please try again tomorrow",
      });
    }

    const ip = req.ip ?? "unknown";
    let visitor = visitors.get(ip);
    if (!visitor || t >= visitor.resetAt) {
      visitor = { count: 0, resetAt: t + HOUR };
      visitors.set(ip, visitor);
    }
    if (visitor.count >= perVisitorPerHour) {
      res.set("Retry-After", String(Math.ceil((visitor.resetAt - t) / 1000)));
      return res.status(429).json({
        error: `You've reached the demo's AI limit; try again in ${minutesUntil(visitor.resetAt)} min`,
      });
    }

    visitor.count += 1;
    total.count += 1;
    // Forget visitors whose hour is over, so the map can't grow forever.
    if (visitors.size > 10000) {
      for (const [key, v] of visitors) if (t >= v.resetAt) visitors.delete(key);
    }
    next();
  };
}
