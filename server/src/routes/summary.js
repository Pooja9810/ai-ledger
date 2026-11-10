import { Router } from "express";
import { currentMonth, MONTH_PATTERN, monthRange } from "../dates.js";

export function summaryRouter(db) {
  const router = Router();

  // Income  = money in, from INCOME categories only. 'transfer' categories
  //           (opening balances) never count, and uncategorized money-in
  //           (e.g. a refund) isn't assumed to be income.
  // Spending = money out, from expense categories AND uncategorized negatives
  //           (unsorted spending is still spending). Returned as a positive number.
  const monthTotals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN c.kind = 'income' THEN t.amount_cents END), 0)
        AS income_cents,
      COALESCE(-SUM(CASE
        WHEN c.kind = 'expense' THEN t.amount_cents
        WHEN t.category_id IS NULL AND t.amount_cents < 0 THEN t.amount_cents
      END), 0) AS spending_cents
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date BETWEEN ? AND ?`);

  const netWorth = db.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) AS net_worth_cents FROM transactions",
  );

  // GET /api/summary?month=2026-11 → headline numbers (defaults to this month)
  router.get("/", (req, res) => {
    const month = req.query.month ?? currentMonth();
    if (!MONTH_PATTERN.test(month)) {
      return res
        .status(400)
        .json({ errors: ["month must be in YYYY-MM format"] });
    }
    const { income_cents, spending_cents } = monthTotals.get(
      ...monthRange(month),
    );
    res.json({
      month,
      income_cents,
      spending_cents,
      net_cents: income_cents - spending_cents,
      net_worth_cents: netWorth.get().net_worth_cents,
    });
  });

  return router;
}
