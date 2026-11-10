import { Router } from "express";
import { parseId } from "../validation.js";

const KINDS = ["expense", "income"];

export function categoriesRouter(db) {
  const router = Router();

  const listCategories = db.prepare(
    "SELECT id, name, kind FROM categories ORDER BY kind, name",
  );
  const getCategory = db.prepare(
    "SELECT id, name, kind FROM categories WHERE id = ?",
  );
  // The name column is COLLATE NOCASE, so this also finds 'groceries' when 'Groceries' exists.
  const findByName = db.prepare("SELECT id FROM categories WHERE name = ?");
  const insertCategory = db.prepare(
    "INSERT INTO categories (name, kind) VALUES (?, ?)",
  );

  // GET /api/categories → all categories (expense first, then income, alphabetical)
  router.get("/", (req, res) => {
    res.json(listCategories.all());
  });

  // POST /api/categories → create a category
  router.post("/", (req, res) => {
    const { name, kind } = req.body ?? {};
    const errors = [];
    if (typeof name !== "string" || name.trim() === "") {
      errors.push("name is required");
    }
    if (!KINDS.includes(kind)) {
      errors.push(`kind must be one of: ${KINDS.join(", ")}`);
    }
    if (errors.length > 0) return res.status(400).json({ errors });

    // 409 Conflict: the request is valid, but clashes with something that already exists.
    // (The UNIQUE rule in the database is still the backstop, defense in depth.)
    const trimmed = name.trim();
    if (findByName.get(trimmed)) {
      return res
        .status(409)
        .json({ error: `A category named "${trimmed}" already exists` });
    }

    const { lastInsertRowid } = insertCategory.run(trimmed, kind);
    res.status(201).json(getCategory.get(lastInsertRowid));
  });

  // DELETE /api/categories/:id → 🏋️ YOUR EXERCISE

  return router;
}
