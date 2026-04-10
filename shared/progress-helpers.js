// Supabase RPC wrappers for progress pages.
// Thin layer over supabase.rpc() — handles auth and date range defaults.

import { getSupabase, getSession } from "/shared/supabase.js";

export async function fetchDashboard(userId, rangeStart, rangeEnd) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_progress_dashboard", {
    p_user_id: userId,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
  });
  if (error) throw error;
  return data;
}

export async function fetchWeeklyActivity(userId, rangeStart, rangeEnd) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_weekly_activity", {
    p_user_id: userId,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchMuscleVolume(userId, rangeStart, rangeEnd) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_muscle_volume", {
    p_user_id: userId,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchRecentSessions(userId, limit = 10) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_recent_sessions", {
    p_user_id: userId,
    p_limit: limit,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchTopExercises(userId, rangeStart, rangeEnd, limit = 10) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_top_exercises", {
    p_user_id: userId,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
    p_limit: limit,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchExerciseHistory(userId, exerciseId, limit = 20) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_exercise_history", {
    p_user_id: userId,
    p_exercise_id: exerciseId,
    p_limit: limit,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchSessionDetail(userId, planId, sessionId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_session_detail", {
    p_user_id: userId,
    p_plan_id: planId,
    p_session_id: sessionId,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchPersonalRecords(userId, rangeStart, rangeEnd) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_personal_records", {
    p_user_id: userId,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
  });
  if (error) throw error;
  return data || [];
}

export async function fetchExerciseBySlug(slug) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("exercises")
    .select("id,slug,name,aliases,muscle_groups,equipment,category,movement_type")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Date range helpers ──────────────────────────────────────────────

export function dateRange(weeks) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - weeks * 7);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
