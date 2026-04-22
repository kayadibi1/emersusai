// jobs/auto-close-empty-workout-sessions.js
//
// Closes workout_sessions left open with NOTHING logged for more than
// THRESHOLD_MINUTES. "Nothing logged" = no rows in workout_logs for that
// session_id (sets live in workout_logs, not the exercises JSONB column on
// workout_sessions).
//
// Sessions with at least one logged set are left alone — a partially-logged
// session may still be in progress (long workouts, supersets with phone breaks,
// etc.). Empty sessions older than 1h are almost always abandoned starts.
//
// Sets ended_at = now() + note = '[auto-closed: empty session]' so the row
// stays visible in history. Non-destructive: never deletes.
//
// Payload: { dryRun?: boolean, thresholdMinutes?: number, limit?: number }
// Defaults: { dryRun: false, thresholdMinutes: 60, limit: 500 }
// Returns: { closed, scanned, dryRun, cutoffIso, thresholdMinutes }

const DEFAULT_THRESHOLD_MINUTES = 60;
const DEFAULT_LIMIT = 500;
const AUTO_CLOSE_NOTE = "[auto-closed: empty session]";

export async function autoCloseEmptyWorkoutSessionsHandler(ctx, deps) {
  const {
    dryRun = false,
    thresholdMinutes = DEFAULT_THRESHOLD_MINUTES,
    limit = DEFAULT_LIMIT,
  } = ctx.data || {};
  const { sql } = deps;

  await ctx.progress(`empty-session sweep start (dryRun=${dryRun}, threshold=${thresholdMinutes}min, limit=${limit})`);

  const cutoffIso = new Date().toISOString();

  const countRows = await sql`
    SELECT count(*)::int AS n
    FROM public.workout_sessions ws
    WHERE ws.ended_at IS NULL
      AND ws.started_at < now() - (${thresholdMinutes} || ' minutes')::interval
      AND NOT EXISTS (
        SELECT 1 FROM public.workout_logs wl WHERE wl.session_id = ws.id::text
      )
  `;
  const scanned = countRows.rows?.[0]?.n ?? 0;

  if (scanned === 0) {
    await ctx.progress(`nothing to close at ${cutoffIso}`);
    return { closed: 0, scanned: 0, dryRun, cutoffIso, thresholdMinutes };
  }

  if (dryRun) {
    await ctx.progress(`dry run — would close ${scanned} sessions`);
    return { closed: 0, scanned, dryRun: true, cutoffIso, thresholdMinutes };
  }

  const result = await sql`
    WITH doomed AS (
      SELECT ws.id
      FROM public.workout_sessions ws
      WHERE ws.ended_at IS NULL
        AND ws.started_at < now() - (${thresholdMinutes} || ' minutes')::interval
        AND NOT EXISTS (
          SELECT 1 FROM public.workout_logs wl WHERE wl.session_id = ws.id::text
        )
      ORDER BY ws.started_at ASC
      LIMIT ${limit}
    )
    UPDATE public.workout_sessions ws
    SET ended_at = now(),
        note = ${AUTO_CLOSE_NOTE},
        updated_at = now()
    FROM doomed d
    WHERE ws.id = d.id
    RETURNING ws.id
  `;
  const closed = result.rowCount ?? result.rows?.length ?? 0;

  await ctx.progress(`closed ${closed} of ${scanned} empty sessions`);
  return { closed, scanned, dryRun, cutoffIso, thresholdMinutes };
}
