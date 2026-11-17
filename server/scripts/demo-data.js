/**
 * Six months of realistic, Canadian demo data, generated from rules
 * ("rent on the 1st", "groceries every Saturday") applied day by day.
 *
 * generateDemoData() is PURE: it returns plain data and touches nothing,
 * so it's easy to test. writeDemoData() puts that data into a database.
 *
 * Dates are relative to `today`, so the demo always looks current; the
 * seeded random generator makes the same `today` give the same data.
 * Merchant names match samples/*.csv where they overlap, so importing a
 * sample file is categorized from history.
 */
import { createRandom } from "./random.js";
import { createTransfer } from "../src/transfers.js";

const MONTHS_BACK = 6; // full months before the current one
const SEED = 2026;

// ------------------------------------------------------------ date helpers
// Work in UTC on 'YYYY-MM-DD' strings so time zones can't shift a day.
const parse = (iso) => new Date(`${iso}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const monthIndex = (d) => d.getUTCFullYear() * 12 + d.getUTCMonth();

// ------------------------------------------------------------ merchants
const GROCERS = ["NO FRILLS #3329 TORONTO", "LOBLAWS #0877", "FRESHCO 0412"];
const DINNERS = [
  "PAI NORTHERN THAI",
  "BURGER PRIEST",
  "PIZZERIA LIBRETTO",
  "KINKA IZAKAYA",
  "SALAD KING",
  "BANH MI BOYS",
  "THE KEG STEAKHOUSE",
  "FIVE GUYS #0412",
];
const LUNCHES = ["SUBWAY 22140", "FRESHII", "BANH MI BOYS", "A&W #1150"];
const SHOPS = ["WINNERS #0233, TORONTO", "INDIGO #0117", "CANADIAN TIRE #0291"];
const AMAZON_CODES = [
  "8GB9FDB",
  "AYTT63H",
  "2K4QX7",
  "M31ZP0",
  "QW8E2R",
  "7X1LKD",
];

// Things the AI gets to categorize, N days ago (always inside the range).
const UNCATEGORIZED = [
  [2, -1899, "SQ *CORNER BAKERY"],
  [5, -4250, "PAYPAL *STEAMGAMES"],
  [9, -2675, "LS NORTHERN RESERVE"],
  [13, -1150, "SQ *DAILY GRIND CAFE"],
];

/**
 * @param today  'YYYY-MM-DD' (the user's local day); data runs up to yesterday
 * @returns { accounts, transactions, transfers, budgets }
 *   accounts:     [{ key, name, type }]
 *   transactions: [{ account, category, date, amount_cents, description }]
 *                 category = name, or null for uncategorized
 *   transfers:    [{ from, to, date, amount_cents, description }]
 *   budgets:      [{ category, monthly_limit_cents }]
 */
export function generateDemoData({ today, seed = SEED }) {
  const rand = createRandom(seed);
  const end = parse(today);
  const thisMonth = monthIndex(end);
  const start = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - MONTHS_BACK, 1),
  );

  const accounts = [
    { key: "chequing", name: "Everyday Chequing", type: "checking" },
    { key: "savings", name: "High-Interest Savings", type: "savings" },
    { key: "visa", name: "Visa", type: "credit_card" },
    { key: "cash", name: "Wallet", type: "cash" },
  ];
  const transactions = [];
  const transfers = [];
  const add = (account, category, date, amount_cents, description) =>
    transactions.push({ account, category, date, amount_cents, description });

  const opened = iso(start);
  add("chequing", "Opening balance", opened, 320000, "Opening balance");
  add("savings", "Opening balance", opened, 1200000, "Opening balance");
  add("cash", "Opening balance", opened, 15000, "Opening balance");
  // Track the wallet so we never spend cash that isn't there.
  let wallet = 15000;
  const spendCash = (category, date, cents, description) => {
    if (wallet < cents) return false;
    wallet -= cents;
    add("cash", category, date, -cents, description);
    return true;
  };

  // The story, by months before this one. Multiplies discretionary spending.
  //   4 months ago: a new laptop.  2 months ago: dining out gets away from you.
  //   Last month: a careful month, under every budget.
  //   This month: eating out a bit more again.
  const mood = (ago) =>
    ago === 2
      ? { dining: 1.6, fun: 1, food: 1 }
      : ago === 1
        ? { dining: 0.65, fun: 0.5, food: 0.85 }
        : ago === 0
          ? { dining: 1.3, fun: 1, food: 1 }
          : { dining: 1, fun: 1, food: 1 };

  const visaSpentByMonth = new Map(); // month index → cents spent on the Visa
  let payWeek = 0; // payday every second Friday

  for (let d = start; d < end; d = addDays(d, 1)) {
    const date = iso(d);
    const day = d.getUTCDate();
    const weekday = d.getUTCDay(); // 0 = Sunday
    const ago = thisMonth - monthIndex(d);
    const { dining, fun, food } = mood(ago);
    const visa = (category, cents, description) => {
      add("visa", category, date, -cents, description);
      const m = monthIndex(d);
      visaSpentByMonth.set(m, (visaSpentByMonth.get(m) ?? 0) + cents);
    };

    // --- income
    if (weekday === 5 && payWeek++ % 2 === 0) {
      add("chequing", "Salary", date, 245000, "ACME CORP PAYROLL DEP");
    }
    const lastDay = addDays(d, 1).getUTCDate() === 1;
    if (lastDay)
      add("savings", "Other Income", date, rand.int(3900, 4300), "Interest");
    if (day === 17 && ago % 3 === 1) {
      add(
        "chequing",
        "Other Income",
        date,
        4500,
        "E-TRANSFER RECEIVED P SINGH",
      );
    }

    // --- bills (chequing)
    if (day === 1)
      add("chequing", "Rent", date, -165000, "E-TRANSFER SENT RENT J MORALES");
    if (day === 8)
      add(
        "chequing",
        "Utilities",
        date,
        -rand.int(8800, 13200),
        "HYDRO ONE NETWORKS PRE-AUTH",
      );
    if (day === 12)
      add(
        "chequing",
        "Utilities",
        date,
        -rand.int(3800, 9200),
        "ENBRIDGE GAS DISTRIBUTION",
      );
    if (day === 18)
      add("chequing", "Utilities", date, -8500, "ROGERS WIRELESS PAP");
    if (day === 20)
      add("chequing", "Utilities", date, -7500, "BELL CANADA INTERNET PAP");
    if (day === 1 || day === 15)
      add("chequing", "Transport", date, -4000, "PRESTO AUTOLOAD/TORONTO");

    // --- subscriptions (Visa)
    if (day === 3) visa("Entertainment", 1899, "NETFLIX.COM 866-579-7172 ON");
    if (day === 14) visa("Entertainment", 1299, "SPOTIFY P2F9A7C1D3");

    // --- groceries: the big Saturday shop, sometimes a midweek top-up
    if (weekday === 6) {
      visa(
        "Groceries",
        Math.round(rand.int(7000, 13500) * food),
        rand.pick(GROCERS),
      );
    }
    if (weekday === 0 && rand.chance(0.4)) {
      spendCash(
        "Groceries",
        date,
        rand.int(1200, 2800),
        "Farmers market (cash)",
      ); // skipped if short
    }
    if (weekday === 3 && rand.chance(0.5)) {
      visa("Groceries", rand.int(1500, 4000), rand.pick(GROCERS));
    }

    // --- coffee on weekdays; one in three paid in cash
    if (weekday >= 1 && weekday <= 5 && rand.chance(0.45)) {
      const cents = rand.int(215, 650);
      const paidCash =
        rand.chance(1 / 3) &&
        spendCash("Dining Out", date, cents, "Tim Hortons (cash)");
      if (!paidCash)
        visa(
          "Dining Out",
          cents,
          `TIM HORTONS #${rand.pick(["2210", "4521", "1150"])}`,
        );
    }

    // --- eating out: weekend dinners, the odd weekday lunch
    if (
      (weekday === 5 || weekday === 6) &&
      rand.chance(Math.min(0.95, 0.55 * dining))
    ) {
      visa(
        "Dining Out",
        Math.round(rand.int(2800, 7500) * Math.max(1, dining * 0.9)),
        rand.pick(DINNERS),
      );
    }
    if (weekday >= 1 && weekday <= 5 && rand.chance(0.12 * dining)) {
      visa("Dining Out", rand.int(1200, 2200), rand.pick(LUNCHES));
    }

    // --- getting around
    if (rand.chance(0.05 * fun))
      visa("Transport", rand.int(1400, 3200), "UBER CANADA/UBERTRIP TORONTO");

    // --- shopping, fun, health
    if (rand.chance(0.05 * fun)) {
      visa(
        "Shopping",
        rand.int(1500, 6500),
        `AMZN MKTP CA*${rand.pick(AMAZON_CODES)}`,
      );
    }
    if (rand.chance(0.04 * fun))
      visa("Shopping", rand.int(2500, 9000), rand.pick(SHOPS));
    if (weekday === 6 && rand.chance(0.25 * fun)) {
      visa(
        "Entertainment",
        rand.int(2400, 3600),
        "CINEPLEX ENTERTAINMENT, TORONTO",
      );
    }
    if (rand.chance(0.03))
      visa("Health", rand.int(900, 4200), "SHOPPERS DRUG MART #1150");

    // --- one-offs that make the story
    if (ago === 4 && day === 10)
      visa("Shopping", 149999, "APPLE STORE #R121 TORONTO");
    if (ago === 3 && day === 21) visa("Health", 18000, "DR. LEE DENTAL");
    if (ago === 3 && day === 24)
      add("visa", null, date, 2599, "AMZN MKTP CA RETURN");
    if (ago === 1 && day === 9)
      add("visa", null, date, 1299, "NO FRILLS #3329 REFUND");

    // --- transfers between your own accounts
    if (day === 2) {
      transfers.push({
        from: "chequing",
        to: "savings",
        date,
        amount_cents: 50000,
        description: "Monthly savings",
      });
    }
    if (day === 5) {
      transfers.push({
        from: "chequing",
        to: "cash",
        date,
        amount_cents: 5000,
        description: "ATM withdrawal",
      });
      wallet += 5000;
    }
    if (day === 22) {
      // Pay off last month's Visa spending in full.
      const owed = visaSpentByMonth.get(monthIndex(d) - 1) ?? 0;
      if (owed > 0) {
        transfers.push({
          from: "chequing",
          to: "visa",
          date,
          amount_cents: owed,
          description: "Visa payment",
        });
      }
    }
  }

  for (const [daysAgo, cents, description] of UNCATEGORIZED) {
    add("visa", null, iso(addDays(end, -daysAgo)), cents, description);
  }

  const budgets = [
    { category: "Groceries", monthly_limit_cents: 60000 },
    { category: "Dining Out", monthly_limit_cents: 42500 },
    { category: "Transport", monthly_limit_cents: 17500 },
    { category: "Shopping", monthly_limit_cents: 25000 },
    { category: "Entertainment", monthly_limit_cents: 10000 },
  ];

  transactions.sort((a, b) => a.date.localeCompare(b.date));
  return { accounts, transactions, transfers, budgets };
}

/**
 * Write generated data into an (empty) database. Normal transactions go in
 * one database transaction; each transfer goes through createTransfer(), so
 * the app's own rules link the two halves.
 */
export function writeDemoData(
  db,
  { accounts, transactions, transfers, budgets },
) {
  const categoryId = (name) => {
    const row = db
      .prepare("SELECT id FROM categories WHERE name = ?")
      .get(name);
    if (!row) throw new Error(`Unknown category: ${name}`);
    return row.id;
  };
  const ids = {};

  db.exec("BEGIN");
  try {
    const addAccount = db.prepare(
      "INSERT INTO accounts (name, type) VALUES (?, ?)",
    );
    for (const a of accounts)
      ids[a.key] = Number(addAccount.run(a.name, a.type).lastInsertRowid);

    const addTx = db.prepare(
      `INSERT INTO transactions (account_id, category_id, date, amount_cents, description)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const t of transactions) {
      addTx.run(
        ids[t.account],
        t.category ? categoryId(t.category) : null,
        t.date,
        t.amount_cents,
        t.description,
      );
    }

    const addBudget = db.prepare(
      "INSERT INTO budgets (category_id, monthly_limit_cents) VALUES (?, ?)",
    );
    for (const b of budgets)
      addBudget.run(categoryId(b.category), b.monthly_limit_cents);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  // createTransfer() runs its own BEGIN/COMMIT, which SQLite can't nest.
  for (const t of transfers) {
    createTransfer(db, {
      from_account_id: ids[t.from],
      to_account_id: ids[t.to],
      amount_cents: t.amount_cents,
      date: t.date,
      description: t.description,
    });
  }
}
