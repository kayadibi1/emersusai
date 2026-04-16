// api/emersus/pipeline/remember-fact-handler.js
//
// Resolves the remember_fact server-side tool call (spec §5.2). Writes a
// single row to public.user_memories with source='explicit', status='confirmed',
// tier derived from category, expires_at computed per tier TTL. Returns a
// deterministic echo the model weaves into its reply.
//
// Uses the service-role PostgREST fetch pattern (matches api/contact.js,
// api/emersus/pipeline/safety.js). The service-role key bypasses RLS; security
// boundary is the hard-coded user_id: ctx.supabaseUserId — never trust the
// model's claim about who it's writing for.

const CATEGORY_TO_TIER = {
  injury: "A",
  allergy: "A",
  medication: "A",
  chronic_condition: "A",
  pregnancy_status: "A",
  biological_constraint: "A",
  goal: "B",
  target_metric: "B",
  dietary_protocol: "B",
  schedule_pattern: "B",
  coach_program: "B",
  personal_record: "C",
  completed_event: "C",
  deload_window: "D",
  illness_recovery: "D",
  travel_constraint: "D",
  sleep_deficit: "D",
  exercise_preference: "E",
  supplement_stack: "E",
  equipment_inventory: "E",
  custom: "X",
};

// Days. null = indefinite (Tier A and C never expire).
const TIER_TTL_DAYS = { A: null, B: 120, C: null, D: 21, E: 180, X: null };

function computeExpiresAt(tier) {
  const d = TIER_TTL_DAYS[tier];
  if (!d) return null;
  const ts = new Date(Date.now() + d * 24 * 3600 * 1000);
  return ts.toISOString();
}

/**
 * Resolve the `remember_fact` tool call. Returns a payload for the
 * function_call_output to feed back to OpenAI via previous_response_id.
 *
 * Signature intentionally simple to keep the test surface narrow:
 *   - args:  { category, fact, note }
 *   - ctx:   { supabaseUserId, threadId, _openaiResponseId }
 *   - deps:  { fetchImpl?, supabaseUrl?, serviceRoleKey? } — all optional;
 *            defaults read from global fetch and process.env. Useful for tests.
 */
export async function resolveRememberFact({ args, ctx, deps = {} } = {}) {
  const category = args?.category;
  const fact = args?.fact;
  const note = args?.note ?? null;

  if (!ctx?.supabaseUserId) {
    return { saved: false, error: "not_authenticated" };
  }
  if (!category || !(category in CATEGORY_TO_TIER)) {
    return { saved: false, error: `unknown_category: ${category}` };
  }
  if (typeof fact !== "string" || fact.length < 1 || fact.length > 500) {
    return { saved: false, error: "fact_length_out_of_range (must be 1..500 chars)" };
  }

  const tier = CATEGORY_TO_TIER[category];
  const row = {
    user_id: ctx.supabaseUserId,
    category,
    tier,
    fact,
    source: "explicit",
    source_thread_id: ctx.threadId || null,
    source_turn_ref: ctx._openaiResponseId || null,
    confidence: 1.00,
    status: "confirmed",
    confirmed_at: new Date().toISOString(),
    expires_at: computeExpiresAt(tier),
    metadata: note ? { note } : {},
  };

  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const supabaseUrl = deps.supabaseUrl || process.env.SUPABASE_URL;
  const serviceRoleKey = deps.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { saved: false, error: "supabase_env_missing" };
  }

  let response;
  try {
    response = await fetchImpl(`${supabaseUrl}/rest/v1/user_memories`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
  } catch (err) {
    return { saved: false, error: `insert_network_error: ${err?.message || "unknown"}` };
  }

  if (!response.ok) {
    let detail = "";
    try { detail = await response.text(); } catch { /* ignore */ }
    return { saved: false, error: `insert_failed_${response.status}: ${detail.slice(0, 200)}` };
  }

  let body;
  try { body = await response.json(); } catch { body = null; }
  const saved = Array.isArray(body) ? body[0] : body;
  if (!saved?.id) {
    return { saved: false, error: "insert_returned_no_id" };
  }

  return {
    saved: true,
    id: saved.id,
    echo: "Saved — I'll remember that across future chats.",
  };
}
