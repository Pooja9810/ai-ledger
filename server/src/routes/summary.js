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

  // Spending per category (same definition: expense + uncategorized money out).
  const byCategory = db.prepare(`
    SELECT COALESCE(c.name, 'Uncategorized') AS category,
           -SUM(t.amount_cents) AS cents
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.date BETWEEN ? AND ?
      AND (c.kind = 'expense' OR (t.category_id IS NULL AND t.amount_cents < 0))
    GROUP BY c.id
    HAVING cents > 0
    ORDER BY cents DESC, category`);

  const firstDate = db.prepare(`
    SELECT MIN(t.date) AS first FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE c.kind IS NULL OR c.kind <> 'transfer'`);

  // GET /api/summary/home?month=2026-11&today=2026-11-17
  // Everything the Home screen's charts draw, computed here (the browser
  // only draws): spending by category, a 6-month trend, and a comparison
  // with last month. A month in progress is compared with the SAME days of
  // last month (Nov 1–17 vs Oct 1–17), like the monthly insights.
  router.get("/home", (req, res) => {
    const month = req.query.month ?? currentMonth();
    const today = req.query.today ?? todayLocal();
    if (!MONTH_PATTERN.test(month) || !DATE_PATTERN.test(today)) {
      return res.status(400).json({
        errors: ["month must be YYYY-MM and today must be YYYY-MM-DD"],
      });
    }

    const [start, end] = monthRange(month);
    const spending = (from, to) => monthTotals.get(from, to).spending_cents;

    // Comparison window in the previous month.
    const prev = shiftMonth(month, -1);
    const inProgress = today.slice(0, 7) === month;
    const lastDay = inProgress
      ? Math.min(Number(today.slice(8)), daysInMonth(prev))
      : daysInMonth(prev);
    const prevEnd = `${prev}-${String(lastDay).padStart(2, "0")}`;
    const now = spending(start, end);
    const before = spending(`${prev}-01`, prevEnd);

    // Six months ending with this one, skipping months before the ledger began.
    const first = firstDate.get().first;
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const m = shiftMonth(month, -i);
      if (first && `${m}-31` < first) continue;
      trend.push({ month: m, spending_cents: spending(...monthRange(m)) });
    }

    res.json({
      month,
      spending_cents: now,
      income_cents: monthTotals.get(start, end).income_cents,
      by_category: byCategory.all(start, end),
      trend,
      compare: {
        from: `${prev}-01`,
        to: prevEnd,
        same_days: inProgress,
        before_cents: before,
        // One decimal, rounded half up, from integers: (now − before) / before.
        change_percent:
          before === 0
            ? null
            : Math.round(((now - before) * 1000) / before) / 10,
      },
    });
  });

  return router;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const todayLocal = () => new Date().toLocaleDateString("en-CA");

/** '2026-01' shifted by -1 → '2025-12' */
function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const daysInMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
