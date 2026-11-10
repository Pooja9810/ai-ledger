import express from "express";
import { accountsRouter } from "./routes/accounts.js";
import { transactionsRouter } from "./routes/transactions.js";
import { categoriesRouter } from "./routes/categories.js";

/**
 * Build the Express app. The database is passed in (dependency injection),
 * so tests can use an in-memory DB and the real server can use a file.
 */
export function createApp(db) {
  const app = express();

  // Middleware: runs on every request before the routes.
  // This one parses JSON request bodies into req.body.
  app.use(express.json());

  // Simple "is the server alive?" endpoint, useful for deploys and debugging.
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // Mount routers: everything under /api/accounts goes to accountsRouter.
  app.use("/api/accounts", accountsRouter(db));
  app.use("/api/transactions", transactionsRouter(db));
  app.use("/api/categories", categoriesRouter(db));

  // No route matched → 404.
  app.use((req, res) => res.status(404).json({ error: "Not found" }));

  // Error handler: Express recognizes it by its 4 arguments.
  // Client errors (e.g. malformed JSON → 400) get their message;
  // server errors get a generic message so we never leak internals.
  app.use((err, req, res, next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res
      .status(status)
      .json({ error: status < 500 ? err.message : "Internal server error" });
  });

  return app;
}
