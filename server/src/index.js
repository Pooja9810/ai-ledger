import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { openDatabase } from "./db/index.js";
import { createAiClient } from "./ai/client.js";
import { createDemoSite, RESET_EVERY_MS } from "./demo.js";
import { createAiLimiter } from "./rate-limit.js";

// Configuration comes from environment variables, with sensible defaults.
const PORT = process.env.PORT ?? 3001;
const DB_PATH =
  process.env.DB_PATH ??
  fileURLToPath(new URL("../ledger.db", import.meta.url));
// DEMO_MODE=true: the public demo (made-up data in memory, reset every hour).
// Never set it for your real ledger.
const DEMO_MODE = process.env.DEMO_MODE === "true";
// The demo's AI limits (see rate-limit.js); adjustable without a code change.
const AI_LIMIT_PER_VISITOR_PER_HOUR = Number(
  process.env.AI_LIMIT_PER_VISITOR_PER_HOUR ?? 30,
);
const AI_LIMIT_PER_DAY = Number(process.env.AI_LIMIT_PER_DAY ?? 500);

// The built React app (`npm run build` in client/). When it exists, this
// server serves the whole site; in development, Vite serves it instead.
const CLIENT_DIR = fileURLToPath(new URL("../../client/dist", import.meta.url));
const clientDir = existsSync(CLIENT_DIR) ? CLIENT_DIR : null;

const ai = createAiClient(); // null when DEEPSEEK_API_KEY isn't set

let handler;
if (DEMO_MODE) {
  const aiLimiter = createAiLimiter({
    perVisitorPerHour: AI_LIMIT_PER_VISITOR_PER_HOUR,
    totalPerDay: AI_LIMIT_PER_DAY,
  });
  const site = createDemoSite({ ai, clientDir, aiLimiter });
  setInterval(() => site.reset(), RESET_EVERY_MS);
  handler = site.handle;
} else {
  handler = createApp(openDatabase(DB_PATH), { ai, clientDir });
}

createServer(handler).listen(PORT, () => {
  console.log(`Ledgerly API running at http://localhost:${PORT}`);
  if (DEMO_MODE) {
    console.log("DEMO MODE: made-up data, reset every hour");
    console.log(
      `AI limit: ${AI_LIMIT_PER_VISITOR_PER_HOUR} per visitor per hour, ${AI_LIMIT_PER_DAY} per day`,
    );
  }
  if (clientDir) console.log("Serving the built web app from client/dist");
  console.log(
    ai
      ? `AI enabled (${ai.model})`
      : "AI disabled: set DEEPSEEK_API_KEY in server/.env",
  );
});
