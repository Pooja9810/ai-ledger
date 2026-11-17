import express from "express";
import compression from "compression";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accountsRouter } from "./routes/accounts.js";
import { transactionsRouter } from "./routes/transactions.js";
import { categoriesRouter } from "./routes/categories.js";
import { budgetsRouter } from "./routes/budgets.js";
import { summaryRouter } from "./routes/summary.js";
import { aiRouter } from "./routes/ai.js";
import { transfersRouter } from "./routes/transfers.js";

/**
 * Build the Express app. The database is passed in (dependency injection),
 * so tests can use an in-memory DB and the real server can use a file.
 * Same for `ai`: the real AI client, a fake in tests, or null (AI disabled).
 * `clientDir`: the built React app (client/dist). When given, this one server
 * serves the whole site, which is how it runs when hosted.
 * `demo`: the public demo (made-up data, reset every hour; see demo.js).
 * `aiLimiter`: middleware that limits AI requests (see rate-limit.js).
 */
export function createApp(
  db,
  { ai = null, clientDir = null, demo = false, aiLimiter = null } = {},
) {
  const app = express();
  // Hosted, requests arrive through the host's proxy: trust its one hop,
  // so req.ip is the visitor's address (the AI limit is per visitor).
  if (demo) app.set("trust proxy", 1);

  // Compress responses (gzip): the app's JavaScript goes from ~315 KB to
  // ~98 KB, so the first visit loads much faster, especially on phones.
  app.use(compression());

  // Middleware: runs on every request before the routes.
  // This one parses JSON request bodies into req.body. Its default 100 KB
  // size limit guards against huge requests (a basic denial-of-service
  // protection). Bulk import routes need more: 2,000 rows
  // are ~200 KB, so it gets its own parser first (the general one then
  // sees the body is already parsed and skips it). Same for categorizing
  // an import in bulk.
  const bulkJson = express.json({ limit: "2mb" });
  app.use("/api/transactions/import", bulkJson);
  app.use("/api/ai/categorize-batch", bulkJson);
  app.use("/api/transfers/match", bulkJson);
  // A receipt photo: shrunk to ~300 KB in the browser, at most 5 MB, which
  // is ~6.7 MB as base64 text.
  app.use("/api/ai/scan-receipt", express.json({ limit: "8mb" }));
  app.use(express.json());

  // Simple "is the server alive?" endpoint, useful for deploys and debugging.
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // What the browser should know about this server, e.g. "it's a demo".
  const config = demo
    ? { demo: true, resets_every_minutes: 60 }
    : { demo: false };
  app.get("/api/config", (req, res) => res.json(config));

  // Mount routers: everything under /api/accounts goes to accountsRouter.
  app.use("/api/accounts", accountsRouter(db));
  app.use("/api/transactions", transactionsRouter(db));
  app.use("/api/categories", categoriesRouter(db));
  app.use("/api/budgets", budgetsRouter(db));
  app.use("/api/summary", summaryRouter(db));
  app.use("/api/transfers", transfersRouter(db));
  if (aiLimiter) app.use("/api/ai", aiLimiter);
  app.use("/api/ai", aiRouter(db, ai));

  // An unknown /api address is a JSON 404, never the web page.
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

  // The built React app: its files as they are, and index.html for any other
  // page address, so the browser always gets the app (React shows the page).
  if (clientDir) {
    // Vite names built files by their content (index-BnytfvqH.js), so a
    // changed file gets a new name: browsers may keep these for a year.
    app.use(
      "/assets",
      express.static(join(clientDir, "assets"), {
        immutable: true,
        maxAge: "1y",
      }),
    );
    // The page itself carries the config, so the demo banner is there from
    // the first paint instead of popping in (and pushing the page down)
    // once /api/config answers. "<" is escaped so the JSON can't end the tag.
    const page = readFileSync(join(clientDir, "index.html"), "utf8").replace(
      "</head>",
      `<meta name="ledgerly-config" content='${JSON.stringify(config).replaceAll("<", "\\u003c")}' /></head>`,
    );
    const sendPage = (req, res) =>
      res.set("Cache-Control", "no-cache").type("html").send(page);
    app.get(["/", "/index.html"], sendPage);
    app.use(express.static(clientDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      sendPage(req, res);
    });
  }

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
