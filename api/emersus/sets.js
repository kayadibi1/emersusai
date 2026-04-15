// api/emersus/sets.js — Phase 3 Train · POST /api/sets handler.
//
// Body: { session_id, exercise_id, weight_kg?, reps?, rpe?, duration_seconds?,
//         distance_meters?, notes?, set_number?, detail? }
//
// Inserts a row into workout_logs (existing table, RLS on). Returns the
// inserted row + a small session-totals delta the client can use to update
// the UI without a re-fetch.

import { supabaseAdmin } from "../lib/clients.js";

export function validateSetBody(body) {
  if (!body || typeof body !== "object") return { error: "Body must be an object." };
  if (!body.session_id) return { error: "session_id is required." };
  if (!body.exercise_id) return { error: "exercise_id is required." };
  const out = {
    session_id: String(body.session_id),
    exercise_id: String(body.exercise_id),
  };
  if (body.set_number !== undefined && body.set_number !== null) {
    const n = Number(body.set_number);
    if (!Number.isInteger(n) || n < 1 || n > 200) return { error: "set_number must be 1-200" };
    out.set_number = n;
  }
  if (body.reps !== undefined && body.reps !== null) {
    const n = Number(body.reps);
    if (!Number.isInteger(n) || n < 0 || n > 200) return { error: "reps must be 0-200" };
    out.reps = n;
  }
  if (body.weight_kg !== undefined && body.weight_kg !== null) {
    const n = Number(body.weight_kg);
    if (!Number.isFinite(n) || n < 0 || n > 999) return { error: "weight_kg must be 0-999" };
    out.load_kg = n;
  }
  if (body.rpe !== undefined && body.rpe !== null) {
    const n = Number(body.rpe);
    if (!Number.isFinite(n) || n < 1 || n > 10) return { error: "rpe must be 1-10" };
    out.rpe = n;
  }
  if (body.duration_seconds !== undefined && body.duration_seconds !== null) {
    const n = Number(body.duration_seconds);
    if (!Number.isFinite(n) || n < 0 || n > 86400) return { error: "duration_seconds must be 0-86400" };
    out.duration_seconds = Math.round(n);
  }
  if (body.distance_meters !== undefined && body.distance_meters !== null) {
    const n = Number(body.distance_meters);
    if (!Number.isFinite(n) || n < 0) return { error: "distance_meters must be >= 0" };
    out.distance_meters = n;
  }
  if (body.notes !== undefined) out.notes = body.notes ? String(body.notes).slice(0, 1000) : null;
  if (body.detail !== undefined && body.detail !== null) {
    if (typeof body.detail !== "object") return { error: "detail must be an object" };
    out.detail = body.detail;
  }
  return { row: out };
}

export default async function setsHandler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });

  const validation = validateSetBody(req.body);
  if (validation.error) return res.status(400).json({ error: validation.error });

  // Verify session ownership before insert.
  const { data: session, error: sessionError } = await supabaseAdmin
    .from("workout_sessions")
    .select("id,user_id")
    .eq("id", validation.row.session_id)
    .eq("user_id", req.verifiedUserId)
    .maybeSingle();
  if (sessionError) return res.status(500).json({ error: "Could not verify session." });
  if (!session) return res.status(404).json({ error: "Session not found." });

  const insert = {
    ...validation.row,
    user_id: req.verifiedUserId,
    performed_at: new Date().toISOString().slice(0, 10),
  };

  const { data: row, error } = await supabaseAdmin
    .from("workout_logs")
    .insert(insert)
    .select("*")
    .single();
  if (error) {
    console.error("sets insert error", error);
    return res.status(500).json({ error: "Could not log set." });
  }

  // Lightweight totals — count + sum for the session, skips deep stats.
  const { data: rows } = await supabaseAdmin
    .from("workout_logs")
    .select("reps,load_kg")
    .eq("user_id", req.verifiedUserId)
    .eq("session_id", validation.row.session_id);
  const totals = (rows || []).reduce(
    (acc, r) => {
      acc.set_count += 1;
      acc.volume_kg += (Number(r.reps) || 0) * (Number(r.load_kg) || 0);
      return acc;
    },
    { set_count: 0, volume_kg: 0 },
  );

  res.status(201).json({ row, totals });
}
