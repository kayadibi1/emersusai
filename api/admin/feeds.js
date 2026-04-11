// api/admin/feeds.js
import express from "express";
import { supabaseAdmin } from "../lib/clients.js";

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /  — list all feeds
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// POST /  — create a new feed
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
  const {
    name,
    source_type,
    config,
    active = true,
  } = req.body ?? {};

  if (!name) return res.status(400).json({ error: "name required" });
  if (!source_type) return res.status(400).json({ error: "source_type required" });

  const { data, error } = await supabaseAdmin
    .from("discovery_feeds")
    .insert({ name, source_type, config: config ?? {}, active })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ feed: data });
});

// ---------------------------------------------------------------------------
// PATCH /:id  — update name, config, active, source_type
// ---------------------------------------------------------------------------
router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const allowed = ["name", "source_type", "config", "active"];
  const updates = {};
  for (const key of allowed) {
    if (key in (req.body ?? {})) {
      updates[key] = req.body[key];
    }
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "no updatable fields provided" });
  }

  const { data, error } = await supabaseAdmin
    .from("discovery_feeds")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "feed not found" });
  res.json({ feed: data });
});

// ---------------------------------------------------------------------------
// POST /:id/fetch-now  — enqueue fetch-feed job
// ---------------------------------------------------------------------------
router.post("/:id/fetch-now", async (req, res) => {
  const id = Number(req.params.id);

  // Verify feed exists
  const { data: feed, error: fetchErr } = await supabaseAdmin
    .from("discovery_feeds")
    .select("id, name, source_type")
    .eq("id", id)
    .single();
  if (fetchErr || !feed)
    return res.status(404).json({ error: "feed not found" });

  let jobId = null;
  if (process.env.DATABASE_URL) {
    const { default: PgBoss } = await import("pg-boss");
    const boss = new PgBoss(process.env.DATABASE_URL);
    try {
      await boss.start();
      await boss.createQueue("fetch-feed").catch(() => {});
      jobId = await boss.send("fetch-feed", { feedId: id });
    } finally {
      await boss.stop({ graceful: false }).catch(() => {});
    }
  }

  res.json({ feedId: id, jobId });
});

export default router;
