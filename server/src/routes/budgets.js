import { Router } from "express";
import { parseId } from "../validation.js";
import { currentMonth } from "../dates.js";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/; // 'YYYY-MM', months 01–12

/**
 * First and last possible day of a month, as strings. '-31' works for every
 * month because ISO dates compare correctly as text: '2026-11-31' is after
 * every real November date and before '2026-12-01'.
 */
const monthRange = (month) => [`${month}-01`, `${month}-31`];

export function budgetsRouter(db) {
  const router = Router();

  // Each budget plus how much was spent in a date range.
  //
  // ⚠️ The date filter is in the LEFT JOIN's ON clause, NOT in a WHERE.
  // A WHERE runs after the join and would throw away budgets with no
  // spending this month, which is the same trap as the accounts LEFT JOIN.
  //
  // Expenses are negative, so "spent" is the NEGATIVE of the sum.
  const selectBudgets = `
    SELECT b.category_id,
           c.name AS category_name,
           b.monthly_limit_cents,
           COALESCE(-SUM(t.amount_cents), 0) AS spent_cents,
           b.monthly_limit_cents - COALESCE(-SUM(t.amount_cents), 0) AS remaining_cents
    FROM budgets b
    JOIN categories c ON c.id = b.category_id
    LEFT JOIN transactions t
      ON t.category_id = b.category_id
     AND t.date BETWEEN ? AND ?`;

  const listBudgets = db.prepare(
    `${selectBudgets} GROUP BY b.category_id ORDER BY c.name`,
  );
  const getBudget = db.prepare(
    `${selectBudgets} WHERE b.category_id = ? GROUP BY b.category_id`,
  );
  const getCategory = db.prepare(
    "SELECT id, kind FROM categories WHERE id = ?",
  );

  // Upsert: insert, or, if this category already has a budget, update it.
  // "excluded" means "the row we tried to insert".
  const upsertBudget = db.prepare(`
    INSERT INTO budgets (category_id, monthly_limit_cents) VALUES (?, ?)
    ON CONFLICT (category_id)
    DO UPDATE SET monthly_limit_cents = excluded.monthly_limit_cents`);

  // GET /api/budgets?month=2026-11 → budgets with spending (defaults to this month)
  router.get("/", (req, res) => {
    const month = req.query.month ?? currentMonth();
    if (!MONTH_PATTERN.test(month)) {
      return res
        .status(400)
        .json({ errors: ["month must be in YYYY-MM format"] });
    }
    res.json(listBudgets.all(...monthRange(month)));
  });

  // PUT /api/budgets/:categoryId → set a category's budget (create or update)
  router.put("/:categoryId", (req, res) => {
    const categoryId = parseId(req.params.categoryId);
    const category =
      categoryId === null ? undefined : getCategory.get(categoryId);
    if (!category) return res.status(404).json({ error: "Category not found" });

    const errors = [];
    if (category.kind !== "expense") {
      errors.push("budgets can only be set on expense categories");
    }
    const limit = req.body?.monthly_limit_cents;
    if (!Number.isInteger(limit) || limit <= 0) {
      errors.push(
        "monthly_limit_cents must be a positive whole number of cents",
      );
    }
    if (errors.length > 0) return res.status(400).json({ errors });

    upsertBudget.run(categoryId, limit);
    res.json(getBudget.get(...monthRange(currentMonth()), categoryId));
  });

  router.delete("/:categoryId", (req, res) => {
    let category = parseId(req.params.categoryId);
    if (!category) return res.status(404).json({ error: "Budget not found" });
    const result = db
      .prepare("DELETE  from budgets where category_id = ?")
      .run(category);
    if (result.changes === 0)
      return res.status(404).json({ error: "Budget not found" });
    res.status(204).end();
  });

  return router;
}
