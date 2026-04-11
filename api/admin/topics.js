// api/admin/topics.js
import express from "express";
import { supabaseAdmin } from "../lib/clients.js";

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /?status=active&limit=50
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  let query = supabaseAdmin
    .from("research_topics")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (req.query.status) {
    query = query.eq("status", req.query.status);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ topics: data });
});

// ---------------------------------------------------------------------------
// PATCH /:id — update query, domain, status, target_paper_count
// ---------------------------------------------------------------------------
router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const allowed = ["query", "domain", "status", "target_paper_count"];
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
    .from("research_topics")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "topic not found" });
  res.json({ topic: data });
});

// ---------------------------------------------------------------------------
// POST /:id/ingest  body: {sourceIds?}
// Enqueues ingest-topic job via pg-boss
// ---------------------------------------------------------------------------
router.post("/:id/ingest", async (req, res) => {
  const id = Number(req.params.id);
  const { sourceIds } = req.body ?? {};

  // Verify topic exists
  const { data: topic, error: fetchErr } = await supabaseAdmin
    .from("research_topics")
    .select("id, topic_key, status")
    .eq("id", id)
    .single();
  if (fetchErr || !topic)
    return res.status(404).json({ error: "topic not found" });

  let jobId = null;
  if (process.env.DATABASE_URL) {
    const { default: PgBoss } = await import("pg-boss");
    const boss = new PgBoss(process.env.DATABASE_URL);
    try {
      await boss.start();
      await boss.createQueue("ingest-topic").catch(() => {});
      jobId = await boss.send("ingest-topic", {
        topicId: id,
        ...(sourceIds ? { sourceIds } : {}),
      });
    } finally {
      await boss.stop({ graceful: false }).catch(() => {});
    }
  }

  res.json({ topicId: id, jobId });
});

export default router;
