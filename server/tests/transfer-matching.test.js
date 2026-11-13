import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";
import { findTransferMatches } from "../src/transfer-matching.js";

let db;
let app;
let chequing;
let visa;
let savings;

/** Add an ordinary transaction straight into the ledger; returns its id. */
const add = (account_id, date, amount_cents, description) =>
  Number(
    db
      .prepare(
        "INSERT INTO transactions (account_id, date, amount_cents, description) VALUES (?, ?, ?, ?)",
      )
      .run(account_id, date, amount_cents, description).lastInsertRowid,
  );

beforeEach(() => {
  db = openDatabase(":memory:");
  app = createApp(db);
  const account = (name, type) =>
    Number(
      db
        .prepare("INSERT INTO accounts (name, type) VALUES (?, ?)")
        .run(name, type).lastInsertRowid,
    );
  chequing = account("Chequing", "checking");
  visa = account("Visa", "credit_card");
  savings = account("Savings", "savings");
});

const visaPaymentRow = {
  date: "2026-10-16",
  description: "PAYMENT - THANK YOU",
  amount_cents: 60000,
};

describe("findTransferMatches", () => {
  it("pairs a card payment with the chequing side already in the ledger", () => {
    const id = add(chequing, "2026-10-15", -60000, "VISA PAYMENT - THANK YOU");
    expect(
      findTransferMatches(db, { account_id: visa, rows: [visaPaymentRow] }),
    ).toEqual([
      {
        row: 0,
        type: "pair",
        transaction: {
          id,
          account_name: "Chequing",
          date: "2026-10-15",
          description: "VISA PAYMENT - THANK YOU",
          amount_cents: -60000,
        },
      },
    ]);
  });

  it("needs ONE side to read like a transfer (only one does here)", () => {
    add(chequing, "2026-10-15", -60000, "ONLINE BANKING PMT VISA");
    const matches = findTransferMatches(db, {
      account_id: visa,
      rows: [{ ...visaPaymentRow, description: "THANK YOU" }],
    });
    expect(matches).toHaveLength(1);
  });

  it.each([
    ["the same sign", () => add(chequing, "2026-10-15", 60000, "VISA PAYMENT")],
    [
      "a different amount",
      () => add(chequing, "2026-10-15", -59999, "VISA PAYMENT"),
    ],
    [
      "more than 3 days apart",
      () => add(chequing, "2026-10-12", -60000, "VISA PAYMENT"),
    ],
    ["the same account", () => add(visa, "2026-10-15", -60000, "VISA PAYMENT")],
    [
      "no transfer-like words on either side (coincidence)",
      () => add(chequing, "2026-10-15", -60000, "BEST BUY #123"),
    ],
  ])("doesn't match %s", (_label, setup) => {
    setup();
    const row = _label.startsWith("no transfer")
      ? { ...visaPaymentRow, description: "REFUND BEST BUY" }
      : visaPaymentRow;
    expect(findTransferMatches(db, { account_id: visa, rows: [row] })).toEqual(
      [],
    );
  });

  it("ignores transactions that are already transfers or opening balances", () => {
    const opening = db
      .prepare("SELECT id FROM categories WHERE name = 'Opening balance'")
      .get().id;
    db.prepare(
      "INSERT INTO transactions (account_id, category_id, date, amount_cents, description) VALUES (?, ?, '2026-10-15', -60000, 'Opening balance transfer')",
    ).run(chequing, opening);
    expect(
      findTransferMatches(db, { account_id: visa, rows: [visaPaymentRow] }),
    ).toEqual([]);
  });

  it("picks the closest date, and never uses one transaction twice", () => {
    const far = add(chequing, "2026-10-13", -60000, "VISA PAYMENT");
    const near = add(chequing, "2026-10-16", -60000, "VISA PAYMENT");
    const rows = [visaPaymentRow, { ...visaPaymentRow, date: "2026-10-14" }];
    const matches = findTransferMatches(db, { account_id: visa, rows });
    expect(matches.map((m) => [m.row, m.transaction.id])).toEqual([
      [0, near], // Oct 16 ↔ Oct 16
      [1, far], // Oct 14 ↔ Oct 13 (near is taken)
    ]);
  });

  it("spots a row that's already recorded as a transfer (entered by hand)", async () => {
    const { body } = await request(app).post("/api/transfers").send({
      from_account_id: chequing,
      to_account_id: visa,
      amount_cents: 60000,
      date: "2026-10-15",
      description: "Visa payment",
    });
    expect(
      findTransferMatches(db, { account_id: visa, rows: [visaPaymentRow] }),
    ).toEqual([
      {
        row: 0,
        type: "already_transfer",
        transfer_id: body.id,
        date: "2026-10-15",
        description: "Visa payment",
      },
    ]);
  });
});

describe("POST /api/transfers/match", () => {
  it("returns matches for an import", async () => {
    add(chequing, "2026-10-15", -60000, "VISA PAYMENT");
    const res = await request(app)
      .post("/api/transfers/match")
      .send({
        account_id: visa,
        rows: [
          visaPaymentRow,
          { ...visaPaymentRow, amount_cents: -1500, description: "UBER" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.matches.map((m) => [m.row, m.type])).toEqual([[0, "pair"]]);
  });

  it.each([
    [{ rows: [visaPaymentRow] }, /account_id/],
    [{ account_id: 1, rows: "nope" }, /rows must be a list/],
    [
      { account_id: 1, rows: [{ ...visaPaymentRow, date: "10/16/2026" }] },
      /real date/,
    ],
  ])("rejects %j", async (body, message) => {
    const res = await request(app).post("/api/transfers/match").send(body);
    expect(res.status).toBe(400);
    expect(res.body.errors.join(" ")).toMatch(message);
  });
});

describe("linking pairs during import", () => {
  const importRows = (account_id, rows) =>
    request(app).post("/api/transactions/import").send({ account_id, rows });
  const transferCategory = () =>
    db
      .prepare("SELECT id FROM categories WHERE name = 'Account transfer'")
      .get().id;

  it("turns the existing row and the new row into one transfer", async () => {
    const chequingSide = add(chequing, "2026-10-15", -60000, "VISA PAYMENT");
    const res = await importRows(visa, [
      {
        ...visaPaymentRow,
        category_id: null,
        link_transaction_id: chequingSide,
      },
      {
        date: "2026-10-16",
        description: "UBER",
        amount_cents: -1500,
        category_id: null,
      },
    ]);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      imported: 2,
      skipped_duplicates: 0,
      linked_transfers: 1,
    });

    const halves = db
      .prepare(
        "SELECT account_id, amount_cents, category_id, transfer_id FROM transactions WHERE transfer_id IS NOT NULL ORDER BY amount_cents",
      )
      .all()
      .map((r) => ({ ...r }));
    expect(halves).toHaveLength(2);
    expect(halves[0]).toMatchObject({
      account_id: chequing,
      amount_cents: -60000,
      category_id: transferCategory(),
    });
    expect(halves[1]).toMatchObject({
      account_id: visa,
      amount_cents: 60000,
      category_id: transferCategory(),
    });
    expect(halves[0].transfer_id).toBe(halves[1].transfer_id);

    // ...and the API sees it as a normal transfer
    const transfer = await request(app).get(
      `/api/transfers/${halves[0].transfer_id}`,
    );
    expect(transfer.body).toMatchObject({
      from_account_name: "Chequing",
      to_account_name: "Visa",
      amount_cents: 60000,
    });
  });

  it("removes the double count from spending and income", async () => {
    const summary = async () =>
      (await request(app).get("/api/summary?month=2026-10")).body;
    const chequingSide = add(chequing, "2026-10-15", -60000, "VISA PAYMENT");
    const before = await summary(); // the payment counted as spending
    expect(before.spending_cents).toBe(60000);

    await importRows(visa, [
      {
        ...visaPaymentRow,
        category_id: null,
        link_transaction_id: chequingSide,
      },
    ]);
    const after = await summary();
    expect(after.spending_cents).toBe(0);
    expect(after.income_cents).toBe(0);
  });

  it.each([
    ["doesn't exist", () => 9999, /does not exist/],
    [
      "is in the same account",
      () => add(visa, "2026-10-15", -60000, "X"),
      /two different accounts/,
    ],
    [
      "doesn't have the opposite amount",
      () => add(chequing, "2026-10-15", -59999, "X"),
      /opposite amount/,
    ],
  ])(
    "rejects a link that %s, importing nothing",
    async (_label, target, message) => {
      const before =
        db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n + 1; // + the target
      const res = await importRows(visa, [
        { ...visaPaymentRow, category_id: null, link_transaction_id: target() },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.errors.join(" ")).toMatch(message);
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n,
      ).toBeLessThanOrEqual(before);
      expect(db.prepare("SELECT COUNT(*) AS n FROM transfers").get().n).toBe(0);
    },
  );

  it("rejects linking one transaction twice, or one that's already a transfer", async () => {
    const chequingSide = add(chequing, "2026-10-15", -60000, "VISA PAYMENT");
    const twice = await importRows(visa, [
      {
        ...visaPaymentRow,
        category_id: null,
        link_transaction_id: chequingSide,
      },
      {
        ...visaPaymentRow,
        date: "2026-10-17",
        category_id: null,
        link_transaction_id: chequingSide,
      },
    ]);
    expect(twice.body.errors.join(" ")).toMatch(/linked by another row/);

    await importRows(visa, [
      {
        ...visaPaymentRow,
        category_id: null,
        link_transaction_id: chequingSide,
      },
    ]);
    const again = await importRows(savings, [
      {
        ...visaPaymentRow,
        category_id: null,
        link_transaction_id: chequingSide,
      },
    ]);
    expect(again.body.errors.join(" ")).toMatch(/already part of a transfer/);
  });
});
