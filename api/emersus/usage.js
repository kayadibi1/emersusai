// api/emersus/usage.js
//
// GET /api/emersus/usage — returns {tier, used, limit, reset_at}.
// Powers the UsageRing below the chat composer and the Usage card in
// /app/profile/. Cheap: one SELECT on daily_message_counts plus the
// tier-cache lookup in readTier().

import { supabaseAdmin } from "../lib/clients.js";
import { readTier } from "./user-rate-limit.js";

function nextUtcMidnightIso() {
  const d = new Date();
  const next = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
  );
  return next.toISOString();
}

function utcTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function usageHandler(req, res, { supabase = supabaseAdmin } = {}) {
  const userId = req.verifiedUserId;
  if (!userId) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const tier = await readTier(userId, { supabase });
  const limit = tier === "pro" ? 100 : 10;

  const { data } = await supabase
    .from("daily_message_counts")
    .select("count")
    .eq("user_id", userId)
    .eq("day", utcTodayIso())
    .maybeSingle();

  const used = data?.count ?? 0;
  res.json({ tier, used, limit, reset_at: nextUtcMidnightIso() });
}

export default usageHandler;
