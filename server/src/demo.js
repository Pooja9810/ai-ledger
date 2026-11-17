/**
 * Demo mode, for the public hosted demo: made-up data, reset every hour.
 *
 * Each reset builds a COMPLETE new site (a fresh in-memory database with
 * generated demo data, and a new app around it), then switches incoming
 * requests to it in one step. Requests already running finish on the old
 * one, so no visitor ever sees a half-reset ledger. Nothing touches disk.
 */
import { openDatabase } from "./db/index.js";
import { createApp } from "./app.js";
import { generateDemoData, writeDemoData } from "../scripts/demo-data.js";
import { createAiLimiter } from "./rate-limit.js";

export const RESET_EVERY_MS = 60 * 60 * 1000; // one hour
const CLOSE_OLD_AFTER_MS = 60 * 1000; // let in-flight requests finish first

/** Today in the server's time zone ('YYYY-MM-DD'); set TZ=America/Toronto when hosting. */
const localToday = () => new Date().toLocaleDateString("en-CA");

/**
 * @param ai         AI client or null
 * @param clientDir  built React app, or null
 * @param today      () => 'YYYY-MM-DD' (injectable for tests)
 * @param aiLimiter  limits AI requests; created ONCE, so the counts survive
 *                   the hourly resets (otherwise the daily total would too)
 * @returns { handle(req, res), reset(), db() }
 *   handle: pass every request here (it goes to the current site)
 *   reset:  build a fresh site now and switch to it
 *   db:     the current database (for tests)
 */
export function createDemoSite({
  ai = null,
  clientDir = null,
  today = localToday,
  aiLimiter = createAiLimiter(),
} = {}) {
  let current = build();

  function build() {
    const db = openDatabase(":memory:");
    writeDemoData(db, generateDemoData({ today: today() }));
    return { db, app: createApp(db, { ai, clientDir, demo: true, aiLimiter }) };
  }

  return {
    handle: (req, res) => current.app(req, res),
    reset() {
      const old = current;
      current = build(); // the switch: new requests go to the new site
      setTimeout(() => old.db.close(), CLOSE_OLD_AFTER_MS).unref();
    },
    db: () => current.db,
  };
}
