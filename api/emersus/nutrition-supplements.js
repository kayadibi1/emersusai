// api/emersus/nutrition-supplements.js — Phase 4 · POST /api/nutrition/supplements { items[] }
import { supabaseAdmin } from "../lib/clients.js";

export default async function nutritionSupplementsHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "items must be a non-empty array" });

  const rows = items
    .map((item) => ({
      user_id: req.verifiedUserId,
      name: String(item?.name || "").slice(0, 120).trim(),
      amount: Number.isFinite(Number(item?.amount)) ? Number(item.amount) : null,
      unit: item?.unit ? String(item.unit).slice(0, 16) : null,
      consumed_at: item?.consumed_at ? new Date(item.consumed_at).toISOString() : new Date().toISOString(),
    }))
    .filter((r) => r.name);
  if (!rows.length) return res.status(400).json({ error: "items need a name" });

  const { data, error } = await supabaseAdmin
    .from("supplement_log")
    .insert(rows)
    .select("*");
  if (error) {
    console.error("supplement log error", error);
    return res.status(500).json({ error: "Could not log supplements." });
  }
  res.status(201).json({ items: data || [] });
}
