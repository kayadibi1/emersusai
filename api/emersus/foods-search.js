// api/emersus/foods-search.js
//
// GET /api/emersus/foods/search?q=<query>&kind=<food|supplement|any>
//                               &generic_only=<true|false>&limit=<1..50>
//
// Returns top-N foods ranked by Postgres FTS + pg_trgm + source-tier.
// Used by: the journal log modal, the supplement picker, and the
// nutrition parser's match pipeline (api/emersus/nutrition-parser.js).
//
// RLS applies — user-contributed foods are only visible to their creator.
// This handler runs with the user's JWT so Supabase enforces it automatically.

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

export default async function foodsSearch(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      res.status(400).json({ error: "query_too_short", min_length: 2 });
      return;
    }
    const kind = ["food", "supplement", "any"].includes(req.query.kind) ? req.query.kind : "any";
    const genericOnly = req.query.generic_only === "true";
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? "20", 10) || 20, 1), 50);

    const supabase = clientForRequest(req);

    const { data, error } = await supabase.rpc("foods_search", {
      p_query: q,
      p_kind: kind,
      p_generic_only: genericOnly,
      p_limit: limit,
    });

    if (error) {
      console.error("[foods-search] rpc error:", error);
      res.status(500).json({ error: "search_failed" });
      return;
    }
    res.json({ results: data ?? [] });
  } catch (err) {
    console.error("[foods-search] unexpected error:", err);
    res.status(500).json({ error: "internal_error" });
  }
}
