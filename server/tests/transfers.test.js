import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";
import { createLedgerTools } from "../src/ai/ledger-tools.js";

describe("/api/transfers", () => {
  let db;
  let app;
  let chequing;
  let visa;
  let savings;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    app = createApp(db);
    const account = async (name, type, opening) =>
      (
        await request(app)
          .post("/api/accounts")
          .send({ name, type, opening_balance_cents: opening })
      ).body.id;
    chequing = await account("Chequing", "checking", 300000); // $3,000
    visa = await account("Visa", "credit_card", -80000); // owes $800
    savings = await account("Savings", "savings", 0);
  });

  const payVisa = (overrides = {}) =>
    request(app)
      .post("/api/transfers")
      .send({
        from_account_id: chequing,
        to_account_id: visa,
        amount_cents: 60000,
        date: "2026-11-15",
        description: "Visa payment",
        ...overrides,
      });
  const balances = async () =>
    Object.fromEntries(
      (await request(app).get("/api/accounts")).body.map((a) => [
        a.name,
        a.balance_cents,
      ]),
    );
  const legs = () =>
    db
      .prepare(
        "SELECT account_id, amount_cents, transfer_id FROM transactions WHERE transfer_id IS NOT NULL ORDER BY amount_cents",
      )
      .all()
      .map((r) => ({ ...r }));

  describe("POST", () => {
    it("creates the transfer and both halves", async () => {
      const res = await payVisa();
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(Number),
        date: "2026-11-15",
        amount_cents: 60000,
        description: "Visa payment",
        from_account_id: chequing,
        from_account_name: "Chequing",
        to_account_id: visa,
        to_account_name: "Visa",
        transaction_ids: { from: expect.any(Number), to: expect.any(Number) },
      });
      expect(legs()).toEqual([
        {
          account_id: chequing,
          amount_cents: -60000,
          transfer_id: res.body.id,
        },
        { account_id: visa, amount_cents: 60000, transfer_id: res.body.id },
      ]);
    });

    it("moves both balances", async () => {
      await payVisa();
      expect(await balances()).toEqual({
        Chequing: 240000, // 3,000 − 600
        Visa: -20000, // owed 800, paid 600 → owes 200
        Savings: 0,
      });
    });

    it("is NOT spending or income: the whole point", async () => {
      const summary = async () =>
        (await request(app).get("/api/summary?month=2026-11")).body;
      const before = await summary();
      await payVisa();
      const after = await summary();
      expect(after.spending_cents).toBe(before.spending_cents);
      expect(after.income_cents).toBe(before.income_cents);
      expect(after.net_worth_cents).toBe(before.net_worth_cents); // money just moved

      // ...and the AI's tools don't see it as spending either
      const tools = createLedgerTools(db);
      expect(
        tools.run("get_spending_by_category", {
          from: "2026-11-01",
          to: "2026-11-30",
        }).result.total_spent,
      ).toBe("$0.00");
    });

    it("defaults the description to 'Transfer: from → to'", async () => {
      const res = await payVisa({ description: undefined });
      expect(res.body.description).toBe("Transfer: Chequing → Visa");
    });

    it.each([
      [{ to_account_id: undefined }, "to_account_id must be an integer"],
      [{ to_account_id: 999 }, "to_account_id does not exist"],
      [{ to_account_id: "visa" }, "to_account_id must be an integer"],
      [{ amount_cents: -60000 }, /positive whole number/],
      [{ amount_cents: 0 }, /positive whole number/],
      [{ amount_cents: 12.5 }, /positive whole number/],
      [{ date: "2026-02-30" }, /real date/],
      [{ description: 42 }, /description must be text/],
      [{ color: "red" }, "unknown field: color"],
    ])("rejects %j", async (change, message) => {
      const res = await payVisa(change);
      expect(res.status).toBe(400);
      expect(res.body.errors).toContainEqual(
        typeof message === "string" ? message : expect.stringMatching(message),
      );
      expect(legs()).toEqual([]); // nothing half-created
    });

    it("rejects a transfer to the same account", async () => {
      const res = await payVisa({ to_account_id: chequing });
      expect(res.body.errors).toContain(
        "from and to must be different accounts",
      );
    });
  });

  describe("GET", () => {
    it("returns a transfer, or 404", async () => {
      const { body } = await payVisa();
      expect(
        (await request(app).get(`/api/transfers/${body.id}`)).body,
      ).toEqual(body);
      expect((await request(app).get("/api/transfers/999")).status).toBe(404);
      expect((await request(app).get("/api/transfers/abc")).status).toBe(404);
    });
  });

  describe("PATCH keeps both halves in sync", () => {
    it("changes the amount on both halves", async () => {
      const { body } = await payVisa();
      const res = await request(app)
        .patch(`/api/transfers/${body.id}`)
        .send({ amount_cents: 25000 });
      expect(res.body.amount_cents).toBe(25000);
      expect(legs().map((l) => l.amount_cents)).toEqual([-25000, 25000]);
    });

    it("changes accounts, date and description together", async () => {
      const { body } = await payVisa();
      const res = await request(app)
        .patch(`/api/transfers/${body.id}`)
        .send({
          to_account_id: savings,
          date: "2026-11-16",
          description: "Saving",
        });
      expect(res.body).toMatchObject({
        to_account_id: savings,
        to_account_name: "Savings",
        date: "2026-11-16",
        description: "Saving",
      });
      expect(await balances()).toMatchObject({ Visa: -80000, Savings: 60000 });
    });

    it("can swap direction, checking 'different accounts' on the final values", async () => {
      const { body } = await payVisa();
      const swap = await request(app)
        .patch(`/api/transfers/${body.id}`)
        .send({ from_account_id: visa, to_account_id: chequing });
      expect(swap.status).toBe(200);
      const same = await request(app)
        .patch(`/api/transfers/${body.id}`)
        .send({ to_account_id: visa }); // from is now visa too
      expect(same.body.errors).toContain(
        "from and to must be different accounts",
      );
    });

    it("rejects bad changes and empty updates, and 404s unknown transfers", async () => {
      const { body } = await payVisa();
      const bad = await request(app)
        .patch(`/api/transfers/${body.id}`)
        .send({ amount_cents: -1 });
      expect(bad.status).toBe(400);
      const empty = await request(app)
        .patch(`/api/transfers/${body.id}`)
        .send({});
      expect(empty.body.errors).toEqual(["no fields to update"]);
      expect(
        (
          await request(app)
            .patch("/api/transfers/999")
            .send({ date: "2026-11-01" })
        ).status,
      ).toBe(404);
      expect(legs().map((l) => l.amount_cents)).toEqual([-60000, 60000]); // unchanged
    });
  });

  describe("DELETE", () => {
    it("removes both halves and restores the balances", async () => {
      const { body } = await payVisa();
      const res = await request(app).delete(`/api/transfers/${body.id}`);
      expect(res.status).toBe(204);
      expect(legs()).toEqual([]);
      expect(await balances()).toEqual({
        Chequing: 300000,
        Visa: -80000,
        Savings: 0,
      });
      expect(
        (await request(app).delete(`/api/transfers/${body.id}`)).status,
      ).toBe(404);
    });
  });

  describe("guards on /api/transactions", () => {
    it("lists transfer halves with their transfer_id", async () => {
      const { body } = await payVisa();
      const list = (await request(app).get("/api/transactions")).body;
      const halves = list.filter((t) => t.transfer_id === body.id);
      expect(
        halves.map((t) => [t.account_name, t.amount_cents, t.category_name]),
      ).toEqual(
        expect.arrayContaining([
          ["Chequing", -60000, "Account transfer"],
          ["Visa", 60000, "Account transfer"],
        ]),
      );
      expect(list.find((t) => t.transfer_id === null)).toBeDefined(); // opening balances
    });

    it("won't edit or delete one half on its own (409)", async () => {
      const { body } = await payVisa();
      const half = body.transaction_ids.from;
      const edit = await request(app)
        .patch(`/api/transactions/${half}`)
        .send({ amount_cents: -1 });
      const del = await request(app).delete(`/api/transactions/${half}`);
      expect(edit.status).toBe(409);
      expect(edit.body.error).toMatch(`transfer #${body.id}`);
      expect(del.status).toBe(409);
      expect(legs()).toHaveLength(2); // both halves still there, unchanged
    });

    it("won't put an ordinary transaction in a transfer category", async () => {
      const transferCategory = db
        .prepare("SELECT id FROM categories WHERE name = 'Account transfer'")
        .get().id;
      const res = await request(app).post("/api/transactions").send({
        account_id: chequing,
        category_id: transferCategory,
        date: "2026-11-15",
        amount_cents: -100,
      });
      expect(res.status).toBe(400);
      expect(res.body.errors).toContain(
        "transfer categories can't be set directly; use /api/transfers",
      );
    });
  });
});
