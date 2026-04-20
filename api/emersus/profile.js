// api/emersus/profile.js
//
// GET  /api/profile        — full row (current user) + computed fields
// PATCH /api/profile { ... } — partial update with allowlist + bounds
//
// Phase 6 of the redesign. The chat-driven onboarding flow continues to work
// against this same row; the v2 UI just gives explicit edit controls.

import { supabaseAdmin } from "../lib/clients.js";
import { requireAuth } from "./auth-middleware.js";
import express from "express";

const ALLOWED_GOAL = ["hypertrophy", "strength", "endurance", "general", "hybrid"];
const ALLOWED_EXPERIENCE = ["beginner", "intermediate", "advanced"];
const ALLOWED_TRAINING_ENV = ["home", "commercial", "outdoor", "mixed"];
const ALLOWED_WEIGHT_UNIT = ["kg", "lbs"];
const ALLOWED_DISTANCE_UNIT = ["km", "mi"];

// Free-text profile fields returned to the model via get_user_profile.
// Capped to bound prompt-injection payload size. The model-facing trust
// boundary (user_profile_untrusted wrapper + system-prompt rule) is the
// actual injection defense; these caps are defense-in-depth.
const FREE_TEXT_FIELD_MAX = 500;
const FREE_TEXT_FIELDS = [
  "injuries_limitations",
  "equipment_access",
  "dietary_preferences",
  "primary_use_case",
  "sleep_stress_context",
];

// Whitelist for the arbitrary preferences JSONB column. Unknown keys are
// rejected; string values get length-capped to FREE_TEXT_FIELD_MAX.
const ALLOWED_PREFERENCE_KEYS = {
  memory_autosave: "boolean",
  metric_units:    "boolean",
};

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

export function validateProfilePatch(body) {
  if (!body || typeof body !== "object") return { error: "Body must be an object." };
  const out = {};

  if (body.full_name !== undefined) {
    out.full_name = String(body.full_name || "").slice(0, 120);
  }
  if (body.goal !== undefined) {
    if (body.goal === null) out.goal = null;
    else if (!ALLOWED_GOAL.includes(body.goal)) return { error: `goal must be one of ${ALLOWED_GOAL.join(", ")}` };
    else out.goal = body.goal;
  }
  if (body.experience_level !== undefined) {
    if (body.experience_level === null) out.experience_level = null;
    else if (!ALLOWED_EXPERIENCE.includes(body.experience_level))
      return { error: `experience_level must be one of ${ALLOWED_EXPERIENCE.join(", ")}` };
    else out.experience_level = body.experience_level;
  }
  if (body.training_env !== undefined) {
    if (body.training_env === null) out.training_env = null;
    else if (!ALLOWED_TRAINING_ENV.includes(body.training_env))
      return { error: `training_env must be one of ${ALLOWED_TRAINING_ENV.join(", ")}` };
    else out.training_env = body.training_env;
  }
  if (body.weight_unit !== undefined) {
    if (body.weight_unit === null) out.weight_unit = null;
    else if (!ALLOWED_WEIGHT_UNIT.includes(body.weight_unit))
      return { error: `weight_unit must be one of ${ALLOWED_WEIGHT_UNIT.join(", ")}` };
    else out.weight_unit = body.weight_unit;
  }
  if (body.distance_unit !== undefined) {
    if (body.distance_unit === null) out.distance_unit = null;
    else if (!ALLOWED_DISTANCE_UNIT.includes(body.distance_unit))
      return { error: `distance_unit must be one of ${ALLOWED_DISTANCE_UNIT.join(", ")}` };
    else out.distance_unit = body.distance_unit;
  }
  if (body.body_weight_kg !== undefined) {
    const v = clampNumber(body.body_weight_kg, 30, 300);
    if (v === null && body.body_weight_kg !== null) return { error: "body_weight_kg must be 30-300" };
    out.body_weight_kg = v;
  }
  if (body.target_weight_kg !== undefined) {
    const v = clampNumber(body.target_weight_kg, 30, 300);
    if (v === null && body.target_weight_kg !== null) return { error: "target_weight_kg must be 30-300" };
    out.target_weight_kg = v;
  }
  if (body.height_cm !== undefined) {
    const v = clampNumber(body.height_cm, 100, 250);
    if (v === null && body.height_cm !== null) return { error: "height_cm must be 100-250" };
    out.height_cm = v;
  }
  if (body.equipment !== undefined) {
    if (!Array.isArray(body.equipment)) return { error: "equipment must be an array" };
    out.equipment = body.equipment.slice(0, 100);
  }
  if (body.preferences !== undefined) {
    if (body.preferences === null || typeof body.preferences !== "object" || Array.isArray(body.preferences)) {
      return { error: "preferences must be an object" };
    }
    const prefs = {};
    for (const [k, v] of Object.entries(body.preferences)) {
      const expected = ALLOWED_PREFERENCE_KEYS[k];
      if (!expected) return { error: `preferences.${k} is not an allowed key` };
      if (v === null) { prefs[k] = null; continue; }
      if (expected === "boolean") {
        if (typeof v !== "boolean") return { error: `preferences.${k} must be a boolean` };
        prefs[k] = v;
      } else if (expected === "string") {
        if (typeof v !== "string") return { error: `preferences.${k} must be a string` };
        prefs[k] = v.slice(0, FREE_TEXT_FIELD_MAX);
      }
    }
    out.preferences = prefs;
  }

  for (const field of FREE_TEXT_FIELDS) {
    if (body[field] !== undefined) {
      if (body[field] === null) { out[field] = null; continue; }
      if (typeof body[field] !== "string") return { error: `${field} must be a string` };
      out[field] = body[field].slice(0, FREE_TEXT_FIELD_MAX);
    }
  }
  if (body.weekly_targets !== undefined) {
    if (typeof body.weekly_targets !== "object") return { error: "weekly_targets must be an object" };
    out.weekly_targets = body.weekly_targets;
  }
  if (body.reminders !== undefined) {
    if (typeof body.reminders !== "object") return { error: "reminders must be an object" };
    out.reminders = body.reminders;
  }
  if (body.macros !== undefined) {
    if (body.macros === null) {
      out.macros = null;
      out.macros_overridden_at = null;
    } else {
      if (typeof body.macros !== "object") return { error: "macros must be an object" };
      out.macros = body.macros;
      out.macros_overridden_at = new Date().toISOString();
    }
  }
  if (body.onboarding_completed !== undefined) {
    out.onboarding_completed = Boolean(body.onboarding_completed);
  }

  return { patch: out };
}

export function computeMacrosFromBodyWeight(bodyWeightKg) {
  const w = Number(bodyWeightKg);
  if (!Number.isFinite(w) || w <= 0) return null;
  const protein_g = Math.round(w * 1.8);
  const fat_g = Math.round(w * 0.9);
  const kcal = Math.round(w * 32);
  const carbs_g = Math.max(0, Math.round((kcal - protein_g * 4 - fat_g * 9) / 4));
  return { kcal, protein_g, carbs_g, fat_g };
}

function profileResponse(row) {
  const macros = row.macros ?? computeMacrosFromBodyWeight(row.body_weight_kg);
  return {
    ...row,
    macros,
    macros_default: !row.macros,
  };
}

export default function profileRouter() {
  const router = express.Router();

  router.get("/", requireAuth, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", req.verifiedUserId)
      .maybeSingle();
    if (error) {
      console.error("profile GET error", error);
      return res.status(500).json({ error: "Could not load profile." });
    }
    if (!data) return res.status(404).json({ error: "Profile not found." });
    res.json(profileResponse(data));
  });

  router.patch("/", requireAuth, async (req, res) => {
    if (!supabaseAdmin) return res.status(500).json({ error: "Backend unavailable." });
    const validation = validateProfilePatch(req.body);
    if (validation.error) return res.status(400).json({ error: validation.error });
    if (Object.keys(validation.patch).length === 0) {
      return res.status(400).json({ error: "Empty patch." });
    }

    // Auto-recompute macros on body_weight_kg change UNLESS user has overridden.
    if (validation.patch.body_weight_kg !== undefined) {
      const { data: existing } = await supabaseAdmin
        .from("profiles")
        .select("macros_overridden_at")
        .eq("id", req.verifiedUserId)
        .maybeSingle();
      if (!existing?.macros_overridden_at && validation.patch.macros === undefined) {
        const next = computeMacrosFromBodyWeight(validation.patch.body_weight_kg);
        if (next) validation.patch.macros = next;
      }
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update({ ...validation.patch, updated_at: new Date().toISOString() })
      .eq("id", req.verifiedUserId)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("profile PATCH error", error);
      return res.status(500).json({ error: "Could not save profile." });
    }
    res.json(profileResponse(data));
  });

  return router;
}
