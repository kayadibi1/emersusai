// api/emersus/nutrition-day.js — Phase 4 Nutrition · GET /api/nutrition/day.
//
// Aggregates everything the Today tab needs in one call:
//   - meal_journal_entries logged for the date (consumed macros)
//   - meal_plans active plan slot for the date (planned macros)
//   - water_log + supplement_log totals
//   - profile macros target
//   - server-computed pace zone + WHY insight (rule-based, not LLM)

import { supabaseAdmin } from "../lib/clients.js";
import { computeMacrosFromBodyWeight } from "./profile.js";
import { resolveDayType } from "../../shared/meal-plan-day-type.js";

const DEFAULT_EATING_WINDOW = { start: 7, end: 22 }; // 7 AM - 10 PM local
const PACE_TOLERANCE = 0.08;                          // ±8% band

export function computePaceZone({ targetKcal, eatingWindow = DEFAULT_EATING_WINDOW, now = new Date(), tzOffsetMinutes = 0 }) {
  if (!targetKcal || targetKcal <= 0) return { start: 0, end: 0 };
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const hours = ((utcHours - tzOffsetMinutes / 60) % 24 + 24) % 24;
  const windowSpan = Math.max(0.5, eatingWindow.end - eatingWindow.start);
  const elapsed = Math.max(0, Math.min(hours - eatingWindow.start, windowSpan));
  const idealRatio = elapsed / windowSpan;          // 0..1 across the eating window
  const start = Math.max(0, idealRatio - PACE_TOLERANCE);
  const end = Math.min(1, idealRatio + PACE_TOLERANCE);
  return { start, end };
}

export function computeWhyInsight({ meals = [], target, consumed }) {
  if (!target?.kcal) return "";
  const delta = (consumed?.kcal || 0) - target.kcal * 0.5;
  if (Math.abs(delta) < 100) return "On pace with your target right now.";

  // Find the meal that contributed the largest single chunk.
  const biggest = meals
    .filter((m) => m.eaten_at && m.kcal)
    .sort((a, b) => (b.kcal || 0) - (a.kcal || 0))[0];

  if (!biggest) {
    if (delta > 0) return `You're ${Math.round(delta)} kcal ahead of pace.`;
    return `You're ${Math.round(-delta)} kcal behind pace.`;
  }

  if (delta > 0) {
    return `${biggest.name || biggest.type} came in at ${biggest.kcal} kcal — pushing you ahead of pace.`;
  }
  return `Logged meals total ${consumed?.kcal || 0} kcal so far. You can take in ${Math.round(target.kcal - (consumed?.kcal || 0))} more before bedtime.`;
}

function isoDateString(d) { return d.toISOString().slice(0, 10); }

function rangeForDate(dateStr, tzOffsetMinutes = 0) {
  const dayStart = new Date(`${dateStr}T00:00:00Z`);
  dayStart.setTime(dayStart.getTime() + tzOffsetMinutes * 60_000);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  return { start: dayStart.toISOString(), end: dayEnd.toISOString() };
}

async function loadConsumed(userId, dateStr) {
  const { data, error } = await supabaseAdmin
    .from("meal_journal_entries")
    .select("id, meal_slot, logged_at, kcal_snapshot, protein_g_snapshot, carbs_g_snapshot, fat_g_snapshot, fiber_g_snapshot")
    .eq("user_id", userId)
    .eq("logged_date", dateStr);
  if (error) throw error;
  return data || [];
}

async function loadActivePlan(userId) {
  const { data, error } = await supabaseAdmin
    .from("meal_plans")
    .select("id, title, plan")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadActiveWorkoutPlan(userId) {
  const { data, error } = await supabaseAdmin
    .from("workout_plans")
    .select("id, plan")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadWater(userId, dateStr, tzOffset) {
  const { start, end } = rangeForDate(dateStr, tzOffset);
  const { data, error } = await supabaseAdmin
    .from("water_log")
    .select("id, ml, consumed_at")
    .eq("user_id", userId)
    .gte("consumed_at", start)
    .lt("consumed_at", end);
  if (error) {
    if (/relation .* does not exist/i.test(String(error.message || ""))) return [];
    throw error;
  }
  return data || [];
}

async function loadSupplements(userId, dateStr, tzOffset) {
  const { start, end } = rangeForDate(dateStr, tzOffset);
  const { data, error } = await supabaseAdmin
    .from("supplement_log")
    .select("id, name, amount, unit, consumed_at")
    .eq("user_id", userId)
    .gte("consumed_at", start)
    .lt("consumed_at", end);
  if (error) {
    if (/relation .* does not exist/i.test(String(error.message || ""))) return [];
    throw error;
  }
  return data || [];
}

async function loadProfileTarget(userId) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("body_weight_kg, macros, weight_unit, eating_window_start, eating_window_end")
    .eq("id", userId)
    .maybeSingle();
  const macros = data?.macros || computeMacrosFromBodyWeight(data?.body_weight_kg) || {
    kcal: 2000, protein_g: 130, carbs_g: 220, fat_g: 70,
  };
  const eatingWindow = (data?.eating_window_start != null && data?.eating_window_end != null)
    ? { start: data.eating_window_start, end: data.eating_window_end }
    : undefined;
  return { ...macros, water_ml: 3000, eatingWindow };
}

function summarizeMacros(rows) {
  const out = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  for (const r of rows) {
    out.kcal     += Number(r.kcal_snapshot)     || 0;
    out.protein_g += Number(r.protein_g_snapshot) || 0;
    out.carbs_g   += Number(r.carbs_g_snapshot)   || 0;
    out.fat_g     += Number(r.fat_g_snapshot)     || 0;
    out.fiber_g   += Number(r.fiber_g_snapshot)   || 0;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

function buildMealsList(consumedRows, planSlots) {
  const consumed = (consumedRows || []).map((r) => ({
    id: r.id,
    type: r.meal_slot,
    name: null,
    eaten_at: r.logged_at,
    planned_at: null,
    kcal: Math.round(Number(r.kcal_snapshot) || 0),
    protein_g: Math.round(Number(r.protein_g_snapshot) || 0),
    carbs_g: Math.round(Number(r.carbs_g_snapshot) || 0),
    fat_g: Math.round(Number(r.fat_g_snapshot) || 0),
    ingredients: [],
  }));
  const planned = (planSlots || []).map((s) => ({
    id: s.id,
    type: s.slot,
    name: s.name,
    eaten_at: null,
    planned_at: s.time,
    kcal: s.kcal,
    protein_g: s.protein_g,
    carbs_g: s.carbs_g,
    fat_g: s.fat_g,
    ingredients: s.ingredients || [],
  }));
  return [...consumed, ...planned].sort((a, b) => {
    const ta = (a.eaten_at || a.planned_at || "").toString();
    const tb = (b.eaten_at || b.planned_at || "").toString();
    return ta.localeCompare(tb);
  });
}

function planSlotsFromActivePlan(activePlan, dateStr, workoutPlan) {
  if (!activePlan?.plan) return [];
  const dayTypes = activePlan.plan.day_types || [];
  const slug = resolveDayType({
    date: dateStr,
    mealPlan: activePlan.plan,
    workoutPlan: workoutPlan?.plan,
  });
  const dt = dayTypes.find(d => d.slug === slug) ?? dayTypes[0];
  const meals = dt?.meals || [];
  return meals.map((m) => ({
    id: m.id || `plan-${m.slot}-${m.name}`,
    slot: m.slot,
    name: m.name,
    time: m.time,
    kcal: Math.round(m.macros?.kcal || 0),
    protein_g: Math.round(m.macros?.protein_g || 0),
    carbs_g: Math.round(m.macros?.carbs_g || 0),
    fat_g: Math.round(m.macros?.fat_g || 0),
    ingredients: m.foods || [],
  }));
}

export default async function nutritionDayHandler(req, res) {
  if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });
  const userId = req.verifiedUserId;
  if (!userId) return res.status(401).json({ error: "Auth required." });

  const dateStr = String(req.query?.date || isoDateString(new Date()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  const tzOffset = Number(req.query?.tz) || 0;

  try {
    const [consumedRows, activePlan, activeWorkoutPlan, waterRows, supplementRows, target] = await Promise.all([
      loadConsumed(userId, dateStr),
      loadActivePlan(userId),
      loadActiveWorkoutPlan(userId),
      loadWater(userId, dateStr, tzOffset),
      loadSupplements(userId, dateStr, tzOffset),
      loadProfileTarget(userId),
    ]);

    const consumed = summarizeMacros(consumedRows);
    consumed.water_ml = waterRows.reduce((acc, r) => acc + (Number(r.ml) || 0), 0);
    consumed.supplements = supplementRows.map((s) => ({ id: s.id, name: s.name, amount: s.amount, unit: s.unit }));

    const planSlots = planSlotsFromActivePlan(activePlan, dateStr, activeWorkoutPlan);
    const planned = planSlots.reduce((acc, s) => ({
      kcal: acc.kcal + s.kcal,
      protein_g: acc.protein_g + s.protein_g,
      carbs_g: acc.carbs_g + s.carbs_g,
      fat_g: acc.fat_g + s.fat_g,
    }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

    const meals = buildMealsList(consumedRows, planSlots);
    const pace = computePaceZone({ targetKcal: target.kcal, eatingWindow: target.eatingWindow, tzOffsetMinutes: tzOffset });
    const whyInsight = computeWhyInsight({ meals, target, consumed });

    res.json({
      date: dateStr,
      consumed,
      planned,
      target,
      meals,
      pace_zone_start: pace.start,
      pace_zone_end: pace.end,
      eating_window: target.eatingWindow ?? DEFAULT_EATING_WINDOW,
      predicted_target_time: null,
      why_insight: whyInsight,
      active_plan: activePlan ? { id: activePlan.id, title: activePlan.title } : null,
    });
  } catch (err) {
    console.error("nutrition-day error", err);
    res.status(500).json({ error: "Could not load nutrition day." });
  }
}
