// api/admin/alerts.js
import express from "express";
import { supabaseAdmin } from "../lib/clients.js";

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /?days=30
// Returns rows from alert_log filtered by sent_at > now() - N days.
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  const days = Math.min(Number(req.query.days ?? 30), 365);
  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("alert_log")
    .select("*")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ alerts: data });
});

export default router;
