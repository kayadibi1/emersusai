// api/emersus/pipeline/retrieve-memory.js
//
// Phase 2 pipeline stage: pulls the user's cross-thread memory and populates
// ctx.crossThreadMemory. Runs parallel to evidence retrieval in workflow.js
// via Promise.allSettled — a memory failure never blocks the chat.
//
// Three channels (spec §6):
//   1. Always-inject: Tier A + active Tier D (one RPC)
//   2. RAG kNN:       Tier B/C/E/X semantic to the current question (one RPC)
//   3. Refresh:       fire-and-forget UPDATE (one RPC, errors swallowed)
//
// On any fatal error (always-inject fails OR unexpected throw) the stage
// leaves ctx.crossThreadMemory null so the prompt omits the field entirely.

import { embedText as defaultEmbedText } from "../embeddings.js";

const RAG_MIN_SIMILARITY = 0.35;
const RAG_LIMIT          = 6;
const PERSISTENT_CAP     = 15;
const ACTIVE_NOW_CAP     = 8;

async function callRpc(name, body, deps) {
  const res = await deps.fetchImpl(`${deps.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: deps.serviceRoleKey,
      Authorization: `Bearer ${deps.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`rpc_${name}_failed_${res.status}: ${detail.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Populate ctx.crossThreadMemory on success. On failure, leave it as-is
 * (the prompt omits the field for null/undefined values).
 *
 * deps (optional, for tests): { fetchImpl, supabaseUrl, serviceRoleKey, embedText }
 */
export async function retrieveMemory(ctx, deps = {}) {
  const userId = ctx?.supabaseUserId;
  if (!userId) {
    if (ctx && !("crossThreadMemory" in ctx)) ctx.crossThreadMemory = null;
    return;
  }

  const fetchImpl      = deps.fetchImpl      || globalThis.fetch;
  const supabaseUrl    = deps.supabaseUrl    || process.env.SUPABASE_URL;
  const serviceRoleKey = deps.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const embedText      = deps.embedText      || defaultEmbedText;
  if (!fetchImpl || !supabaseUrl || !serviceRoleKey) {
    ctx.crossThreadMemory = null;
    return;
  }

  const effectiveDeps = { fetchImpl, supabaseUrl, serviceRoleKey };
  const question = typeof ctx.question === "string" ? ctx.question.trim() : "";

  let alwaysInject = [];
  let ragMatches   = [];

  try {
    const alwaysInjectP = callRpc(
      "retrieve_memory_always_inject",
      { p_user_id: userId },
      effectiveDeps,
    );

    const ragP = question
      ? (async () => {
          const embedding = await embedText(question);
          return callRpc(
            "retrieve_memory_rag",
            { p_user_id: userId, p_embedding: embedding, p_limit: RAG_LIMIT },
            effectiveDeps,
          );
        })()
      : Promise.resolve([]);

    const [aiResult, ragResult] = await Promise.allSettled([alwaysInjectP, ragP]);

    if (aiResult.status === "rejected") {
      console.warn("[retrieveMemory] always_inject failed:", aiResult.reason?.message || aiResult.reason);
      ctx.crossThreadMemory = null;
      return;
    }
    alwaysInject = Array.isArray(aiResult.value) ? aiResult.value : [];

    if (ragResult.status === "fulfilled" && Array.isArray(ragResult.value)) {
      ragMatches = ragResult.value.filter((r) => Number(r.similarity) >= RAG_MIN_SIMILARITY);
    } else if (ragResult.status === "rejected") {
      console.warn("[retrieveMemory] rag failed (soft):", ragResult.reason?.message || ragResult.reason);
    }
  } catch (err) {
    console.warn("[retrieveMemory] unexpected error:", err?.message || err);
    ctx.crossThreadMemory = null;
    return;
  }

  const persistent = alwaysInject
    .filter((r) => r.tier === "A")
    .slice(0, PERSISTENT_CAP)
    .map((r) => ({
      id: r.id,
      category: r.category,
      fact: r.fact,
      metadata: r.metadata || {},
      since: r.confirmed_at,
    }));

  const activeNow = alwaysInject
    .filter((r) => r.tier === "D")
    .slice(0, ACTIVE_NOW_CAP)
    .map((r) => ({
      id: r.id,
      category: r.category,
      fact: r.fact,
      metadata: r.metadata || {},
      valid_through: r.expires_at,
    }));

  const relevant = ragMatches.map((r) => ({
    id: r.id,
    category: r.category,
    fact: r.fact,
    metadata: r.metadata || {},
    on: r.last_mentioned_at,
    similarity: Math.round(Number(r.similarity) * 100) / 100,
  }));

  if (!persistent.length && !activeNow.length && !relevant.length) {
    ctx.crossThreadMemory = null;
    return;
  }

  ctx.crossThreadMemory = {
    persistent,
    active_now: activeNow,
    relevant_to_this_question: relevant,
  };

  // Fire-and-forget refresh-on-mention.
  const ids = [
    ...alwaysInject.map((r) => r.id),
    ...ragMatches.map((r) => r.id),
  ].filter(Boolean);
  if (ids.length) {
    try {
      await callRpc(
        "refresh_memory_mentions",
        { p_user_id: userId, p_memory_ids: ids },
        effectiveDeps,
      );
    } catch (err) {
      console.warn("[retrieveMemory] refresh failed (soft):", err?.message || err);
    }
  }
}
