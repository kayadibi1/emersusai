import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set("trust proxy", 1); // Caddy is the single reverse proxy
app.disable("x-powered-by");   // Don't advertise Express

// ── Body parsing with explicit size limits ──
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// ── Security response headers ──
// Caddy handles HSTS/TLS, but these headers protect regardless of proxy.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// ── Request timeout ──
// Abort non-streaming requests that hang longer than 30s. The chat SSE
// endpoint (/recommendation) manages its own lifecycle
// via OpenAI stream completion + res.on("close") and are exempt.
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30_000);
const SSE_PATHS = new Set([
  "/api/emersus/recommendation",
]);
app.use((req, res, next) => {
  if (SSE_PATHS.has(req.path)) return next();
  req.setTimeout(REQUEST_TIMEOUT_MS);
  res.setTimeout(REQUEST_TIMEOUT_MS, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout." });
    }
  });
  next();
});

// Import API handlers (each is a default-exported (req, res) function)
const { default: configHandler } = await import("./api/config.js");
const { default: contactHandler } = await import("./api/contact.js");
const { default: waitlistHandler } = await import("./api/waitlist.js");
const { default: waitlistConfirmHandler } = await import("./api/waitlist-confirm.js");
const { default: notifySignupHandler } = await import("./api/notify-signup.js");
const { default: recommendationHandler } = await import("./api/emersus/recommendation.js");
const { default: foodsSearchHandler } = await import("./api/emersus/foods-search.js");
const { default: foodsSearchBatchHandler } = await import("./api/emersus/foods-search-batch.js");
const { default: mealPlansRouter } = await import("./api/emersus/meal-plans.js");
const { default: mealJournalRouter } = await import("./api/emersus/meal-journal.js");
const { default: rpcProxy } = await import("./api/emersus/rpc-proxy.js");
const { threadsShareApiRouter, publicShareRouter } = await import("./api/emersus/threads-share.js");
const { default: suggestPromptsHandler } = await import("./api/emersus/suggest-prompts.js");
const { default: checkEmailHandler } = await import("./api/auth/check-email.js");
const { default: meRoleHandler } = await import("./api/me/role.js");

// Import auth middleware for recommendation endpoints
import { requireAuth } from "./api/emersus/auth-middleware.js";

// Import public rate limiting middleware
import { publicRateLimitMiddleware } from "./api/emersus/rate-limit.js";

// Import admin API routers + middleware
import adminCandidates from "./api/admin/candidates.js";
import adminTopics from "./api/admin/topics.js";
import adminFeeds from "./api/admin/feeds.js";
import adminJobs from "./api/admin/jobs.js";
import adminAlerts from "./api/admin/alerts.js";
import { requireAdmin } from "./api/admin/_middleware.js";

// Mount API routes — use specific HTTP methods instead of app.all()
// to reject unexpected methods at the routing layer.
app.get("/api/config", configHandler);
app.post("/api/contact", publicRateLimitMiddleware("contact"), contactHandler);
app.post("/api/waitlist", publicRateLimitMiddleware("waitlist"), waitlistHandler);
app.get("/api/waitlist/confirm", waitlistConfirmHandler);
app.post("/api/notify-signup", publicRateLimitMiddleware("notify-signup"), notifySignupHandler);
app.post("/api/emersus/recommendation", requireAuth, recommendationHandler);
app.get("/api/emersus/foods/search", foodsSearchHandler);
app.post("/api/emersus/foods/search-batch", foodsSearchBatchHandler);
app.use("/api/emersus/meal-plans", mealPlansRouter);
app.use("/api/emersus/meal-journal", mealJournalRouter);
app.all("/api/emersus/rpc/:name", rpcProxy);

// Thread sharing (chat_v2): create token + export transcript + public render.
// The public /share/t/:token view is mounted BEFORE static/admin routes so it
// wins over catch-alls.
app.use("/api/threads", threadsShareApiRouter());
app.use(publicShareRouter());

// chat_v2 empty-state suggested prompts (profile-aware, falls back to generic).
app.get("/api/emersus/suggest-prompts", suggestPromptsHandler);

// Auth + user endpoints
app.post("/api/auth/check-email", publicRateLimitMiddleware("check-email"), checkEmailHandler);
app.get("/api/me/role", meRoleHandler);

// Health check
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// Admin API (auth-gated)
app.use("/api/admin/candidates", requireAdmin, adminCandidates);
app.use("/api/admin/topics",     requireAdmin, adminTopics);
app.use("/api/admin/feeds",      requireAdmin, adminFeeds);
app.use("/api/admin/jobs",       requireAdmin, adminJobs);
app.use("/api/admin/alerts",     requireAdmin, adminAlerts);

// Serve admin HTML pages as static files
app.use("/admin", express.static(path.join(__dirname, "admin")));

// ── Catch-all 404 for unmatched API routes ──
// Express 5 uses path-to-regexp v8 which requires named wildcards.
app.use("/api/{*path}", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Emersus API listening on http://127.0.0.1:${PORT}`);
});
