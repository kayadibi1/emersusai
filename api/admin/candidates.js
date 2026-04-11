// api/admin/candidates.js
import express from "express";
import { supabaseAdmin } from "../lib/clients.js";

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /?status=pending&limit=50
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  const status = req.query.status ?? "pending";
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const { data, error } = await supabaseAdmin
    .from("topic_candidates")
    .select("*")
    .eq("status", status)
    .order("confidence", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ candidates: data });
});

// ---------------------------------------------------------------------------
// POST /:id/accept  body: {query?, domain?, target?}
// Creates a research_topics row, flips candidate to accepted, enqueues job.
// Note: PgBoss is started/stopped per-request for v1 (accepts are rare).
// TODO: lift to a shared module-level instance if this becomes a bottleneck.
// ---------------------------------------------------------------------------
router.post("/:id/accept", async (req, res) => {
  const id = Number(req.params.id);
  const {
    query: overrideQuery,
    domain: overrideDomain,
    target: overrideTarget,
  } = req.body ?? {};

  const { data: candidate, error: fetchErr } = await supabaseAdmin
    .from("topic_candidates")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchErr || !candidate)
    return res.status(404).json({ error: "candidate not found" });
  if (candidate.status !== "pending")
    return res.status(409).json({ error: `candidate is ${candidate.status}` });

  const query = overrideQuery ?? candidate.suggested_query;
  if (!query)
    return res.status(400).json({
      error: "candidate has no suggested_query; provide query in body",
    });

  // Insert research_topics row
  const { data: topic, error: topicErr } = await supabaseAdmin
    .from("research_topics")
    .insert({
      topic_key: candidate.topic_key,
      query,
      domain: overrideDomain ?? null,
      origin: "discovered",
      source_candidate_id: id,
      target_paper_count: overrideTarget ?? 2000,
    })
    .select()
    .single();
  if (topicErr) return res.status(500).json({ error: topicErr.message });

  // Flip candidate to accepted
  await supabaseAdmin
    .from("topic_candidates")
    .update({
      status: "accepted",
      decided_at: new Date().toISOString(),
      decided_by: req.adminUser.email,
    })
    .eq("id", id);

  // Enqueue ingest-topic job via pg-boss
  let jobId = null;
  if (process.env.DATABASE_URL) {
    const { default: PgBoss } = await import("pg-boss");
    const boss = new PgBoss(process.env.DATABASE_URL);
    try {
      await boss.start();
      await boss.createQueue("ingest-topic").catch(() => {});
      jobId = await boss.send("ingest-topic", { topicId: topic.id });
    } finally {
      await boss.stop({ graceful: false }).catch(() => {});
    }
  }

  res.json({ topic, jobId });
});

// ---------------------------------------------------------------------------
// POST /:id/reject
// ---------------------------------------------------------------------------
router.post("/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const { error } = await supabaseAdmin
    .from("topic_candidates")
    .update({
      status: "rejected",
      decided_at: new Date().toISOString(),
      decided_by: req.adminUser.email,
    })
    .eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /:id/snooze  body: {until}
// ---------------------------------------------------------------------------
router.post("/:id/snooze", async (req, res) => {
  const id = Number(req.params.id);
  const { until } = req.body ?? {};
  if (!until) return res.status(400).json({ error: "until required" });
  const { error } = await supabaseAdmin
    .from("topic_candidates")
    .update({
      status: "snoozed",
      snooze_until: until,
      decided_at: new Date().toISOString(),
      decided_by: req.adminUser.email,
    })
    .eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
