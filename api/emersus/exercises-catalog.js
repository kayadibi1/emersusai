// api/emersus/exercises-catalog.js — Phase 3 Train · GET /api/exercises.
//
// Query params:
//   q          — substring match on name (case-insensitive)
//   equipment  — filter on exercises.equipment
//   muscle     — filter on exercises.muscle_groups[] (contains)
//   category   — filter on exercises.category (resistance|cardio|...)
//   recent     — when "true", join with workout_logs and prioritize the
//                user's recently-used exercises (auth required).
//   limit      — default 20, capped at 100.

import { supabaseAdmin } from "../lib/clients.js";

export default async function exercisesCatalogHandler(req, res) {
  if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });

  const q = String(req.query?.q || "").trim().toLowerCase();
  const equipment = String(req.query?.equipment || "").trim();
  const muscle = String(req.query?.muscle || "").trim();
  const category = String(req.query?.category || "").trim();
  const recent = String(req.query?.recent || "") === "true";
  const limit = Math.max(1, Math.min(Number(req.query?.limit) || 20, 100));

  // When a search query is provided, route through search_exercises() RPC
  // so both the name column AND the aliases[] array get matched. The prior
  // .ilike("name", ...) path ignored aliases entirely, which is why common
  // natural terms like "dumbbell chest press" never found the seeded
  // "Dumbbell Bench Press" row. Recent-sort path (no q) keeps the direct
  // table query since it filters by user's workout_logs anyway.
  if (q && !recent) {
    const { data, error } = await supabaseAdmin.rpc("search_exercises", {
      p_q: q,
      p_limit: limit,
      p_equipment: equipment || null,
      p_category: category || null,
      p_muscle: muscle || null,
    });
    if (error) {
      console.error("exercises-catalog search_exercises error", error);
      return res.status(500).json({ error: "Could not load exercises." });
    }
    return res.json({ items: data || [] });
  }

  let query = supabaseAdmin
    .from("exercises")
    .select("id,slug,name,aliases,muscle_groups,equipment,category,movement_type")
    .limit(limit);

  if (q) query = query.ilike("name", `%${q}%`);
  if (equipment) query = query.eq("equipment", equipment);
  if (category) query = query.eq("category", category);
  if (muscle) query = query.contains("muscle_groups", [muscle]);

  if (recent && req.verifiedUserId) {
    // Pull the user's last-N distinct exercise_ids from workout_logs.
    const { data: recentRows } = await supabaseAdmin
      .from("workout_logs")
      .select("exercise_id, performed_at")
      .eq("user_id", req.verifiedUserId)
      .order("performed_at", { ascending: false })
      .limit(50);
    const recentIds = Array.from(new Set((recentRows || []).map((r) => r.exercise_id))).slice(0, limit);
    if (recentIds.length) {
      query = query.in("id", recentIds);
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("exercises-catalog error", error);
    return res.status(500).json({ error: "Could not load exercises." });
  }
  res.json({ items: data || [] });
}
