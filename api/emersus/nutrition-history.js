// api/emersus/nutrition-history.js — GET /api/nutrition/history
//
// Returns a descending-by-date list of nutrition "day summaries" for the
// authenticated user, for use on the Nutrition History tab (mirrors the
// Train History tab semantically). Each row aggregates meal_journal_entries
// for that logged_date into kcal + P/C/F/fiber totals + a meal count.
//
// Query params:
//   limit   default 30, capped at 90 (days)
//
// Response: { items: [{ date, kcal, protein_g, carbs_g, fat_g, fiber_g,
//   entries, meals: [{ meal_slot, kcal }] }] }
//
// Meals array is included so the UI can optionally surface per-meal-slot
// breakdown (breakfast / lunch / dinner / snack) on row expand without a
// second round-trip. Water + supplements are intentionally excluded here —
// they live in separate tables and the Today tab fetches them per-day.

import { supabaseAdmin } from "../lib/clients.js";

export default async function nutritionHistoryHandler(req, res) {
  if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });

  const userId = req.verifiedUserId;
  const limit = Math.max(1, Math.min(parseInt(req.query?.limit, 10) || 30, 90));

  // Date window: [today - (limit - 1), today] inclusive, ISO YYYY-MM-DD.
  // meal_journal_entries.logged_date is a plain date col (no tz), so we
  // use raw date math in UTC. Good enough — the Today tab computes the
  // user's "today" date with their tz offset, but history windows don't
  // need per-row tz adjustment.
  const now = new Date();
  const endStr = now.toISOString().slice(0, 10);
  const startDate = new Date(now);
  startDate.setUTCDate(now.getUTCDate() - (limit - 1));
  const startStr = startDate.toISOString().slice(0, 10);

  const { data: meals, error } = await supabaseAdmin
    .from("meal_journal_entries")
    .select("logged_date, meal_slot, kcal_snapshot, protein_g_snapshot, carbs_g_snapshot, fat_g_snapshot, fiber_g_snapshot")
    .eq("user_id", userId)
    .gte("logged_date", startStr)
    .lte("logged_date", endStr)
    .order("logged_date", { ascending: false });

  if (error) {
    console.error("nutrition-history error", error);
    return res.status(500).json({ error: "Could not load nutrition history." });
  }

  const byDate = new Map();
  for (const m of meals || []) {
    const date = m.logged_date;
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0,
        entries: 0,
        meals: [],
      });
    }
    const bucket = byDate.get(date);
    bucket.kcal       += Number(m.kcal_snapshot)       || 0;
    bucket.protein_g  += Number(m.protein_g_snapshot)  || 0;
    bucket.carbs_g    += Number(m.carbs_g_snapshot)    || 0;
    bucket.fat_g      += Number(m.fat_g_snapshot)      || 0;
    bucket.fiber_g    += Number(m.fiber_g_snapshot)    || 0;
    bucket.entries    += 1;
    bucket.meals.push({
      meal_slot: m.meal_slot || null,
      kcal: Number(m.kcal_snapshot) || 0,
    });
  }

  const items = Array.from(byDate.values())
    .map((d) => ({
      ...d,
      kcal:      Math.round(d.kcal),
      protein_g: Math.round(d.protein_g),
      carbs_g:   Math.round(d.carbs_g),
      fat_g:     Math.round(d.fat_g),
      fiber_g:   Math.round(d.fiber_g),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  res.json({ items, window: { start: startStr, end: endStr, limit } });
}
