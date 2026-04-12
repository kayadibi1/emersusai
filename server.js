import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import API handlers (each is a default-exported (req, res) function)
const { default: configHandler } = await import("./api/config.js");
const { default: contactHandler } = await import("./api/contact.js");
const { default: waitlistHandler } = await import("./api/waitlist.js");
const { default: notifySignupHandler } = await import("./api/notify-signup.js");
const { default: recommendationHandler } = await import("./api/emersus/recommendation.js");
const { default: recommendationStreamHandler } = await import("./api/emersus/recommendation-stream.js");
const { default: foodsSearchHandler } = await import("./api/emersus/foods-search.js");
const { default: mealPlansRouter } = await import("./api/emersus/meal-plans.js");
const { default: mealJournalRouter } = await import("./api/emersus/meal-journal.js");

// Import admin API routers + middleware
import adminCandidates from "./api/admin/candidates.js";
import adminTopics from "./api/admin/topics.js";
import adminFeeds from "./api/admin/feeds.js";
import adminJobs from "./api/admin/jobs.js";
import adminAlerts from "./api/admin/alerts.js";
import { requireAdmin } from "./api/admin/_middleware.js";

// Mount API routes
app.all("/api/config", configHandler);
app.all("/api/contact", contactHandler);
app.all("/api/waitlist", waitlistHandler);
app.all("/api/notify-signup", notifySignupHandler);
app.all("/api/emersus/recommendation", recommendationHandler);
app.all("/api/emersus/recommendation-stream", recommendationStreamHandler);
app.all("/api/emersus/foods/search", foodsSearchHandler);
app.use("/api/emersus/meal-plans", mealPlansRouter);
app.use("/api/emersus/meal-journal", mealJournalRouter);

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Emersus API listening on http://127.0.0.1:${PORT}`);
});
