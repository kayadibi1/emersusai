// api/emersus/nutrition-water.js — Phase 4 · POST /api/nutrition/water { ml }
import { supabaseAdmin } from "../lib/clients.js";

export default async function nutritionWaterHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });
  const ml = Number(req.body?.ml);
  if (!Number.isFinite(ml) || ml <= 0 || ml > 5000) {
    return res.status(400).json({ error: "ml must be 1-5000" });
  }
  const { data, error } = await supabaseAdmin
    .from("water_log")
    .insert({ user_id: req.verifiedUserId, ml: Math.round(ml), consumed_at: new Date().toISOString() })
    .select("*")
    .single();
  if (error) {
    console.error("water log error", error);
    return res.status(500).json({ error: "Could not log water." });
  }
  res.status(201).json(data);
}
