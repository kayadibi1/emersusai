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
// validate — call validatePlan separately if you care.
export function normalizePlan(plan) {
  if (!plan || typeof plan !== "object") return plan;
  const sessions = Array.isArray(plan.sessions) ? plan.sessions : [];
  return {
    ...plan,
    schema_version: SCHEMA_VERSION,
    title: String(plan.title || "").trim().slice(0, 200),
    notes: String(plan.notes || "").slice(0, 4000),
    timezone: String(plan.timezone || "UTC").trim(),
    sessions: sessions.map((s, i) => ({
      ...s,
      id: s && s.id ? String(s.id) : createSessionId(s?.week || 1, s?.day_of_week || 1) + `_${i}`,
      week: Number(s?.week) || 1,
      day_of_week: Number(s?.day_of_week) || 1,
      duration_minutes: Number(s?.duration_minutes) || 60,
      completion_status: COMPLETION_STATUSES.includes(s?.completion_status) ? s.completion_status : null,
      blocks: Array.isArray(s?.blocks) ? s.blocks : [],
    })),
  };
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
