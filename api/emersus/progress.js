// api/emersus/progress.js — Phase 5 Progress · GET /api/progress
//
// Batches the data the new dashboard needs in one round-trip:
//   - benchmarks rows for the user's experience level
//   - personal records (latest 3) — uses existing get_personal_records RPC
//   - streak counts (computed from workout_logs.performed_at)
//   - recent sessions (latest 10 across modalities)
//
// Sub-sections that need new server logic (lift 1RM small multiples, range
// plot, cardio HR zones, training load) return null + a `coming_soon: true`
// flag — the client renders a placeholder for those.

import { supabaseAdmin } from "../lib/clients.js";

function periodToDays(period) {
  switch (String(period || "month").toLowerCase()) {
    case "week":  return 7;
    case "3m":    return 90;
    case "year":  return 365;
    case "month":
    default:      return 30;
  }
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function loadBenchmarks(experience) {
  if (!supabaseAdmin || !experience) return [];
  const { data, error } = await supabaseAdmin
    .from("benchmarks")
    .select("metric, experience, sex, low, high, label, source_citation")
    .eq("experience", experience);
  if (error) {
    if (/relation .* does not exist/i.test(String(error.message || ""))) return [];
    return [];
  }
  return data || [];
}

async function loadProfileExperience(userId) {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("experience_level, body_weight_kg")
    .eq("id", userId)
    .maybeSingle();
  return data || null;
}

async function loadPRs(userId, days) {
  const start = isoDaysAgo(days);
  const end = isoDaysAgo(0);
  try {
    const { data, error } = await supabaseAdmin.rpc("get_personal_records", {
      p_user_id: userId, p_range_start: start, p_range_end: end,
    });
    if (error) throw error;
    return Array.isArray(data) ? data.slice(0, 3) : [];
  } catch { return []; }
}

async function loadRecentSessions(userId, modality, limit = 10) {
  try {
    let query = supabaseAdmin
      .from("workout_sessions")
      .select("id, modality, title, started_at, ended_at, note")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (modality && modality !== "all") query = query.eq("modality", modality);
    const { data, error } = await query;
    if (error) {
      if (/relation .* does not exist/i.test(String(error.message || ""))) return [];
      throw error;
    }
    return data || [];
  } catch { return []; }
}

export function computeStreak(workoutDates, now = new Date()) {
  // workoutDates: array of YYYY-MM-DD strings (any order, may include duplicates).
  const dates = new Set(Array.isArray(workoutDates) ? workoutDates : []);
  if (!dates.size) {
    return { current: 0, longest_all_time: { days: 0, start_date: null, end_date: null }, total_active_2026: 0, this_month: { active: 0, total: 30, pct: 0 } };
  }
  const sorted = Array.from(dates).sort();
  // current streak
  let current = 0;
  const today = new Date(now); today.setHours(0,0,0,0);
  for (let i = 0; i < 365; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    if (dates.has(iso)) current += 1;
    else if (i === 0) {
      // Try yesterday before declaring streak broken (so logging a session today optional)
      const y = new Date(today); y.setDate(today.getDate() - 1);
      if (!dates.has(y.toISOString().slice(0, 10))) break;
    } else break;
  }
  // longest all-time
  let longest = { days: 0, start: null, end: null };
  let runStart = sorted[0]; let runDays = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const cur = new Date(sorted[i]);
    const diff = Math.round((cur - prev) / 86400000);
    if (diff === 1) {
      runDays += 1;
    } else if (diff > 1) {
      if (runDays > longest.days) longest = { days: runDays, start: runStart, end: sorted[i - 1] };
      runStart = sorted[i]; runDays = 1;
    }
  }
  if (runDays > longest.days) longest = { days: runDays, start: runStart, end: sorted[sorted.length - 1] };

  const yearPrefix = String(now.getFullYear());
  const totalThisYear = sorted.filter((d) => d.startsWith(yearPrefix)).length;

  const monthPrefix = `${yearPrefix}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthActive = sorted.filter((d) => d.startsWith(monthPrefix)).length;
  const monthTotal = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  return {
    current,
    longest_all_time: { days: longest.days, start_date: longest.start, end_date: longest.end },
    total_active_2026: totalThisYear,
    this_month: { active: monthActive, total: monthTotal, pct: Math.round((monthActive / monthTotal) * 100) },
  };
}

async function loadStreak(userId, days = 365) {
  try {
    const { data, error } = await supabaseAdmin
      .from("workout_logs")
      .select("performed_at")
      .eq("user_id", userId)
      .gte("performed_at", isoDaysAgo(days));
    if (error) throw error;
    const dates = (data || []).map((r) => r.performed_at);
    return computeStreak(dates);
  } catch { return computeStreak([]); }
}

export default async function progressHandler(req, res) {
  if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });
  const userId = req.verifiedUserId;
  if (!userId) return res.status(401).json({ error: "Auth required." });

  const modality = String(req.query?.modality || "all").toLowerCase();
  const period = String(req.query?.period || "month").toLowerCase();
  const days = periodToDays(period);

  try {
    const profile = await loadProfileExperience(userId);
    const [benchmarks, prs, sessions, streak] = await Promise.all([
      loadBenchmarks(profile?.experience_level),
      loadPRs(userId, days),
      loadRecentSessions(userId, modality, 10),
      loadStreak(userId),
    ]);

    res.setHeader("Cache-Control", "private, max-age=60");
    res.json({
      modality,
      period,
      benchmarks,
      personal_records: prs,
      lift_1rm: { items: [], coming_soon: true },
      lift_range: { items: [], coming_soon: true },
      cardio_zones: { items: [], coming_soon: true },
      training_load: { items: [], coming_soon: true, current_ratio: null },
      streak,
      recent_sessions: sessions,
    });
  } catch (err) {
    console.error("progress orchestrator error", err);
    res.status(500).json({ error: "Could not load progress data." });
  }
}
