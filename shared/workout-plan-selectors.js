// Pure selector helpers over the workout_plans data the dashboard,
// the planner, and the mobile session view all need.
//
// No DOM, no React, no Supabase imports — these run server-side, in
// browser test harnesses, and inside React render functions equally
// well. Every function is a pure transform from a list of plan rows
// to either a structured result or null.
//
// "today" everywhere defaults to the local YYYY-MM-DD computed via
// new Date().toISOString().slice(0, 10) — UTC date, NOT plan-local.
// Phase 1.5 caveat: a plan in America/Los_Angeles whose user opens
// the dashboard at 11pm Pacific will see the next session as
// "tomorrow" (which is true in UTC) instead of "today" (true locally).
// Acceptable for v1; if anyone complains we can pass through the
// plan timezone and rebuild the date in that zone.

// Returns the most-relevant session for "what should I do right now"
// across all of the user's non-archived plans. Returns:
//
//   { plan, session, status: "today" }     — there's a session today
//   { plan, session, status: "upcoming" }  — nothing today, here's the next one
//   null                                    — user has no plans, or every
//                                            session in every plan is in the past
//
// Algorithm: across all non-archived plans, build a flat list of
// (plan, session) pairs sorted by session.date ascending. Filter to
// sessions whose date is >= today. Pick the first one. If that session's
// date == today, status is "today"; otherwise "upcoming".
//
// Tie-breakers when multiple plans have a session today: pick the
// most-recently-updated plan. This matches what users would expect —
// the plan they were just looking at wins.
export function findTodaysSession(plans, today = new Date().toISOString().slice(0, 10)) {
  if (!Array.isArray(plans) || plans.length === 0) return null;

  // Build (planRow, session, date) tuples for every future or today
  // session across every non-archived plan.
  const candidates = [];
  for (const planRow of plans) {
    if (!planRow || planRow.archived_at) continue;
    const plan = planRow.plan || {};
    const sessions = Array.isArray(plan.sessions) ? plan.sessions : [];
    for (const session of sessions) {
      if (!session || !session.date) continue;
      if (session.date < today) continue;
      candidates.push({
        planRow,
        session,
        date: session.date,
        // Stable secondary sort: more recent updates first when dates tie.
        updatedAt: planRow.updated_at || planRow.created_at || "",
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return 0;
  });

  const winner = candidates[0];
  return {
    plan: winner.planRow,
    session: winner.session,
    status: winner.date === today ? "today" : "upcoming",
  };
}

// Lighter helper: find the very next un-logged session in a single plan,
// used by the desk view's "Open mobile session view" button to know
// which session to deep-link to. Falls through to the first session if
// every session is already logged or completed.
export function nextUnloggedSession(plan) {
  if (!plan || !Array.isArray(plan.sessions) || plan.sessions.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  // Pass 1: future or today, no logged actuals, not completed
  for (const session of plan.sessions) {
    if (!session) continue;
    if (session.date && session.date < today) continue;
    if (session.completion_status === "completed") continue;
    if (Array.isArray(session.completed_blocks) && session.completed_blocks.length > 0) continue;
    return session;
  }
  // Pass 2: any future or today session, regardless of logging
  for (const session of plan.sessions) {
    if (!session) continue;
    if (session.date && session.date < today) continue;
    return session;
  }
  // Pass 3: just give them the first session
  return plan.sessions[0];
}

// Returns true when a session has any logged actuals — used by the
// dashboard to decide whether "Today's workout" should show the
// "Start session" CTA or the "Already logged" success state, and
// by the desk view to render a checkmark next to logged sessions.
export function sessionHasLoggedActuals(session) {
  if (!session || !Array.isArray(session.completed_blocks)) return false;
  return session.completed_blocks.length > 0;
}

// Aggregate count of logged sessions across all plans for a user. Used
// for the dashboard's "Profile incomplete / Profile complete" status
// chip and any future "weekly volume" metric. O(plans * sessions) but
// the dataset is tiny in practice.
export function countLoggedSessions(plans) {
  if (!Array.isArray(plans)) return 0;
  let count = 0;
  for (const planRow of plans) {
    if (!planRow || planRow.archived_at) continue;
    const sessions = (planRow.plan && planRow.plan.sessions) || [];
    for (const session of sessions) {
      if (sessionHasLoggedActuals(session)) count += 1;
    }
  }
  return count;
}

// Format the "next up" / "today" copy for the dashboard card. Returns a
// short string like "Today: Full Body A · 50 min · 17:30" or
// "Next up: Full Body B · Wed Apr 15 · 17:30". Pure string formatting
// so we can keep the rendering layer tiny.
export function formatTodaysSessionCopy(result) {
  if (!result) return "";
  const session = result.session || {};
  const titleParts = [];
  if (result.status === "today") titleParts.push("Today");
  else if (result.status === "upcoming") titleParts.push("Next up");
  titleParts.push(session.title || "Workout");

  const metaParts = [];
  if (session.duration_minutes) metaParts.push(`${session.duration_minutes} min`);
  if (session.start_time) metaParts.push(session.start_time);
  if (result.status === "upcoming" && session.date) {
    try {
      const d = new Date(session.date + "T00:00:00");
      metaParts.unshift(
        d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
      );
    } catch (_) {
      metaParts.unshift(session.date);
    }
  }

  return {
    title: titleParts.join(": "),
    meta: metaParts.join(" · "),
  };
}
