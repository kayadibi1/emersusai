import "dotenv/config";
// Initialize Sentry BEFORE any other import so its auto-instrumentation can
// hook into express/http/etc. No-op when SENTRY_DSN is unset.
import { initSentry, initPostHog, shutdownAnalytics, Sentry } from "./api/lib/analytics.js";
initSentry();
initPostHog();

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Required env-var validation ──
// In production, missing Supabase/OpenAI/Polar vars hard-fail at boot so
// we never silently serve a broken surface. In dev, we warn only so local
// work isn't blocked when Polar isn't configured.
(function validateEnv() {
  const isProd = process.env.NODE_ENV === "production";
  const core = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY"];
  const billing = ["POLAR_PRODUCT_ID_MONTHLY", "POLAR_PRODUCT_ID_YEARLY", "SITE_URL"];
  const missingCore = core.filter((k) => !process.env[k]);
  const missingBilling = billing.filter((k) => !process.env[k]);

  if (missingCore.length) {
    const msg = `[boot] missing required env vars: ${missingCore.join(", ")}`;
    if (isProd) {
      console.error(msg);
      process.exit(1);
    }
    console.warn(msg);
  }
  if (missingBilling.length) {
    const msg = `[boot] missing billing env vars: ${missingBilling.join(", ")}`;
    if (isProd) {
      console.error(msg);
      process.exit(1);
    }
    console.warn(msg);
  }
})();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set("trust proxy", 1); // Caddy is the single reverse proxy
app.disable("x-powered-by");   // Don't advertise Express

// ── Polar webhook — MUST be registered BEFORE express.json() ──
// The signature check (validateEvent in @polar-sh/sdk/webhooks) hashes
// the raw request bytes. If the global JSON parser ran first, req.body
// would be a parsed object with reformatted whitespace — signature
// verification would fail on every call.
const { default: polarWebhookHandler } = await import("./api/billing/webhook.js");
app.post(
  "/api/billing/polar/webhook",
  express.raw({ type: "application/json", limit: "100kb" }),
  polarWebhookHandler
);

// ── Resend webhook — MUST be registered BEFORE express.json() ──
// Svix signature verification hashes the raw request bytes.
const { resendWebhookExpressHandler } = await import("./api/email/webhook-resend.js");
app.post(
  "/api/email/webhook/resend",
  express.raw({ type: "application/json", limit: "1mb" }),
  (req, res, next) => {
    req.rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : String(req.body || "");
    try { req.body = JSON.parse(req.rawBody); } catch { req.body = null; }
    next();
  },
  resendWebhookExpressHandler,
);

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
const { default: configHandler, startConfigWarmer } = await import("./api/config.js");
const { default: contactHandler } = await import("./api/contact.js");
const { default: notifySignupHandler } = await import("./api/notify-signup.js");
const { default: recommendationHandler } = await import("./api/emersus/recommendation.js");
const { default: foodsSearchHandler } = await import("./api/emersus/foods-search.js");
const { default: foodsSearchBatchHandler } = await import("./api/emersus/foods-search-batch.js");
const { default: mealPlansRouter } = await import("./api/emersus/meal-plans.js");
const { default: mealJournalRouter } = await import("./api/emersus/meal-journal.js");
const { default: rpcProxy } = await import("./api/emersus/rpc-proxy.js");
const { threadsShareApiRouter, publicShareRouter } = await import("./api/emersus/threads-share.js");
const { default: suggestPromptsHandler } = await import("./api/emersus/suggest-prompts.js");
const { default: threadTitleHandler } = await import("./api/emersus/thread-title.js");
const { default: profileRouter } = await import("./api/emersus/profile.js");
const { default: integrationsWaitlistHandler } = await import("./api/emersus/integrations-waitlist.js");
const { default: workoutSessionsRouter } = await import("./api/emersus/workout-sessions.js");
const { default: setsHandler } = await import("./api/emersus/sets.js");
const { default: exercisesCatalogHandler } = await import("./api/emersus/exercises-catalog.js");
const { default: nutritionDayHandler } = await import("./api/emersus/nutrition-day.js");
const { default: nutritionHistoryHandler } = await import("./api/emersus/nutrition-history.js");
const { default: nutritionWaterHandler } = await import("./api/emersus/nutrition-water.js");
const { default: nutritionSupplementsHandler } = await import("./api/emersus/nutrition-supplements.js");
const { default: progressHandler } = await import("./api/emersus/progress.js");
const { default: usageHandler } = await import("./api/emersus/usage.js");
const { default: savedSourcesHandler } = await import("./api/emersus/saved-sources.js");
const { default: polarCheckoutHandler } = await import("./api/billing/checkout.js");
const { default: polarPortalHandler } = await import("./api/billing/portal.js");
const { default: checkEmailHandler } = await import("./api/auth/check-email.js");
const { default: meRoleHandler } = await import("./api/me/role.js");
const { default: completeOnboardingHandler } = await import("./api/profile/complete-onboarding.js");
const { trackClickExpressHandler } = await import("./api/email/track-click.js");
const { unsubscribeExpressHandler } = await import("./api/email/unsubscribe.js");

// Import auth middleware for recommendation endpoints
import { requireAuth } from "./api/emersus/auth-middleware.js";

// Import public rate limiting middleware
import { publicRateLimitMiddleware } from "./api/emersus/rate-limit.js";

// Per-user daily message cap on the chat endpoint (Free: 10/day, Pro: 100/day).
import { userRateLimit } from "./api/emersus/user-rate-limit.js";

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
app.post("/api/notify-signup", publicRateLimitMiddleware("notify-signup"), notifySignupHandler);
app.post("/api/emersus/recommendation", requireAuth, userRateLimit(), recommendationHandler);
app.get("/api/emersus/usage", requireAuth, usageHandler);
app.get("/api/emersus/saved-sources", requireAuth, savedSourcesHandler);
app.post("/api/emersus/saved-sources", requireAuth, savedSourcesHandler);
app.delete("/api/emersus/saved-sources/by-source-id/:source_id", requireAuth, savedSourcesHandler);
app.delete("/api/emersus/saved-sources/:id", requireAuth, savedSourcesHandler);
app.post("/api/billing/polar/checkout", requireAuth, polarCheckoutHandler);
app.get("/api/billing/polar/portal", requireAuth, polarPortalHandler);

// --- Email infrastructure ---
app.get("/api/email/track/click",  trackClickExpressHandler);
app.get("/api/email/unsubscribe",  unsubscribeExpressHandler);
app.post("/api/email/unsubscribe", unsubscribeExpressHandler);
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

// chat_v2 thread-title generator — one-shot LLM call fired after the first
// assistant reply to give the sidebar a meaningful title.
app.post("/api/emersus/thread-title", requireAuth, threadTitleHandler);

// profile_v2: structured profile read/write + integrations waitlist.
app.post("/api/profile/complete-onboarding", requireAuth, completeOnboardingHandler);
app.use("/api/profile", profileRouter());
app.post("/api/integrations/waitlist", requireAuth, integrationsWaitlistHandler);

// train_v2 (Phase 3): workout-sessions + sets + exercises catalog.
app.use("/api/workout-sessions", workoutSessionsRouter());
app.post("/api/sets", requireAuth, setsHandler);
app.get("/api/exercises", exercisesCatalogHandler);

// nutrition_v2 (Phase 4): day aggregator + water + supplements.
app.get("/api/nutrition/day", requireAuth, nutritionDayHandler);
app.get("/api/nutrition/history", requireAuth, nutritionHistoryHandler);
app.post("/api/nutrition/water", requireAuth, nutritionWaterHandler);
app.post("/api/nutrition/supplements", requireAuth, nutritionSupplementsHandler);

// progress_v2 (Phase 5): batched dashboard data.
app.get("/api/progress", requireAuth, progressHandler);

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

// ── Sentry error handler (must come after routes, before any other error
// middleware). Sentry.setupExpressErrorHandler is a no-op when Sentry isn't
// initialized (SENTRY_DSN unset), so this is safe in dev.
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

const PORT = process.env.PORT || 3001;
const httpServer = app.listen(PORT, "127.0.0.1", () => {
  console.log(`Emersus API listening on http://127.0.0.1:${PORT}`);
  startConfigWarmer();
});

// Long-lived SSE streams (chat, recommendation) keep the keep-alive socket
// open well past the request lifetime. Without explicit timeout values
// those sockets count as "in-flight" forever and server.close() never
// resolves. 5 min is a generous upper bound for a single recommendation
// stream — anything past that is hung and should be terminated.
httpServer.keepAliveTimeout = 65_000;
httpServer.headersTimeout = 70_000;
httpServer.requestTimeout = 5 * 60_000;

// Graceful shutdown — give in-flight requests up to 25s to drain before
// forcing exit. PM2 default kill_timeout is 1600ms which truncates SSE
// streams mid-flight on every deploy; bump it to 30s via:
//   pm2 restart emersus-api --kill-timeout 30000
// or persist in ecosystem config. Without a higher kill_timeout, this
// handler still helps for the first 1.6s but pm2's SIGKILL takes over
// after that.
let shuttingDown = false;
async function gracefulShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${sig}, draining in-flight requests…`);

  // Stop accepting new connections; resolves when in-flight requests close.
  const closed = new Promise((resolve) => {
    httpServer.close((err) => {
      if (err) console.error("[shutdown] server.close error:", err.message);
      resolve();
    });
  });

  // Hard cap so a hung SSE doesn't hold up exit indefinitely.
  const cap = new Promise((resolve) => setTimeout(resolve, 25_000));

  await Promise.race([closed, cap]);

  try {
    await shutdownAnalytics();
  } catch (err) {
    console.error("[shutdown] analytics flush error:", err.message);
  }

  console.log("[shutdown] exit 0");
  process.exit(0);
}
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.once(sig, () => gracefulShutdown(sig));
}
