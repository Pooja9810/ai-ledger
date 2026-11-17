import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { openDatabase } from "./db/index.js";
import { createAiClient } from "./ai/client.js";
import { createDemoSite, RESET_EVERY_MS } from "./demo.js";

// Configuration comes from environment variables, with sensible defaults.
const PORT = process.env.PORT ?? 3001;
const DB_PATH =
  process.env.DB_PATH ??
  fileURLToPath(new URL("../ledger.db", import.meta.url));
// DEMO_MODE=true: the public demo (made-up data in memory, reset every hour).
// Never set it for your real ledger.
const DEMO_MODE = process.env.DEMO_MODE === "true";

// The built React app (`npm run build` in client/). When it exists, this
// server serves the whole site; in development, Vite serves it instead.
const CLIENT_DIR = fileURLToPath(new URL("../../client/dist", import.meta.url));
const clientDir = existsSync(CLIENT_DIR) ? CLIENT_DIR : null;

const ai = createAiClient(); // null when DEEPSEEK_API_KEY isn't set

let handler;
if (DEMO_MODE) {
  const site = createDemoSite({ ai, clientDir });
  setInterval(() => site.reset(), RESET_EVERY_MS);
  handler = site.handle;
} else {
  handler = createApp(openDatabase(DB_PATH), { ai, clientDir });
}

createServer(handler).listen(PORT, () => {
  console.log(`Ledgerly API running at http://localhost:${PORT}`);
  if (DEMO_MODE) console.log("DEMO MODE: made-up data, reset every hour");
  if (clientDir) console.log("Serving the built web app from client/dist");
  console.log(
    ai
      ? `AI enabled (${ai.model})`
      : "AI disabled: set DEEPSEEK_API_KEY in server/.env",
  );
});
