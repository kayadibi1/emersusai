// api/emersus/rpc-proxy.js
//
// Generic Supabase RPC proxy. Lets the browser call allowlisted RPCs
// via GET /api/emersus/rpc/<name>?p_x=y. Uses the caller's JWT so
// SECURITY INVOKER functions respect RLS.
//
// Only functions in the ALLOWLIST are callable — we do NOT expose every
// Postgres function because that would be an unchecked attack surface.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const ALLOWLIST = new Set([
  "get_nutrition_dashboard",
  "get_daily_journal",
  "get_weekly_macro_averages",
  "get_macro_hit_streak",
  "get_micronutrient_status",
  "get_top_foods",
  "get_plan_adherence",
]);

function clientForRequest(req) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.authorization ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Lightweight type coercion: params prefixed p_ become strings, dates
// pass through, numbers parsed, booleans parsed.
function coerce(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
}

export default async function rpcProxy(req, res) {
  try {
    const name = req.params?.name;
    if (!ALLOWLIST.has(name)) {
      res.status(403).json({ error: "rpc_not_allowed" });
      return;
    }
    const params = {};
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (k.startsWith("p_")) params[k] = coerce(v);
    }
    const supabase = clientForRequest(req);
    const { data, error } = await supabase.rpc(name, params);
    if (error) {
      console.error(`[rpc-proxy:${name}] error:`, error);
      res.status(500).json({ error: "rpc_failed", detail: error.message });
      return;
    }
    res.json(data ?? null);
  } catch (err) {
    console.error("[rpc-proxy] unexpected:", err);
    res.status(500).json({ error: "internal_error" });
  }
}
