// api/admin/feeds.js
import express from "express";
import { supabaseAdmin } from "../lib/clients.js";
import PgBoss from "pg-boss";

const router = express.Router();

// GET / — list all feeds
router.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const { data, error } = await supabaseAdmin
    .from("discovery_feeds")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ feeds: data });
});

// POST / — create a new feed
router.post("/", async (req, res) => {
  const { id, name, kind, url, source_plugin, status = "active" } = req.body ?? {};
  if (!id) return res.status(400).json({ error: "id required" });
  if (!name) return res.status(400).json({ error: "name required" });
  if (!kind || !["rss", "atom", "api"].includes(kind)) {
    return res.status(400).json({ error: "kind must be rss|atom|api" });
  }
  if (!url) return res.status(400).json({ error: "url required" });
  if (!source_plugin) return res.status(400).json({ error: "source_plugin required" });
  if (!["active", "disabled"].includes(status)) {
    return res.status(400).json({ error: "status must be active|disabled" });
  }

  const { data, error } = await supabaseAdmin
    .from("discovery_feeds")
    .insert({ id, name, kind, url, source_plugin, status })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ feed: data });
});

// PATCH /:id — update mutable fields
router.patch("/:id", async (req, res) => {
  const id = req.params.id; // text PK
  const allowed = ["name", "kind", "url", "source_plugin", "status"];
  const updates = {};
  for (const k of allowed) {
    if (req.body?.[k] !== undefined) updates[k] = req.body[k];
  }
  if (updates.kind && !["rss", "atom", "api"].includes(updates.kind)) {
    return res.status(400).json({ error: "invalid kind" });
  }
  if (updates.status && !["active", "disabled"].includes(updates.status)) {
    return res.status(400).json({ error: "invalid status" });
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("discovery_feeds")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ feed: data });
});

// POST /:id/fetch-now — enqueue a one-off fetch-feed job
router.post("/:id/fetch-now", async (req, res) => {
  const id = req.params.id;
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ error: "DATABASE_URL not configured" });
  }

  const boss = new PgBoss(process.env.DATABASE_URL);
  try {
    await boss.start();
    await boss.createQueue("fetch-feed").catch(() => {});
    const jobId = await boss.send("fetch-feed", { feedId: id });
    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await boss.stop({ graceful: true }).catch(() => {});
  }
});

export default router;
