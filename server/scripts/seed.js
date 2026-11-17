// Build a fresh DEMO database: six months of realistic sample data.
// It writes to server/demo.db and never touches your real ledger.db.
// The data itself comes from scripts/demo-data.js.
//
// Usage: npm run seed      (then: npm run dev:demo)

import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db/index.js";
import { generateDemoData, writeDemoData } from "./demo-data.js";

const DEMO_PATH = fileURLToPath(new URL("../demo.db", import.meta.url));

// Today in the user's local time ('YYYY-MM-DD'), so the demo always looks current.
const today = new Date().toLocaleDateString("en-CA");

rmSync(DEMO_PATH, { force: true }); // start from scratch every time
const db = openDatabase(DEMO_PATH);
const data = generateDemoData({ today });
writeDemoData(db, data);

console.log(
  `Demo database created at ${DEMO_PATH}: ` +
    `${data.transactions.length} transactions and ${data.transfers.length} transfers, ` +
    `${data.transactions[0].date} to ${data.transactions.at(-1).date}`,
);
