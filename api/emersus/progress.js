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
    .select("experience_level, body_weight_kg, biological_sex, date_of_birth")
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

const MOMENTUM_EXERCISE_SLUGS = ["bench-press", "back-squat", "deadlift"];
const MOMENTUM_EXERCISE_NAMES = {
  "bench-press": "Bench Press",
  "back-squat": "Back Squat",
  "deadlift": "Deadlift",
};
const MOMENTUM_WEEKS = 12;

function epley1RM(loadKg, reps) {
  const l = Number(loadKg) || 0;
  const r = Number(reps) || 0;
  if (l <= 0 || r <= 0) return 0;
  return l * (1 + r / 30);
}

function weekIndexFromDate(isoDate, endDate) {
  const d = new Date(isoDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  const daysAgo = Math.floor((end - d) / 86400000);
  const weeksAgo = Math.floor(daysAgo / 7);
  return Math.max(0, MOMENTUM_WEEKS - 1 - weeksAgo);
}

async function loadMomentumCards(userId, profile) {
  if (!supabaseAdmin) return { items: [] };
  const endDate = isoDaysAgo(0);
  const startDate = isoDaysAgo(MOMENTUM_WEEKS * 7);

  const { data: exs } = await supabaseAdmin
    .from("exercises")
    .select("id, slug, name")
    .in("slug", MOMENTUM_EXERCISE_SLUGS);
  const idBySlug = {};
  for (const e of (exs || [])) idBySlug[e.slug] = e.id;

  const exerciseIds = Object.values(idBySlug);
  if (!exerciseIds.length) return { items: [] };

  const { data: logs } = await supabaseAdmin
    .from("workout_logs")
    .select("exercise_id, performed_at, load_kg, reps, rpe")
    .eq("user_id", userId)
    .in("exercise_id", exerciseIds)
    .gte("performed_at", startDate)
    .lte("performed_at", endDate)
    .order("performed_at", { ascending: true });

  const byExerciseId = {};
  for (const log of (logs || [])) {
    if (!byExerciseId[log.exercise_id]) byExerciseId[log.exercise_id] = [];
    byExerciseId[log.exercise_id].push(log);
  }

  const items = [];
  for (const slug of MOMENTUM_EXERCISE_SLUGS) {
    const exId = idBySlug[slug];
    const exLogs = exId ? (byExerciseId[exId] || []) : [];

    if (!exLogs.length) {
      items.push({
        slug,
        name: MOMENTUM_EXERCISE_NAMES[slug],
        current_e1rm_kg: 0,
        period_weeks: MOMENTUM_WEEKS,
        last_set: null,
        sparkline: [],
        pr_weeks: [],
        momentum_kg: 0,
        momentum_label: "flat",
        benchmark: null,
      });
      continue;
    }

    const weeklyMax = new Array(MOMENTUM_WEEKS).fill(0);
    for (const log of exLogs) {
      const wi = weekIndexFromDate(log.performed_at, endDate);
      const e1 = epley1RM(log.load_kg, log.reps);
      if (e1 > weeklyMax[wi]) weeklyMax[wi] = e1;
    }
    let last = 0;
    const sparkline = weeklyMax.map((v) => {
      if (v > 0) last = v;
      return Math.round(last * 10) / 10;
    });

    const current = sparkline[sparkline.length - 1];
    const fourWeeksAgo = sparkline[Math.max(0, sparkline.length - 5)];
    const momentum = Math.round((current - fourWeeksAgo) * 10) / 10;
    const pct = fourWeeksAgo > 0 ? Math.abs(momentum) / fourWeeksAgo : 0;
    let momentum_label;
    if (pct < 0.02) momentum_label = "flat";
    else if (momentum > 0) momentum_label = "up";
    else momentum_label = "down";

    const pr_weeks = [];
    let runningMax = 0;
    for (let i = 0; i < sparkline.length; i++) {
      if (sparkline[i] > runningMax) {
        runningMax = sparkline[i];
        if (i > 0) pr_weeks.push(i);
      } else if (sparkline[i] > 0 && runningMax === 0) {
        runningMax = sparkline[i];
      }
    }

    const lastLog = exLogs[exLogs.length - 1];
    const last_set = {
      load_kg: Number(lastLog.load_kg) || 0,
      reps: Number(lastLog.reps) || 0,
      rpe: lastLog.rpe != null ? Number(lastLog.rpe) : null,
    };

    items.push({
      slug,
      name: MOMENTUM_EXERCISE_NAMES[slug],
      current_e1rm_kg: Math.round(current * 10) / 10,
      period_weeks: MOMENTUM_WEEKS,
      last_set,
      sparkline,
      pr_weeks,
      momentum_kg: momentum,
      momentum_label,
      benchmark: null,
    });
  }

  const experience = profile?.experience_level || "intermediate";
  const sex = profile?.biological_sex || "male";
  const metricSlugBySlug = {
    "bench-press": "bench_press_1rm",
    "back-squat": "back_squat_1rm",
    "deadlift": "deadlift_1rm",
  };
  const { data: benchRows } = await supabaseAdmin
    .from("benchmarks")
    .select("metric, low, high")
    .eq("experience", experience)
    .eq("sex", sex)
    .in("metric", Object.values(metricSlugBySlug));
  const benchByMetric = {};
  for (const r of (benchRows || [])) benchByMetric[r.metric] = r;
  for (const it of items) {
    const b = benchByMetric[metricSlugBySlug[it.slug]];
    if (b) it.benchmark = { low_kg: Number(b.low) || 0, high_kg: Number(b.high) || 0, level: experience };
  }

  return { items };
}

const BEESWARM_WEEKS = 8;
const BEESWARM_EXERCISE_SLUG = "bench-press";

async function loadBeeswarm(userId) {
  if (!supabaseAdmin) return null;
  const endDate = isoDaysAgo(0);
  const startDate = isoDaysAgo(BEESWARM_WEEKS * 7);

  const { data: ex } = await supabaseAdmin
    .from("exercises")
    .select("id, name")
    .eq("slug", BEESWARM_EXERCISE_SLUG)
    .maybeSingle();
  if (!ex) return null;

  const { data: logs } = await supabaseAdmin
    .from("workout_logs")
    .select("performed_at, load_kg, reps, rpe")
    .eq("user_id", userId)
    .eq("exercise_id", ex.id)
    .gte("performed_at", startDate)
    .lte("performed_at", endDate)
    .order("performed_at", { ascending: true });

  if (!logs || logs.length === 0) return null;

  const { data: allLogs } = await supabaseAdmin
    .from("workout_logs")
    .select("load_kg, reps")
    .eq("user_id", userId)
    .eq("exercise_id", ex.id)
    .order("load_kg", { ascending: false })
    .limit(1);
  const prLoadKg = allLogs && allLogs[0] ? Number(allLogs[0].load_kg) || 0 : 0;

  // weekIndexFromDate from Task 2 uses MOMENTUM_WEEKS. We need BEESWARM_WEEKS here,
  // so compute week_idx locally.
  const endTs = new Date(endDate + "T00:00:00").getTime();
  const sets = logs.map((log) => {
    const dTs = new Date(log.performed_at + "T00:00:00").getTime();
    const daysAgo = Math.floor((endTs - dTs) / 86400000);
    const weeksAgo = Math.floor(daysAgo / 7);
    const week_idx = Math.max(0, BEESWARM_WEEKS - 1 - weeksAgo);
    return {
      week_idx: Math.min(week_idx, BEESWARM_WEEKS - 1),
      load_kg: Number(log.load_kg) || 0,
      reps: Number(log.reps) || 0,
      rpe: log.rpe != null ? Number(log.rpe) : null,
      performed_at: log.performed_at,
      is_pr: false,
    };
  });
  for (const s of sets) {
    if (prLoadKg > 0 && s.load_kg >= prLoadKg) s.is_pr = true;
  }

  return {
    exercise_slug: BEESWARM_EXERCISE_SLUG,
    exercise_name: ex.name,
    weeks: BEESWARM_WEEKS,
    sets,
    pr_load_kg: prLoadKg,
    total_sets: sets.length,
  };
}

const ZONE_WEEKS = 8;

function hrZoneFromHr(avgHr, maxHr, restHr = 60) {
  if (!avgHr || !maxHr || maxHr <= restHr) return null;
  const pct = (avgHr - restHr) / (maxHr - restHr);
  if (pct < 0.60) return 1;
  if (pct < 0.70) return 2;
  if (pct < 0.80) return 3;
  if (pct < 0.90) return 4;
  return 5;
}

function ageFromDob(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const ms = Date.now() - birth.getTime();
  return Math.floor(ms / (365.25 * 86400000));
}

function classifyZonePattern(totals) {
  const total = totals.z1 + totals.z2 + totals.z3 + totals.z4 + totals.z5;
  if (total === 0) return { key: "mixed", label: "Mixed" };
  const pct = {
    z1: totals.z1 / total,
    z2: totals.z2 / total,
    z3: totals.z3 / total,
    z4: totals.z4 / total,
    z5: totals.z5 / total,
  };
  if (pct.z1 >= 0.80) return { key: "base_building", label: "Base building" };
  if (pct.z1 >= 0.55 && (pct.z4 + pct.z5) >= 0.15 && (pct.z2 + pct.z3) <= 0.20) {
    return { key: "polarized", label: "Polarized pattern" };
  }
  if (pct.z3 >= 0.30) return { key: "threshold", label: "Threshold pattern" };
  if (pct.z2 >= 0.40) return { key: "zone_2_heavy", label: "Zone 2 heavy" };
  return { key: "mixed", label: "Mixed" };
}

async function loadZoneRiver(userId, profile) {
  if (!supabaseAdmin) return null;
  const endDate = isoDaysAgo(0);
  const startDate = isoDaysAgo(ZONE_WEEKS * 7);

  const age = ageFromDob(profile?.date_of_birth);
  const maxHr = age ? (220 - age) : 190;
  const hrEstimateNote = age ? null : "Age unknown — zones estimated";

  const { data: logs } = await supabaseAdmin
    .from("workout_logs")
    .select("performed_at, avg_heart_rate, duration_seconds")
    .eq("user_id", userId)
    .not("avg_heart_rate", "is", null)
    .gt("duration_seconds", 0)
    .gte("performed_at", startDate)
    .lte("performed_at", endDate);

  if (!logs || logs.length === 0) return null;

  const weeks = [];
  for (let i = 0; i < ZONE_WEEKS; i++) {
    weeks.push({ week_idx: i, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
  }
  const totals = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

  const endTs = new Date(endDate + "T00:00:00").getTime();
  for (const log of logs) {
    const dTs = new Date(log.performed_at + "T00:00:00").getTime();
    const daysAgo = Math.floor((endTs - dTs) / 86400000);
    const weeksAgo = Math.floor(daysAgo / 7);
    const wi = ZONE_WEEKS - 1 - weeksAgo;
    if (wi < 0 || wi >= ZONE_WEEKS) continue;

    const zone = hrZoneFromHr(Number(log.avg_heart_rate), maxHr);
    if (!zone) continue;
    const minutes = (Number(log.duration_seconds) || 0) / 60;
    weeks[wi][`z${zone}`] += minutes;
    totals[`z${zone}`] += minutes;
  }

  for (const w of weeks) {
    for (const k of ["z1", "z2", "z3", "z4", "z5"]) w[k] = Math.round(w[k]);
  }

  const pattern = classifyZonePattern(totals);

  return {
    weeks,
    pattern: pattern.key,
    pattern_label: pattern.label,
    hr_estimate_note: hrEstimateNote,
  };
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
    const [benchmarks, prs, sessions, streak, momentum_cards, beeswarm, zone_river] = await Promise.all([
      loadBenchmarks(profile?.experience_level),
      loadPRs(userId, days),
      loadRecentSessions(userId, modality, 10),
      loadStreak(userId),
      loadMomentumCards(userId, profile),
      loadBeeswarm(userId),
      loadZoneRiver(userId, profile),
    ]);

    res.setHeader("Cache-Control", "private, max-age=60");
    res.json({
      modality,
      period,
      benchmarks,
      personal_records: prs,
      momentum_cards,
      beeswarm,
      zone_river,
      training_load: { items: [], coming_soon: true, current_ratio: null },
      streak,
      recent_sessions: sessions,
    });
  } catch (err) {
    console.error("progress orchestrator error", err);
    res.status(500).json({ error: "Could not load progress data." });
  }
}
