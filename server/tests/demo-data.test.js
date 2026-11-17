import { describe, it, expect } from "vitest";
import { openDatabase } from "../src/db/index.js";
import { generateDemoData, writeDemoData } from "../scripts/demo-data.js";

const TODAY = "2026-11-16";
const monthIndex = (iso) => +iso.slice(0, 4) * 12 + +iso.slice(5, 7) - 1;

/** Every day of a year: the demo is generated on whatever day someone seeds it. */
const EVERY_DAY = Array.from({ length: 365 }, (_, i) =>
  new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10),
);

/** Spending per "months ago|category" for the budgeted categories. */
function spendingByMonth(data, today) {
  const budgeted = new Set(data.budgets.map((b) => b.category));
  const spent = {};
  for (const t of data.transactions) {
    if (!budgeted.has(t.category)) continue;
    const key = `${monthIndex(today) - monthIndex(t.date)}|${t.category}`;
    spent[key] = (spent[key] ?? 0) - t.amount_cents;
  }
  return spent;
}

/** Lowest running balance of each account, in date order. */
function lowestBalances(data) {
  const events = [
    ...data.transactions.map((t) => [t.date, t.account, t.amount_cents]),
    ...data.transfers.flatMap((t) => [
      [t.date, t.from, -t.amount_cents],
      [t.date, t.to, t.amount_cents],
    ]),
  ].sort((a, b) => a[0].localeCompare(b[0]));
  const balance = {};
  const lowest = {};
  for (const [, account, cents] of events) {
    balance[account] = (balance[account] ?? 0) + cents;
    lowest[account] = Math.min(lowest[account] ?? 0, balance[account]);
  }
  return lowest;
}

describe("generateDemoData", () => {
  it("gives the same data for the same day", () => {
    expect(generateDemoData({ today: TODAY })).toEqual(
      generateDemoData({ today: TODAY }),
    );
  });

  it("covers six full months plus this month, up to yesterday", () => {
    const { transactions } = generateDemoData({ today: TODAY });
    const dates = transactions.map((t) => t.date).sort();
    expect(dates[0]).toBe("2026-05-01");
    expect(dates.at(-1) < TODAY).toBe(true);
    expect(transactions.length).toBeGreaterThan(250);
  });

  it("leaves a few transactions uncategorized for the AI", () => {
    const { transactions } = generateDemoData({ today: TODAY });
    const uncategorized = transactions.filter((t) => t.category === null);
    expect(uncategorized.length).toBeGreaterThanOrEqual(4);
  });

  it.each(EVERY_DAY.filter((_, i) => i % 30 === 0))(
    "pays the Visa off monthly with positive transfers (%s)",
    (today) => {
      const { transfers } = generateDemoData({ today });
      expect(transfers.every((t) => t.amount_cents > 0)).toBe(true);
      expect(transfers.some((t) => t.description === "Visa payment")).toBe(
        true,
      );
    },
  );

  it("never overdraws chequing or the wallet, whatever day it's seeded", () => {
    for (const today of EVERY_DAY) {
      const lowest = lowestBalances(generateDemoData({ today }));
      expect({ today, chequing: lowest.chequing >= 0 }).toEqual({
        today,
        chequing: true,
      });
      expect({ today, cash: lowest.cash >= 0 }).toEqual({ today, cash: true });
    }
  });

  it("tells its story, whatever day it's seeded", () => {
    for (const today of EVERY_DAY) {
      const data = generateDemoData({ today });
      const limit = Object.fromEntries(
        data.budgets.map((b) => [b.category, b.monthly_limit_cents]),
      );
      const spent = spendingByMonth(data, today);

      // Last month: careful, under every budget.
      for (const category of Object.keys(limit)) {
        expect({
          today,
          category,
          under: (spent[`1|${category}`] ?? 0) <= limit[category],
        }).toEqual({ today, category, under: true });
      }
      // Two months ago: dining out got away from you.
      expect({
        today,
        over: spent["2|Dining Out"] > limit["Dining Out"],
      }).toEqual({
        today,
        over: true,
      });
      // Four months ago: the laptop makes it the biggest shopping month.
      const shopping = [1, 2, 3, 4, 5, 6].map(
        (ago) => spent[`${ago}|Shopping`] ?? 0,
      );
      expect({ today, max: Math.max(...shopping) === shopping[3] }).toEqual({
        today,
        max: true,
      });
    }
  });
});

describe("writeDemoData", () => {
  const db = openDatabase(":memory:");
  const data = generateDemoData({ today: TODAY });
  writeDemoData(db, data);

  it("writes every transaction, plus two halves per transfer", () => {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM transactions").get();
    expect(n).toBe(data.transactions.length + 2 * data.transfers.length);
  });

  it("links each transfer's two halves, which cancel out", () => {
    const rows = db
      .prepare(
        `SELECT transfer_id, COUNT(*) AS legs, SUM(amount_cents) AS total
         FROM transactions WHERE transfer_id IS NOT NULL GROUP BY transfer_id`,
      )
      .all();
    expect(rows).toHaveLength(data.transfers.length);
    expect(rows.every((r) => r.legs === 2 && r.total === 0)).toBe(true);
  });

  it("matches the generated balances", () => {
    const balances = Object.fromEntries(
      db
        .prepare(
          `SELECT a.name, SUM(t.amount_cents) AS cents
           FROM accounts a JOIN transactions t ON t.account_id = a.id GROUP BY a.id`,
        )
        .all()
        .map((r) => [r.name, r.cents]),
    );
    const expected = (key) =>
      data.transactions
        .filter((t) => t.account === key)
        .reduce((s, t) => s + t.amount_cents, 0) +
      data.transfers.reduce(
        (s, t) =>
          s +
          (t.to === key ? t.amount_cents : 0) -
          (t.from === key ? t.amount_cents : 0),
        0,
      );
    expect(balances["Everyday Chequing"]).toBe(expected("chequing"));
    expect(balances["Visa"]).toBe(expected("visa"));
    expect(balances["Wallet"]).toBe(expected("cash"));
  });

  it("creates the five budgets", () => {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM budgets").get();
    expect(n).toBe(5);
  });
});
