import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {
  SCHEMA_VERSION,
  normalizePlan,
  validatePlan,
  validatePlanUpdate,
} from "/shared/workout-plan-schema.js";

const CONTACT_EMAIL = "support@emersus.ai";

// Hardcoded admin allowlist for the unlisted /app/_debug/ page. Anyone whose
// Supabase auth email is in this list can access the debug panel; everyone
// else (including signed-in users) is redirected to /app/. The page itself
// is not linked anywhere in the UI. Keep entries lowercase to make the
// comparison in requireAdmin case-insensitive without re-normalizing each
// time. To add or remove admins, edit this array directly — there is no
// database-backed role table in Phase 1 and intentionally so (see plans/).
const ADMIN_EMAILS = ["sidarvig@gmail.com"];

let clientPromise;
let configPromise;

export function getContactEmail() {
  return CONTACT_EMAIL;
}

export async function getPublicConfig() {
  if (!configPromise) {
    configPromise = fetch("/api/config", {
      headers: {
        Accept: "application/json",
      },
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error("Unable to load auth configuration.");
      }

      return response.json();
    });
  }

  return configPromise;
}

export async function getSupabase() {
  if (!clientPromise) {
    clientPromise = getPublicConfig().then(({ supabaseUrl, supabaseAnonKey }) =>
      createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    );
  }

  return clientPromise;
}

export async function getSession() {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}

export function getBaseUrl() {
  return window.location.origin;
}

export function getAuthCallbackUrl() {
  return `${getBaseUrl()}/auth/callback/`;
}

export function setStatus(element, tone, message) {
  if (!element) {
    return;
  }

  element.textContent = message || "";
  if (message) {
    element.dataset.tone = tone;
  } else {
    delete element.dataset.tone;
  }
}

export async function requireAuth({ redirectTo = "/auth/login/" } = {}) {
  const session = await getSession();

  if (!session) {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    const target = `${redirectTo}?next=${encodeURIComponent(returnTo)}`;
    window.location.replace(target);
    return null;
  }

  return session;
}

// Same as requireAuth, but also enforces that the signed-in email is in
// ADMIN_EMAILS. Used only by /app/_debug/ right now. Non-admin users are
// redirected to the normal dashboard with a toast-worthy query param so
// the dashboard page (if it wants to) can surface a "not authorized"
// message. Admins get the session back, identical to requireAuth.
export async function requireAdmin({
  redirectTo = "/auth/login/",
  nonAdminRedirect = "/app/?msg=admin-only",
} = {}) {
  const session = await requireAuth({ redirectTo });
  if (!session) return null;

  const email = String(session.user?.email || "").trim().toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    window.location.replace(nonAdminRedirect);
    return null;
  }

  return session;
}

export async function redirectIfAuthenticated(target = "/app/") {
  const session = await getSession();

  if (session) {
    window.location.replace(target);
    return true;
  }

  return false;
}

export async function getProfile(userId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function upsertProfile(userId, values) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userId,
        ...values,
      },
      {
        onConflict: "id",
      }
    )
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function listChatThreads(userId) {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("chat_threads")
    .select(
      "id,user_id,title,preview,messages,sources,rail,thread_state,created_at,updated_at"
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

export async function upsertChatThread(userId, thread) {
  const supabase = await getSupabase();
  const payload = {
    id: thread.id,
    user_id: userId,
    title: thread.title || "New chat",
    preview: thread.preview || "No messages yet",
    messages: Array.isArray(thread.messages) ? thread.messages : [],
    sources: (() => {
      // Derive thread-level sources from the latest assistant message for
      // backward compatibility with older clients that read thread.sources.
      const msgs = Array.isArray(thread.messages) ? thread.messages : [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant" && Array.isArray(msgs[i].sources) && msgs[i].sources.length) {
          return msgs[i].sources;
        }
      }
      return Array.isArray(thread.sources) ? thread.sources : [];
    })(),
    rail: thread.rail && typeof thread.rail === "object" ? thread.rail : {},
    thread_state:
      thread.threadState && typeof thread.threadState === "object"
        ? thread.threadState
        : {},
    created_at: thread.createdAt || new Date().toISOString(),
    updated_at: thread.updatedAt || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("chat_threads")
    .upsert(payload, { onConflict: "id" })
    .select(
      "id,user_id,title,preview,messages,sources,rail,thread_state,created_at,updated_at"
    )
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export function resolveNextPath(fallback = "/app/") {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");

  if (!next || !next.startsWith("/")) {
    return fallback;
  }

  return next;
}

export function readAuthFlowFromUrl() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  return {
    code: searchParams.get("code"),
    type: searchParams.get("type") || hashParams.get("type"),
    accessToken: hashParams.get("access_token"),
    refreshToken: hashParams.get("refresh_token"),
  };
}

// ---------------------------------------------------------------------------
// Workout plans
// ---------------------------------------------------------------------------
//
// Frontend helpers for the workout_plans table. Mirror the profiles /
// chat_threads patterns above: single supabase client, awaited, errors
// thrown. RLS enforces per-user isolation on the server; these helpers
// never bypass it.
//
// All writes go through upsertWorkoutPlan, which:
//   - normalizes the plan via workout-plan-schema.js,
//   - validates structural correctness (and, for updates, checks that the
//     model didn't drift session ids — see one-way street #11),
//   - rotates previous_plan when updates_plan_id is set, so Undo works.
//
// Manual edits from /app/workout/ go through applyManualEdit instead, which
// is the same write path with last_adjusted_via = "manual".

export async function listWorkoutPlans(userId) {
  if (!userId) return [];
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workout_plans")
    .select(
      "id,user_id,title,schema_version,plan,previous_plan,source_thread_id,last_adjusted_via,last_adjusted_at,archived_at,created_at,updated_at"
    )
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }
  return Array.isArray(data) ? data : [];
}

export async function getWorkoutPlan(planId) {
  if (!planId) return null;
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workout_plans")
    .select(
      "id,user_id,title,schema_version,plan,previous_plan,source_thread_id,last_adjusted_via,last_adjusted_at,archived_at,created_at,updated_at"
    )
    .eq("id", planId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data || null;
}

// Insert a new plan generated by Emersus in chat. The plan JSON comes from
// a ```workout-plan fence; we normalize and validate before writing. Returns
// the inserted row. `sourceThreadId` is optional and used to link back to
// the chat thread that produced the plan.
export async function saveNewWorkoutPlan(userId, plan, { sourceThreadId = null } = {}) {
  if (!userId) throw new Error("userId is required");
  const normalized = normalizePlan(plan);
  const check = validatePlan(normalized);
  if (!check.ok) {
    throw new Error(`Invalid workout plan: ${check.errors.join("; ")}`);
  }
  const supabase = await getSupabase();
  const payload = {
    user_id: userId,
    title: normalized.title,
    schema_version: SCHEMA_VERSION,
    plan: normalized,
    source_thread_id: sourceThreadId || null,
    last_adjusted_via: "initial",
    last_adjusted_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("workout_plans")
    .insert(payload)
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data;
}

// Apply a chat-driven update: the model emitted a workout-plan fence with
// updates_plan_id set, and the user clicked "Apply update" on the card.
// Validates the update against the stored plan, rotates previous_plan,
// sets last_adjusted_via = "chat". Returns the updated row.
export async function applyWorkoutPlanUpdate(userId, planId, newPlan) {
  if (!userId || !planId) throw new Error("userId and planId are required");
  const existing = await getWorkoutPlan(planId);
  if (!existing) throw new Error("Plan not found");
  if (existing.user_id !== userId) throw new Error("Not your plan");

  const normalized = normalizePlan(newPlan);
  const check = validatePlanUpdate(normalized, existing.plan);
  if (!check.ok) {
    throw new Error(`Adjustment failed: ${check.errors.join("; ")}`);
  }

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workout_plans")
    .update({
      title: normalized.title,
      plan: normalized,
      previous_plan: existing.plan,
      last_adjusted_via: "chat",
      last_adjusted_at: new Date().toISOString(),
    })
    .eq("id", planId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data;
}

// Manual edit from /app/workout/ — a user changed a session's date, time,
// completion status, etc. Does not require updates_plan_id on the payload.
// Rotates previous_plan so Undo still works.
export async function applyManualWorkoutPlanEdit(userId, planId, newPlan) {
  if (!userId || !planId) throw new Error("userId and planId are required");
  const existing = await getWorkoutPlan(planId);
  if (!existing) throw new Error("Plan not found");
  if (existing.user_id !== userId) throw new Error("Not your plan");

  const normalized = normalizePlan(newPlan);
  const check = validatePlan(normalized);
  if (!check.ok) {
    throw new Error(`Invalid edit: ${check.errors.join("; ")}`);
  }

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workout_plans")
    .update({
      title: normalized.title,
      plan: normalized,
      previous_plan: existing.plan,
      last_adjusted_via: "manual",
      last_adjusted_at: new Date().toISOString(),
    })
    .eq("id", planId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data;
}

// Swap plan <-> previous_plan so the last change is undone. previous_plan
// becomes the current plan, and the thing that was current is discarded
// (one undo step only). See one-way street #12.
export async function undoLastWorkoutPlanChange(userId, planId) {
  if (!userId || !planId) throw new Error("userId and planId are required");
  const existing = await getWorkoutPlan(planId);
  if (!existing) throw new Error("Plan not found");
  if (existing.user_id !== userId) throw new Error("Not your plan");
  if (!existing.previous_plan) throw new Error("Nothing to undo");

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workout_plans")
    .update({
      title: existing.previous_plan.title || existing.title,
      plan: existing.previous_plan,
      previous_plan: null,
      last_adjusted_via: "undo",
      last_adjusted_at: new Date().toISOString(),
    })
    .eq("id", planId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data;
}

export async function archiveWorkoutPlan(userId, planId) {
  if (!userId || !planId) throw new Error("userId and planId are required");
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workout_plans")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", planId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data;
}

/**
 * Flatten completed_blocks into workout_logs via the upsert_workout_logs RPC.
 * Called after applyManualWorkoutPlanEdit succeeds.
 * Non-blocking — errors are logged but don't fail the save.
 */
export async function upsertWorkoutLogs(userId, planId, plan, targetSessionId) {
  const supabase = await getSupabase();

  for (const session of (plan.sessions || [])) {
    // If a target session is specified, only process that one
    if (targetSessionId && session.id !== targetSessionId) continue;

    const completed = session.completed_blocks;
    if (!completed || completed.length === 0) continue;

    // Enrich each block with its exercise name from the plan's blocks array
    const blocks = completed.map(cb => {
      const planBlock =
        (session.blocks || []).find(b => b.id === cb.block_id) ||
        (session.warmup_blocks || []).find(b => b.id === cb.block_id);
      return {
        ...cb,
        exercise_name: planBlock?.name || "",
      };
    }).filter(b => b.exercise_name);

    if (blocks.length === 0) continue;

    const performedAt = session.date || new Date().toISOString().slice(0, 10);

    try {
      await supabase.rpc("upsert_workout_logs", {
        p_user_id: userId,
        p_plan_id: planId,
        p_session_id: session.id,
        p_performed_at: performedAt,
        p_blocks: blocks,
      });
    } catch (err) {
      console.error("[upsertWorkoutLogs] Failed for session", session.id, err);
    }
  }
}
