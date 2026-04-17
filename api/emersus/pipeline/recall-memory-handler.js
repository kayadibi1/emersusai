// api/emersus/pipeline/recall-memory-handler.js
//
// Resolves the recall_memory server-side tool call (spec §5.3). Wrapper
// around the recall_memory RPC that accepts either a semantic query or a
// category filter (or both); returns a pruned list of memories for the
// model to use in its answer. Soft-fails to `{memories: [], error}` so the
// model gets a clean "nothing found" signal without 5xxing the whole turn.

import { embedText as defaultEmbedText } from "../embeddings.js";

const MIN_LIMIT = 1;
const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 6;

function clampLimit(n) {
  const v = Number.isFinite(n) ? Math.floor(Number(n)) : DEFAULT_LIMIT;
  if (!v) return MIN_LIMIT; // 0 or NaN → minimum
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, v));
}

export async function resolveRecallMemory({ args, ctx, deps = {} } = {}) {
  const userId = ctx?.supabaseUserId;
  if (!userId) return { memories: [] };

  const rawQuery = args?.query;
  const rawCats  = args?.categories;

  const query = typeof rawQuery === "string" && rawQuery.trim().length > 0 ? rawQuery.trim() : null;
  const categories = Array.isArray(rawCats) && rawCats.length > 0 ? rawCats : null;
  const limit = clampLimit(args?.limit);

  // Nothing to search on.
  if (!query && !categories) return { memories: [] };

  const fetchImpl      = deps.fetchImpl      || globalThis.fetch;
  const supabaseUrl    = deps.supabaseUrl    || process.env.SUPABASE_URL;
  const serviceRoleKey = deps.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const embedText      = deps.embedText      || defaultEmbedText;

  if (!supabaseUrl || !serviceRoleKey) {
    return { memories: [], error: "supabase_env_missing" };
  }

  let embedding = null;
  if (query) {
    try {
      embedding = await embedText(query);
    } catch (err) {
      return { memories: [], error: `embed_failed: ${err?.message || err}` };
    }
  }

  let response;
  try {
    response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/recall_memory`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_user_id:    userId,
        p_embedding:  embedding,
        p_categories: categories,
        p_limit:      limit,
      }),
    });
  } catch (err) {
    return { memories: [], error: `rpc_network_error: ${err?.message || err}` };
  }

  if (!response.ok) {
    let detail = "";
    try { detail = await response.text(); } catch { /* ignore */ }
    return {
      memories: [],
      error: `recall_memory_rpc_failed_${response.status}: ${detail.slice(0, 200)}`,
    };
  }

  let rows;
  try { rows = await response.json(); } catch { rows = []; }
  if (!Array.isArray(rows)) rows = [];

  const memories = rows.map((r) => ({
    category: r.category,
    tier: r.tier,
    fact: r.fact,
    metadata: r.metadata || {},
    status: r.status,
    ...(r.similarity != null ? { similarity: Math.round(Number(r.similarity) * 100) / 100 } : {}),
    on: r.last_mentioned_at || r.created_at,
  }));

  return { memories };
}
