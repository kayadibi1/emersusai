// Workout-plan diff helper.
//
// When Emersus emits a plan update (workout-plan fence with updates_plan_id
// set), the WorkoutPlanCard shows a one-line diff preview so the user
// knows what "Apply update" will actually change. This helper computes
// that summary by walking sessions in both plans keyed by id.
//
// Output is intentionally coarse: counts rather than a full field-by-field
// diff. The goal is user confidence ("OK, a few sessions moved, nothing
// scary"), not legal-grade audit. A richer view can live on the /app/workout
// page later if users want it.

// Returns a human-readable array of diff lines, e.g.
//   ["3 sessions rescheduled", "1 session marked missed", "1 exercise swapped across future sessions"]
// Empty array means nothing changed (which would be strange but not
// catastrophic — the card just renders "No changes detected").
export function summarizePlanDiff(newPlan, oldPlan) {
  if (!newPlan || !oldPlan) return ["New plan"];
  const out = [];

  const oldById = new Map();
  for (const session of oldPlan.sessions || []) {
    if (session && session.id) oldById.set(session.id, session);
  }
  const newById = new Map();
  for (const session of newPlan.sessions || []) {
    if (session && session.id) newById.set(session.id, session);
  }

  let rescheduled = 0;
  let markedMissed = 0;
  let markedSkipped = 0;
  let markedCompleted = 0;
  let loadChanged = 0;
  let exerciseSwapped = 0;
  let added = 0;
  let removed = 0;

  for (const [id, newSession] of newById) {
    const oldSession = oldById.get(id);
    if (!oldSession) {
      added += 1;
      continue;
    }
    if (
      oldSession.date !== newSession.date ||
      oldSession.start_time !== newSession.start_time ||
      oldSession.day_of_week !== newSession.day_of_week
    ) {
      rescheduled += 1;
    }
    if (oldSession.completion_status !== newSession.completion_status) {
      if (newSession.completion_status === "missed") markedMissed += 1;
      else if (newSession.completion_status === "skipped") markedSkipped += 1;
      else if (newSession.completion_status === "completed") markedCompleted += 1;
    }
    // Block-level comparison: did exercise names change?
    const oldNames = (oldSession.blocks || []).map((b) => b && b.name).filter(Boolean).join("|");
    const newNames = (newSession.blocks || []).map((b) => b && b.name).filter(Boolean).join("|");
    if (oldNames !== newNames) {
      exerciseSwapped += 1;
    } else {
      // Same exercises, different loads?
      const oldLoads = (oldSession.blocks || []).map((b) => b && b.load).join("|");
      const newLoads = (newSession.blocks || []).map((b) => b && b.load).join("|");
      if (oldLoads !== newLoads) loadChanged += 1;
    }
  }

  for (const id of oldById.keys()) {
    if (!newById.has(id)) removed += 1;
  }

  if (added) out.push(pluralize(added, "session added", "sessions added"));
  if (removed) out.push(pluralize(removed, "session removed", "sessions removed"));
  if (rescheduled) out.push(pluralize(rescheduled, "session rescheduled", "sessions rescheduled"));
  if (markedMissed) out.push(pluralize(markedMissed, "session marked missed", "sessions marked missed"));
  if (markedSkipped) out.push(pluralize(markedSkipped, "session marked skipped", "sessions marked skipped"));
  if (markedCompleted) out.push(pluralize(markedCompleted, "session marked completed", "sessions marked completed"));
  if (exerciseSwapped) out.push(pluralize(exerciseSwapped, "session with exercise swap", "sessions with exercise swaps"));
  if (loadChanged) out.push(pluralize(loadChanged, "session with load rescaled", "sessions with loads rescaled"));

  return out;
}

function pluralize(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural}`;
}
