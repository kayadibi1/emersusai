import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import Vercel-style handlers
const { default: configHandler } = await import("./api/config.js");
const { default: contactHandler } = await import("./api/contact.js");
const { default: waitlistHandler } = await import("./api/waitlist.js");
const { default: recommendationHandler } = await import("./api/emersus/recommendation.js");
const { default: recommendationStreamHandler } = await import("./api/emersus/recommendation-stream.js");

// Mount at the same paths Vercel used
app.all("/api/config", configHandler);
app.all("/api/contact", contactHandler);
app.all("/api/waitlist", waitlistHandler);
app.all("/api/emersus/recommendation", recommendationHandler);
app.all("/api/emersus/recommendation-stream", recommendationStreamHandler);

// Health check
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Emersus API listening on http://127.0.0.1:${PORT}`);
});
