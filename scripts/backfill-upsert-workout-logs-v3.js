// One-off: after the v3 upsert_workout_logs migration lands, re-trigger
// the RPC for every workout_plans row that already has completed_blocks
// populated. v2's Done-filter + reps-cast bugs meant every pre-v3 session
// was silently dropped from workout_logs; this script replays them through
// the new function so the Progress page reflects reality.
//
// Usage: node scripts/backfill-upsert-workout-logs-v3.js [--dry]
//
// Safe to re-run — upsert_workout_logs DELETEs then re-INSERTs for the
// (user_id, plan_id, session_id) key before inserting new rows.

import "dotenv/config";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";

config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.local") });

const DRY = process.argv.includes("--dry");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}
const sb = createClient(url, key);

function inferCategoryFromBlock(cb) {
  if (cb.routes) return "climbing";
  if (cb.lap_count != null || cb.pool_length_m != null) return "swimming";
  if (cb.gps_path || cb.activity_type || cb.total_distance_m != null) return "cardio";
  if (cb.actual_sets) return "resistance";
  return null;
}

async function main() {
  console.log(DRY ? "DRY RUN — will not call RPC" : "LIVE — will call upsert_workout_logs for each session");
  console.log("");

  // Pull every plan; we'll filter client-side for sessions with logged data.
  // The page size is small enough that a single SELECT works.
  const { data: plans, error } = await sb
    .from("workout_plans")
    .select("id, user_id, title, plan")
    .is("archived_at", null);
  if (error) {
    console.error("fetch failed:", error);
    process.exit(2);
  }

  let totalSessions = 0;
  let totalInserted = 0;
  let totalFailed = 0;

  for (const row of plans) {
    const sessions = row.plan?.sessions || [];
    for (const session of sessions) {
      const completed = session.completed_blocks || [];
      if (completed.length === 0) continue;
      const hasData = completed.some(cb =>
        (cb.actual_sets || []).some(set => set.reps || set.load || set.done) ||
        cb.gps_path || cb.routes || cb.lap_count != null
      );
      if (!hasData) continue;

      // Enrich each block with exercise_name + block_category (mirrors
      // shared/supabase.js upsertWorkoutLogs so the RPC sees the same
      // payload the client would send).
      const blocks = completed.map(cb => {
        const planBlock =
          (session.blocks || []).find(b => b.id === cb.block_id) ||
          (session.warmup_blocks || []).find(b => b.id === cb.block_id);
        return {
          ...cb,
          exercise_name: planBlock?.name || "",
          block_category:
            session.category ||
            planBlock?.category ||
            inferCategoryFromBlock(cb) ||
            "resistance",
        };
      }).filter(b => b.exercise_name);

      if (blocks.length === 0) continue;

      const performedAt = session.date || new Date().toISOString().slice(0, 10);
      totalSessions += 1;

      if (DRY) {
        console.log(
          `[dry] ${row.title} / ${session.id} (${session.title || ""}) — ${blocks.length} blocks`
        );
        continue;
      }

      // The RPC has an auth.uid() guard, so a pure service-role call will
      // fail. We have to set the JWT claim for the impersonated user via
      // Supabase's admin helpers. The simplest route: call the RPC via
      // postgrest with the user_id embedded in the JWT. Since we run this
      // from a trusted backfill context, we use supabase.auth.admin to
      // generate a short-lived token for each user and then call the RPC
      // as that user. This avoids changing the RPC's auth guard.
      //
      // For a one-off script we skip the JWT dance entirely by running the
      // RPC with SECURITY DEFINER under the supabase_admin role via a raw
      // REST call carrying the service key. Instead of that, just bypass
      // the RPC entirely and DELETE+INSERT directly — we have the same
      // data the RPC would compute and the service role has full table
      // access.
      try {
        // Strategy: emulate what the v3 RPC does in JS since service-role
        // calls would fail the auth.uid() guard. This is safe because
        // we're running with the SERVICE_ROLE_KEY which bypasses RLS.
        await replayLikeV3({
          userId: row.user_id,
          planId: row.id,
          sessionId: session.id,
          performedAt,
          blocks,
        });
        totalInserted += 1;
        console.log(
          `[ok]  ${row.title} / ${session.id} (${session.title || ""}) — replayed ${blocks.length} blocks`
        );
      } catch (e) {
        totalFailed += 1;
        console.error(
          `[err] ${row.title} / ${session.id}:`,
          e.message || e
        );
      }
    }
  }

  console.log("");
  console.log("sessions considered:", totalSessions);
  console.log("sessions replayed  :", totalInserted);
  console.log("sessions failed    :", totalFailed);
}

// ── v3-equivalent replay, executed as service role ───────────────────────
// We can't call the RPC because its auth.uid() guard rejects service-role
// calls. But the service role has full DML on workout_logs (bypasses RLS),
// so we do exactly what the RPC does: DELETE existing rows for the session,
// then INSERT the extracted/clamped values. Mirrors the v3 SQL 1:1.

async function resolveExerciseId(name) {
  // Try exact match first, then case-insensitive, then fall back to the
  // "Unknown exercise" catalog entry (id = null → skip).
  const { data: exact } = await sb
    .from("exercises")
    .select("id")
    .eq("name", name)
    .limit(1);
  if (exact && exact.length) return exact[0].id;

  const { data: ci } = await sb
    .from("exercises")
    .select("id")
    .ilike("name", name)
    .limit(1);
  if (ci && ci.length) return ci[0].id;

  // Try aliases table
  const { data: alias } = await sb
    .from("exercise_aliases")
    .select("exercise_id")
    .eq("alias", name.toLowerCase())
    .limit(1);
  if (alias && alias.length) return alias[0].exercise_id;

  return null;
}

function extractInt(s) {
  if (s == null) return null;
  const m = String(s).trim().match(/^[0-9]+/);
  return m ? parseInt(m[0], 10) : null;
}
function extractNum(s) {
  if (s == null) return null;
  const m = String(s).trim().match(/^[0-9]+\.?[0-9]*/);
  if (!m || m[0] === "") return null;
  const num = parseFloat(m[0]);
  return isNaN(num) ? null : num;
}

async function replayLikeV3({ userId, planId, sessionId, performedAt, blocks }) {
  // 1. Delete existing logs for this session (idempotent re-run).
  const { error: delErr } = await sb
    .from("workout_logs")
    .delete()
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .eq("session_id", sessionId);
  if (delErr) throw delErr;

  // 2. For each block, insert rows per the v3 logic.
  const rows = [];
  for (const block of blocks) {
    const exId = await resolveExerciseId(block.exercise_name);
    if (!exId) continue;

    const category = block.block_category;
    if (category === "cardio") {
      rows.push({
        user_id: userId,
        exercise_id: exId,
        plan_id: planId,
        session_id: sessionId,
        performed_at: performedAt,
        duration_seconds: block.duration_seconds ?? null,
        distance_meters: block.total_distance_m ?? null,
        activity_type: block.activity_type ?? null,
        gps_path: block.gps_path ?? null,
        notes: block.session_notes ?? null,
      });
      continue;
    }
    if (category === "swimming") {
      rows.push({
        user_id: userId,
        exercise_id: exId,
        plan_id: planId,
        session_id: sessionId,
        performed_at: performedAt,
        duration_seconds: block.duration_seconds ?? null,
        distance_meters:
          block.total_distance_m ??
          (Number(block.lap_count) * Number(block.pool_length_m) || null),
        activity_type: "swimming_" + (block.stroke_type || "freestyle"),
        detail: {
          pool_length_m: block.pool_length_m ?? null,
          lap_count: block.lap_count ?? null,
          stroke_type: block.stroke_type ?? null,
          lap_splits: block.lap_splits ?? [],
        },
        notes: block.session_notes ?? null,
      });
      continue;
    }
    if (category === "climbing") {
      rows.push({
        user_id: userId,
        exercise_id: exId,
        plan_id: planId,
        session_id: sessionId,
        performed_at: performedAt,
        duration_seconds: block.duration_seconds ?? null,
        activity_type: block.style || "bouldering",
        detail: { style: block.style ?? null, routes: block.routes ?? [] },
        notes: block.session_notes ?? null,
      });
      continue;
    }

    // Resistance / bodyweight
    let setNum = 0;
    for (const set of (block.actual_sets || [])) {
      const reps = extractInt(set.reps);
      const load = extractNum(set.load);
      let rpe = extractNum(set.rpe);
      if (rpe != null) rpe = Math.max(0, Math.min(10, rpe));
      if (reps === null && load === null) continue;
      setNum += 1;
      rows.push({
        user_id: userId,
        exercise_id: exId,
        plan_id: planId,
        session_id: sessionId,
        performed_at: performedAt,
        set_number: setNum,
        reps,
        load_kg: load,
        rpe,
        notes: (set.notes && String(set.notes).trim()) || null,
      });
    }
  }

  if (rows.length === 0) return 0;
  const { error: insErr } = await sb.from("workout_logs").insert(rows);
  if (insErr) throw insErr;
  return rows.length;
}

main().catch(e => {
  console.error("fatal:", e);
  process.exit(1);
});
