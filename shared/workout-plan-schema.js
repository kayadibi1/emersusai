// Workout-plan schema — the single source of truth.
//
// Imported by:
//   - shared/widget-fence-parser.js  (parses ```workout-plan fences)
//   - shared/react-chat-app.js       (renders WorkoutPlanCard)
//   - shared/workout-plan-ics.js     (generates the .ics file)
//   - shared/workout-plan-diff.js    (computes update previews)
//   - shared/supabase.js             (validates before upsert)
//   - app/workout/workout.js         (manual edits + display)
//
// Pure ESM, no DOM, no Node, no React — safe to import anywhere.
//
// Schema versioning is non-negotiable. If the shape ever needs to change,
// bump SCHEMA_VERSION, write a migration helper, and keep validatePlan
// accepting the old version until the migration runs against stored rows.

export const SCHEMA_VERSION = 1;

// Bumped independently of SCHEMA_VERSION so the logging shape can evolve
// without invalidating stored plans. Phase 1.5 ships v1; v2 would require
// a client-side migration helper similar to ensureBlockIds().
export const COMPLETED_BLOCK_SCHEMA_VERSION = 1;

export const GOALS = ["hypertrophy", "strength", "endurance", "general", "sport_specific"];
export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"];
export const COMPLETION_STATUSES = [null, "completed", "skipped", "missed"];

// Stable per-session id format. Used so the model can preserve identity
// across chat-driven edits, and so Phase 2 sync can map sessions to
// external calendar event ids without ambiguity.
export function createSessionId(week, dayOfWeek) {
  const w = Math.max(1, Math.floor(Number(week) || 0));
  const d = Math.max(1, Math.min(7, Math.floor(Number(dayOfWeek) || 0)));
  return `s_w${w}d${d}`;
}

// Stable per-block id format. Used so actual-set logging in Phase 1.5 can
// key its entries against a specific prescribed block and survive an
// exercise swap (the swap changes .name but keeps .id). Warmup blocks
// use the same helper but with a "w_" prefix via the caller — see
// ensureBlockIds below.
export function createBlockId(sessionId, index, prefix = "b") {
  return `${prefix}_${sessionId}_${index}`;
}

// Browser-side default timezone. Falls back to UTC if Intl is unavailable
// or returns garbage.
export function detectDefaultTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === "string") return tz;
  } catch (_) {
    // ignore
  }
  return "UTC";
}

// Reduces a session's blocks to a single human-readable description line.
// Used by the ICS exporter and the WorkoutPlanCard preview. Keep it short —
// long descriptions wrap badly in calendar apps.
export function summarizeBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => b && typeof b === "object" && b.name)
    .map((b) => {
      const setsReps = [b.sets, b.reps].filter(Boolean).join(" x ");
      const load = b.load ? ` @ ${b.load}` : "";
      const rpe = b.rpe ? ` RPE ${b.rpe}` : "";
      const rest = b.rest_seconds ? ` (rest ${b.rest_seconds}s)` : "";
      return `${b.name}: ${setsReps}${load}${rpe}${rest}`.trim();
    })
    .join("\n");
}

// Walks every session in the plan and fills in missing block.id fields
// for both blocks[] and warmup_blocks[]. Idempotent: running it twice on
// the same plan is a no-op after the first pass. Used to silently upgrade
// pre-1.5 plans on first load without forcing a database migration.
// Mutates-then-returns for caller convenience; callers should treat it
// as returning a fresh plan object.
export function ensureBlockIds(plan) {
  if (!plan || typeof plan !== "object") return plan;
  const sessions = Array.isArray(plan.sessions) ? plan.sessions : [];
  return {
    ...plan,
    sessions: sessions.map((session) => {
      if (!session || typeof session !== "object") return session;
      const sessionId = session.id || "unknown";
      const blocks = Array.isArray(session.blocks) ? session.blocks : [];
      const warmupBlocks = Array.isArray(session.warmup_blocks) ? session.warmup_blocks : null;
      return {
        ...session,
        blocks: blocks.map((block, index) => {
          if (!block || typeof block !== "object") return block;
          if (block.id && typeof block.id === "string") return block;
          return { ...block, id: createBlockId(sessionId, index, "b") };
        }),
        ...(warmupBlocks
          ? {
              warmup_blocks: warmupBlocks.map((block, index) => {
                if (!block || typeof block !== "object") return block;
                if (block.id && typeof block.id === "string") return block;
                return { ...block, id: createBlockId(sessionId, index, "w") };
              }),
            }
          : {}),
      };
    }),
  };
}

// Build a blank "actual set" row to seed the mobile session view. Every
// field starts empty — the prescribed reps/load are shown to the user as
// placeholder text in the inputs, not as prefilled values. We used to
// prefill `reps` with `String(prescribedBlock.reps)`, but the LLM-prescribed
// `reps` is free-form ("8-12", "20-40 sec", "AMRAP") and persisted into
// `completed_blocks.actual_sets[].reps` verbatim when users didn't overwrite
// it — which broke the `workout_logs.reps::smallint` cast in the
// upsert_workout_logs RPC and meant the Progress page silently dropped those
// sessions. Logged reps must be a user-typed integer count.
// The caller is responsible for knowing how many actual_sets to pre-create —
// usually Number(prescribedBlock.sets) or 1.
export function createEmptyActualSet(_prescribedBlock) {
  return {
    reps: "",
    load: "",
    rpe: null,
    notes: "",
  };
}

// Validates a session's completed_blocks array. Returns { ok, errors }.
// Absent completed_blocks is valid — sessions without logged actuals are
// the default, not an error. Used inside validatePlan; callable
// standalone for per-session validation from the mobile view.
export function validateCompletedBlocks(session, sessionLabel = "session") {
  const errors = [];
  if (!session || typeof session !== "object") return { ok: true };
  if (session.completed_blocks == null) return { ok: true };
  if (!Array.isArray(session.completed_blocks)) {
    errors.push(`${sessionLabel}.completed_blocks must be an array when present`);
    return { ok: false, errors };
  }
  session.completed_blocks.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") {
      errors.push(`${sessionLabel}.completed_blocks[${i}] must be an object`);
      return;
    }
    if (!entry.block_id || typeof entry.block_id !== "string") {
      errors.push(`${sessionLabel}.completed_blocks[${i}].block_id is required`);
    }
    if (entry.actual_sets != null) {
      if (!Array.isArray(entry.actual_sets)) {
        errors.push(`${sessionLabel}.completed_blocks[${i}].actual_sets must be an array`);
      } else {
        entry.actual_sets.forEach((set, j) => {
          if (set == null) return;
          if (typeof set !== "object") {
            errors.push(`${sessionLabel}.completed_blocks[${i}].actual_sets[${j}] must be an object`);
            return;
          }
          if (set.rpe != null && typeof set.rpe !== "number" && typeof set.rpe !== "string") {
            errors.push(`${sessionLabel}.completed_blocks[${i}].actual_sets[${j}].rpe must be a number or string`);
          }
        });
      }
    }
    if (entry.logged_at != null && typeof entry.logged_at !== "string") {
      errors.push(`${sessionLabel}.completed_blocks[${i}].logged_at must be an ISO string`);
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true };
}

// Returns { ok: true } or { ok: false, errors: [...] }. Cheap structural
// validation — does not enforce that loads are realistic, just that the
// shape is correct enough to render and store. Called from upsert helpers.
export function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== "object") {
    return { ok: false, errors: ["plan must be an object"] };
  }
  if (Number(plan.schema_version) !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEMA_VERSION}, got ${plan.schema_version}`);
  }
  if (!plan.title || typeof plan.title !== "string") {
    errors.push("title is required");
  }
  if (!plan.timezone || typeof plan.timezone !== "string") {
    errors.push("timezone is required");
  }
  if (!Array.isArray(plan.sessions) || plan.sessions.length === 0) {
    errors.push("sessions must be a non-empty array");
  } else {
    const ids = new Set();
    plan.sessions.forEach((s, i) => {
      if (!s || typeof s !== "object") {
        errors.push(`sessions[${i}] must be an object`);
        return;
      }
      if (!s.id || typeof s.id !== "string") {
        errors.push(`sessions[${i}].id is required`);
      } else if (ids.has(s.id)) {
        errors.push(`sessions[${i}].id "${s.id}" is duplicated`);
      } else {
        ids.add(s.id);
      }
      if (!s.date || typeof s.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) {
        errors.push(`sessions[${i}].date must be YYYY-MM-DD`);
      }
      if (s.start_time && !/^\d{2}:\d{2}$/.test(s.start_time)) {
        errors.push(`sessions[${i}].start_time must be HH:MM`);
      }
      if (s.completion_status != null && !COMPLETION_STATUSES.includes(s.completion_status)) {
        errors.push(`sessions[${i}].completion_status invalid`);
      }
      // Phase 1.5: warmup_blocks is optional. When present it must be
      // an array of block-shaped objects.
      if (s.warmup_blocks != null && !Array.isArray(s.warmup_blocks)) {
        errors.push(`sessions[${i}].warmup_blocks must be an array when present`);
      }
      // Phase 1.5: per-session logged actuals.
      const completedCheck = validateCompletedBlocks(s, `sessions[${i}]`);
      if (!completedCheck.ok) {
        errors.push(...completedCheck.errors);
      }
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// When the model emits an update (workout-plan with updates_plan_id set),
// validate that it kept session identities stable on sessions that did NOT
// structurally change. The point is to catch the model regenerating fresh
// IDs every turn — which would break Phase 2 sync mapping. See one-way
// street #11 in the plan.
//
// "Structurally same" means: same week/day_of_week and same block names
// in the same order. If those match but the id changed, the model is
// drifting and we reject. Date or time changes are fine; we expect those.
export function validatePlanUpdate(newPlan, oldPlan) {
  const baseValidation = validatePlan(newPlan);
  if (!baseValidation.ok) return baseValidation;
  if (!oldPlan || typeof oldPlan !== "object") {
    return { ok: false, errors: ["update requires the previous plan for comparison"] };
  }
  const errors = [];
  const oldByPosition = new Map();
  for (const session of oldPlan.sessions || []) {
    if (!session || !session.id) continue;
    const positionKey = `${session.week}|${session.day_of_week}`;
    oldByPosition.set(positionKey, session);
  }
  for (const newSession of newPlan.sessions || []) {
    if (!newSession || !newSession.id) continue;
    const positionKey = `${newSession.week}|${newSession.day_of_week}`;
    const oldSession = oldByPosition.get(positionKey);
    if (!oldSession) continue; // brand-new slot, fine
    if (oldSession.id === newSession.id) continue; // identity preserved, fine
    // Different ids at the same position. Only allow if blocks structurally
    // changed (model legitimately rebuilt the session).
    const oldBlockNames = (oldSession.blocks || []).map((b) => b && b.name).join("|");
    const newBlockNames = (newSession.blocks || []).map((b) => b && b.name).join("|");
    if (oldBlockNames === newBlockNames) {
      errors.push(
        `session at week ${newSession.week} day ${newSession.day_of_week} ` +
          `was given a new id (${newSession.id}) without structural changes — ` +
          `model drift, sync mapping would break`
      );
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// Trim and lightly normalize a plan before storage. Idempotent. Does not
// validate — call validatePlan separately if you care. Phase 1.5 note:
// this also runs ensureBlockIds so pre-1.5 plans get their block IDs
// filled in on first save, without needing a database migration.
export function normalizePlan(plan) {
  if (!plan || typeof plan !== "object") return plan;
  const sessions = Array.isArray(plan.sessions) ? plan.sessions : [];
  const normalized = {
    ...plan,
    schema_version: SCHEMA_VERSION,
    title: String(plan.title || "").trim().slice(0, 200),
    notes: String(plan.notes || "").slice(0, 4000),
    timezone: String(plan.timezone || "UTC").trim(),
    sessions: sessions.map((s, i) => {
      const baseSessionId = s && s.id ? String(s.id) : createSessionId(s?.week || 1, s?.day_of_week || 1) + `_${i}`;
      return {
        ...s,
        id: baseSessionId,
        week: Number(s?.week) || 1,
        day_of_week: Number(s?.day_of_week) || 1,
        duration_minutes: Number(s?.duration_minutes) || 60,
        completion_status: COMPLETION_STATUSES.includes(s?.completion_status) ? s.completion_status : null,
        blocks: Array.isArray(s?.blocks) ? s.blocks : [],
        // Preserve warmup_blocks and completed_blocks when present.
        // Absence is valid — these are Phase 1.5 additions and every
        // pre-1.5 plan will simply not have them.
        ...(Array.isArray(s?.warmup_blocks) ? { warmup_blocks: s.warmup_blocks } : {}),
        ...(Array.isArray(s?.completed_blocks) ? { completed_blocks: s.completed_blocks } : {}),
      };
    }),
  };
  // Auto-heal missing block IDs. This has to run AFTER the session-level
  // normalization above because ensureBlockIds needs the session id to
  // be stable.
  return ensureBlockIds(normalized);
}

// Convert "1..7" day-of-week to a short label. Used by the ICS exporter
// and the card preview.
export const DAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// A compact prose summary of the plan, used by the chat card preview and
// the /app/workout list view. Stay under ~80 chars so it fits one line.
export function summarizePlan(plan) {
  if (!plan) return "";
  const weeks = Number(plan.weeks) || (plan.sessions && Math.max(...plan.sessions.map((s) => s.week || 1))) || 0;
  const days = Number(plan.days_per_week) || 0;
  const goal = String(plan.goal || "").replace(/_/g, " ");
  const parts = [];
  if (weeks) parts.push(`${weeks}-week`);
  if (goal) parts.push(goal);
  if (days) parts.push(`${days} days/wk`);
  return parts.join(" • ");
}
