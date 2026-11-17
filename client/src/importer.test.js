import { describe, it, expect } from "vitest";
import {
  normalizeMerchant,
  groupByMerchant,
  initialChoices,
  buildImportRows,
  aiStatusNote,
  importSummary,
  acceptAll,
  handledRows,
} from "./importer.js";

const tx = (description, amount_cents, date = "2026-11-09") => ({
  date,
  description,
  amount_cents,
});

const TRANSACTIONS = [
  tx("TIM HORTONS #4521 TORONTO ON", -425), // 0
  tx("NO FRILLS #33", -6731), // 1
  tx("TIM HORTONS #0877 TORONTO ON", -310), // 2 same merchant as 0
  tx("ACME PAYROLL", 412500), // 3 income
  tx("#1234", -100), // 4 nothing to group on
  tx("#5678", -200), // 5 nothing to group on
  tx("Tim Hortons #9 Toronto ON", -365), // 6 same merchant as 0
];

describe("normalizeMerchant (matches the server's)", () => {
  it.each([
    ["TIM HORTONS #4521 TORONTO ON", "tim hortons toronto on"],
    ["UBER *EATS", "uber eats"],
    ["#1234", ""],
  ])("%s → %j", (input, expected) => {
    expect(normalizeMerchant(input)).toBe(expected);
  });
});

describe("groupByMerchant", () => {
  const groups = groupByMerchant(TRANSACTIONS);

  it("groups store numbers and letter case together, most frequent first", () => {
    expect(groups[0]).toEqual({
      key: "expense|tim hortons toronto on",
      kind: "expense",
      label: "TIM HORTONS #4521 TORONTO ON", // first one seen
      count: 3,
      totalCents: -1100,
      indexes: [0, 2, 6],
    });
  });

  it("keeps expenses and income apart, and ungroupable rows on their own", () => {
    expect(groups).toHaveLength(5);
    expect(groups.find((g) => g.label === "ACME PAYROLL").kind).toBe("income");
    const lonely = groups.filter((g) => g.label.startsWith("#"));
    expect(lonely.map((g) => g.count)).toEqual([1, 1]);
  });

  it("returns no groups for no transactions", () => {
    expect(groupByMerchant([])).toEqual([]);
  });
});

describe("initialChoices", () => {
  const groups = groupByMerchant(TRANSACTIONS);
  const dining = { id: 4, name: "Dining Out" };

  it("takes the first suggestion in each group, with its source", () => {
    const suggestions = TRANSACTIONS.map(() => ({
      category: null,
      source: null,
    }));
    suggestions[2] = { category: dining, source: "ai" }; // not the first row of its group
    suggestions[3] = { category: { id: 1, name: "Salary" }, source: "history" };

    const choices = initialChoices(groups, suggestions);
    expect(choices["expense|tim hortons toronto on"]).toEqual({
      categoryId: "4",
      source: "ai",
    });
    expect(choices["income|acme payroll"]).toEqual({
      categoryId: "1",
      source: "history",
    });
    expect(choices["expense|no frills"]).toEqual({
      categoryId: "",
      source: null,
    });
  });

  it("works with no suggestions at all (categorization failed)", () => {
    const choices = initialChoices(groups);
    expect(Object.values(choices).every((c) => c.categoryId === "")).toBe(true);
  });
});

describe("buildImportRows", () => {
  it("gives every row its group's category, in file order", () => {
    const groups = groupByMerchant(TRANSACTIONS);
    const choices = initialChoices(groups);
    choices["expense|tim hortons toronto on"] = {
      categoryId: "4",
      source: null,
    };

    const rows = buildImportRows(TRANSACTIONS, groups, choices);
    expect(rows.map((r) => r.category_id)).toEqual([
      4,
      null,
      4,
      null,
      null,
      null,
      4,
    ]);
    expect(rows[0]).toEqual({
      date: "2026-11-09",
      description: "TIM HORTONS #4521 TORONTO ON",
      amount_cents: -425,
      category_id: 4,
    });
  });
});

describe("aiStatusNote", () => {
  it.each([
    ["used", null],
    ["not_needed", null],
    ["unavailable", /AI isn't set up/],
    ["partial", /Some suggestions/],
    ["failed", /Couldn't reach the AI/],
    ["limited", /demo's AI limit/],
  ])("%s", (status, expected) => {
    const note = aiStatusNote(status);
    if (expected === null) expect(note).toBeNull();
    else expect(note).toMatch(expected);
  });
});

describe("importSummary", () => {
  it.each([
    [
      { imported: 237, skipped_duplicates: 12 },
      "Imported 237 transactions · 12 duplicates skipped",
    ],
    [
      { imported: 1, skipped_duplicates: 1 },
      "Imported 1 transaction · 1 duplicate skipped",
    ],
    [{ imported: 5, skipped_duplicates: 0 }, "Imported 5 transactions"],
    [
      { imported: 0, skipped_duplicates: 3 },
      "Imported 0 transactions · 3 duplicates skipped",
    ],
  ])("%j → %s", (result, expected) => {
    expect(importSummary(result)).toBe(expected);
  });
});

describe("transfer matches in the import", () => {
  const txs = [
    tx("PAYMENT - THANK YOU", 60000, "2026-10-16"), // 0: pairs with chequing
    tx("UBER *EATS", -3150, "2026-10-16"), // 1: ordinary
    tx("PAYMENT", 25000, "2026-10-20"), // 2: already recorded as a transfer
  ];
  const matches = [
    { row: 0, type: "pair", transaction: { id: 41, account_name: "Chequing" } },
    { row: 2, type: "already_transfer", transfer_id: 7 },
  ];
  const groups = groupByMerchant(txs);
  const choices = initialChoices(groups);
  choices["expense|uber eats"] = { categoryId: "4", source: "ai" };

  it("starts with every match ticked", () => {
    expect(acceptAll(matches)).toEqual({ 0: true, 2: true });
    expect(acceptAll()).toEqual({});
  });

  it("knows which rows the ticked matches handle", () => {
    expect([...handledRows(matches, { 0: true, 2: true })]).toEqual([0, 2]);
    expect([...handledRows(matches, { 0: true, 2: false })]).toEqual([0]);
  });

  it("links pairs, skips already-recorded rows, keeps the rest", () => {
    const rows = buildImportRows(txs, groups, choices, {
      matches,
      accepted: { 0: true, 2: true },
    });
    expect(rows).toEqual([
      {
        date: "2026-10-16",
        description: "PAYMENT - THANK YOU",
        amount_cents: 60000,
        category_id: null,
        link_transaction_id: 41,
      },
      {
        date: "2026-10-16",
        description: "UBER *EATS",
        amount_cents: -3150,
        category_id: 4,
      },
    ]);
  });

  it("imports an unticked match as an ordinary row", () => {
    const rows = buildImportRows(txs, groups, choices, {
      matches,
      accepted: { 0: false, 2: false },
    });
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => "link_transaction_id" in r)).toBe(false);
  });

  it("mentions linked transfers in the summary", () => {
    expect(
      importSummary({
        imported: 12,
        skipped_duplicates: 1,
        linked_transfers: 1,
      }),
    ).toBe(
      "Imported 12 transactions · 1 transfer linked · 1 duplicate skipped",
    );
  });
});
