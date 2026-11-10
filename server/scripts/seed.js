// Build a fresh DEMO database full of realistic sample data.
// It writes to server/demo.db and never touches your real ledger.db.
//
// Usage: npm run seed      (then: npm run dev:demo)

import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db/index.js";

const DEMO_PATH = fileURLToPath(new URL("../demo.db", import.meta.url));

// Dates relative to today, so the demo always looks current.
const daysAgo = (n) => {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toLocaleDateString("en-CA"); // 'YYYY-MM-DD', local time
};

rmSync(DEMO_PATH, { force: true }); // start from scratch every time
const db = openDatabase(DEMO_PATH);

const categoryId = (name) =>
  db.prepare("SELECT id FROM categories WHERE name = ?").get(name).id;

const addAccount = db.prepare("INSERT INTO accounts (name, type) VALUES (?, ?)");
const addTransaction = db.prepare(`
  INSERT INTO transactions (account_id, category_id, date, amount_cents, description)
  VALUES (?, ?, ?, ?, ?)`);
const addBudget = db.prepare(
  "INSERT INTO budgets (category_id, monthly_limit_cents) VALUES (?, ?)",
);

db.exec("BEGIN");

const checking = addAccount.run("Everyday Checking", "checking").lastInsertRowid;
const savings = addAccount.run("High-Yield Savings", "savings").lastInsertRowid;
const credit = addAccount.run("Visa Card", "credit_card").lastInsertRowid;
const cash = addAccount.run("Wallet", "cash").lastInsertRowid;

// [account, category (null = uncategorized), days ago, cents, description]
const transactions = [
  [checking, null, 60, 320000, "Opening balance"],
  [savings, null, 60, 1200000, "Opening balance"],
  [cash, null, 60, 15000, "Opening balance"],
  [checking, "Salary", 45, 420000, "Acme Corp payroll"],
  [checking, "Rent", 40, -165000, "Rent"],
  [credit, "Groceries", 38, -8742, "Whole Foods"],
  [credit, "Dining Out", 35, -4610, "Thai Basil"],
  [checking, "Salary", 15, 420000, "Acme Corp payroll"],
  [checking, "Rent", 10, -165000, "Rent"],
  [checking, "Utilities", 8, -9455, "City Power & Light"],
  [credit, "Groceries", 7, -12318, "Trader Joe's"],
  [credit, "Dining Out", 6, -6240, "Sushi Place"],
  [credit, "Dining Out", 4, -11875, "Birthday dinner"],
  [credit, "Transport", 3, -2350, "Uber"],
  [cash, "Dining Out", 2, -650, "Coffee"],
  [credit, "Shopping", 2, -5999, "AMZN MKTP US*2K4"],
  [credit, null, 1, -1899, "SQ *CORNER BAKERY"], // uncategorized: a job for the AI later
  [savings, "Other Income", 1, 4210, "Interest"],
];

for (const [account, category, days, cents, description] of transactions) {
  addTransaction.run(
    account,
    category ? categoryId(category) : null,
    daysAgo(days),
    cents,
    description,
  );
}

addBudget.run(categoryId("Groceries"), 40000);
addBudget.run(categoryId("Dining Out"), 20000);
addBudget.run(categoryId("Transport"), 15000);

db.exec("COMMIT");
console.log(`Demo database created at ${DEMO_PATH}`);
