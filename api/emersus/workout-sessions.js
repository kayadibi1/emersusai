// api/emersus/workout-sessions.js — Phase 3 Train REST router.
//
//   GET    /api/workout-sessions/:id            — full session + sets joined
//   GET    /api/workout-sessions?modality=lift  — paginated list (current user)
//   POST   /api/workout-sessions { modality }   — create
//   PATCH  /api/workout-sessions/:id { ... }    — title/ended_at/note/modality/exercises
//
// Requires supabase/20260420_workout_sessions.sql to be applied. Uses
// supabaseAdmin server-side with RLS-aware uid filters.

import express from "express";
import { supabaseAdmin } from "../lib/clients.js";
import { requireAuth } from "./auth-middleware.js";

const MODALITIES = new Set(["lift", "cardio", "swim", "climb"]);
const MAX_TITLE = 200;
const MAX_NOTE = 4000;
const MAX_EXERCISES = 200;

export function validateSessionPatch(body) {
  if (!body || typeof body !== "object") return { error: "Body must be an object." };
  const out = {};
  if (body.title !== undefined) {
    out.title = body.title === null ? null : String(body.title).slice(0, MAX_TITLE);
  }
  if (body.modality !== undefined) {
    if (!MODALITIES.has(body.modality)) return { error: `modality must be one of ${[...MODALITIES].join(", ")}` };
    out.modality = body.modality;
  }
  if (body.ended_at !== undefined) {
    if (body.ended_at === null) out.ended_at = null;
    else {
      const d = new Date(body.ended_at);
      if (Number.isNaN(d.getTime())) return { error: "ended_at must be a valid timestamp" };
      out.ended_at = d.toISOString();
    }
  }
  if (body.note !== undefined) {
    out.note = body.note === null ? null : String(body.note).slice(0, MAX_NOTE);
  }
  if (body.exercises !== undefined) {
    if (!Array.isArray(body.exercises)) return { error: "exercises must be an array" };
    out.exercises = body.exercises.slice(0, MAX_EXERCISES);
  }
  if (body.source_thread_id !== undefined) out.source_thread_id = body.source_thread_id || null;
  if (body.source_workout_plan_id !== undefined) out.source_workout_plan_id = body.source_workout_plan_id || null;
  return { patch: out };
}

export function buildListQuery(params = {}) {
  const out = {
    modality: MODALITIES.has(params.modality) ? params.modality : null,
    limit: Math.max(1, Math.min(Number(params.limit) || 50, 200)),
    offset: Math.max(0, Number(params.offset) || 0),
  };
  return out;
}

export default function workoutSessionsRouter() {
  const router = express.Router();

  router.get("/", requireAuth, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });
    const { modality, limit, offset } = buildListQuery(req.query);
    let query = supabaseAdmin
      .from("workout_sessions")
      .select("*")
      .eq("user_id", req.verifiedUserId)
      .order("started_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (modality) query = query.eq("modality", modality);
    const { data, error } = await query;
    if (error) {
      console.error("workout-sessions list error", error);
      return res.status(500).json({ error: "Could not load sessions." });
    }
    res.json({ items: data || [], limit, offset });
  });

  router.get("/:id", requireAuth, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });
    const { data: session, error } = await supabaseAdmin
      .from("workout_sessions")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", req.verifiedUserId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: "Could not load session." });
    if (!session) return res.status(404).json({ error: "Session not found." });

    // Join the per-set rows from workout_logs.
    const { data: sets, error: setsError } = await supabaseAdmin
      .from("workout_logs")
      .select("*")
      .eq("user_id", req.verifiedUserId)
      .eq("session_id", session.id)
      .order("created_at", { ascending: true });
    if (setsError) return res.status(500).json({ error: "Could not load sets." });

    res.json({ ...session, sets: sets || [] });
  });

  router.post("/", requireAuth, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });
    const body = req.body || {};
    if (!MODALITIES.has(body.modality)) {
      return res.status(400).json({ error: "modality is required." });
    }
    const insert = {
      user_id: req.verifiedUserId,
      modality: body.modality,
      title: body.title ? String(body.title).slice(0, MAX_TITLE) : null,
      source_thread_id: body.source_thread_id || null,
      source_workout_plan_id: body.source_workout_plan_id || null,
      exercises: Array.isArray(body.exercises) ? body.exercises.slice(0, MAX_EXERCISES) : [],
    };
    const { data, error } = await supabaseAdmin
      .from("workout_sessions")
      .insert(insert)
      .select("*")
      .single();
    if (error) {
      console.error("workout-sessions create error", error);
      return res.status(500).json({ error: "Could not create session." });
    }
    res.status(201).json(data);
  });

  router.patch("/:id", requireAuth, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });
    const validation = validateSessionPatch(req.body);
    if (validation.error) return res.status(400).json({ error: validation.error });
    if (Object.keys(validation.patch).length === 0) {
      return res.status(400).json({ error: "Empty patch." });
    }
    const { data, error } = await supabaseAdmin
      .from("workout_sessions")
      .update({ ...validation.patch, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .eq("user_id", req.verifiedUserId)
      .select("*")
      .maybeSingle();
    if (error) {
      console.error("workout-sessions patch error", error);
      return res.status(500).json({ error: "Could not save session." });
    }
    if (!data) return res.status(404).json({ error: "Session not found." });
    res.json(data);
  });

  return router;
}
