import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { openDatabase } from "./db/index.js";
import { createAiClient } from "./ai/client.js";

// Configuration comes from environment variables, with sensible defaults.
const PORT = process.env.PORT ?? 3001;
const DB_PATH =
  process.env.DB_PATH ??
  fileURLToPath(new URL("../ledger.db", import.meta.url));

const db = openDatabase(DB_PATH);
const ai = createAiClient(); // null when DEEPSEEK_API_KEY isn't set
const app = createApp(db, { ai });

app.listen(PORT, () => {
  console.log(`Ledgerly API running at http://localhost:${PORT}`);
  console.log(
    ai
      ? `AI enabled (${ai.model})`
      : "AI disabled: set DEEPSEEK_API_KEY in server/.env",
  );
});
