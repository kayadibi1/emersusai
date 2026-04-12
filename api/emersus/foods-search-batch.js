// api/emersus/foods-search-batch.js
//
// POST /api/emersus/foods/search-batch
// Body: { queries: ["chicken breast", "rice", "eggs"], limit: 1 }
//
// Resolves multiple food names in a single HTTP round trip by running
// N parallel foods_search RPCs server-side. Returns { results: { [query]: topMatch } }.
// Used by the food-log confirm card to resolve food_ids for LLM-parsed items.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

function clientForRequest(req) {
  const authHeader = req.headers.authorization || "";
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function foodsSearchBatch(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }

    const { queries, limit = 1 } = req.body ?? {};
    if (!Array.isArray(queries) || queries.length === 0) {
      res.status(400).json({ error: "queries_must_be_non_empty_array" });
      return;
    }
    if (queries.length > 20) {
      res.status(400).json({ error: "max_20_queries" });
      return;
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 1, 1), 5);
    const supabase = clientForRequest(req);

    // Run all searches in parallel server-side — single HTTP round trip
    // from the client, N parallel Postgres calls on the server.
    const results = {};
    await Promise.all(
      queries.map(async (q) => {
        const query = String(q ?? "").trim();
        if (query.length < 2) {
          results[q] = null;
          return;
        }
        try {
          const { data } = await supabase.rpc("foods_search", {
            p_query: query,
            p_kind: "any",
            p_generic_only: false,
            p_limit: safeLimit,
          });
          results[q] = Array.isArray(data) && data.length > 0 ? data[0] : null;
        } catch {
          results[q] = null;
        }
      })
    );

    res.json({ results });
  } catch (err) {
    console.error("[foods-search-batch] error:", err);
    res.status(500).json({ error: "internal_error" });
  }
}
