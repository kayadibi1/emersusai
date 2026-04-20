// api/emersus/user-rate-limit.js
//
// Per-user daily-message rate limit for /api/emersus/recommendation.
// Two responsibilities in this file:
//   1. Tier cache — Map<userId, {tier, expiresAt}>, 60 s TTL. Reads
//      profiles.tier. Cached because we consult it on every chat send
//      and the tier only changes on Polar webhook (Phase 2), which calls
//      invalidateTier.
//   2. userRateLimit() middleware — calls check_and_increment_message_count
//      atomically, returns 429 on block, sets req.rateLimitInfo otherwise.

import { supabaseAdmin } from "../lib/clients.js";

const TIER_TTL_MS = 60_000;
const tierCache = new Map();

export function _resetTierCacheForTests() {
  tierCache.clear();
}

export function invalidateTier(userId) {
  tierCache.delete(userId);
}

export async function readTier(userId, { supabase = supabaseAdmin } = {}) {
  const cached = tierCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.tier;

  const { data, error } = await supabase
    .from("profiles")
    .select("tier")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // Fail open to 'free' on lookup error. The RPC is still the
    // authoritative gate, and defaulting to the more restrictive tier
    // means a transient blip can't accidentally grant Pro.
    return "free";
  }

  const tier = data?.tier ?? "free";
  tierCache.set(userId, { tier, expiresAt: Date.now() + TIER_TTL_MS });
  return tier;
}

export function userRateLimit({ supabase = supabaseAdmin } = {}) {
  return async (req, res, next) => {
    const userId = req.verifiedUserId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const tier = await readTier(userId, { supabase });
    const limit = tier === "pro" ? 100 : 10;

    const { data, error } = await supabase.rpc(
      "check_and_increment_message_count",
      { p_user_id: userId, p_limit: limit }
    );

    if (error) {
      // Fail open: keep chat online if the DB blips. The IP-based
      // limiter in rate-limit.js still protects the public surface.
      console.error("[user-rate-limit] RPC error:", error.message || error);
      req.rateLimitInfo = {
        tier,
        used: null,
        limit,
        resetAt: null,
        bypassed: true,
      };
      return next();
    }

    const row = Array.isArray(data) ? data[0] : data;
    const resetAtIso = new Date(row.reset_at).toISOString();
    req.rateLimitInfo = {
      tier,
      used: row.new_count,
      limit: row.day_limit,
      resetAt: resetAtIso,
      allowed: row.allowed,
    };

    res.setHeader("X-RateLimit-Limit", row.day_limit);
    res.setHeader(
      "X-RateLimit-Remaining",
      Math.max(row.day_limit - row.new_count, 0)
    );
    res.setHeader(
      "X-RateLimit-Reset",
      Math.ceil(new Date(row.reset_at).getTime() / 1000)
    );

    if (!row.allowed) {
      return res.status(429).json({
        error: "daily_limit_reached",
        tier,
        count: row.new_count,
        limit: row.day_limit,
        reset_at: resetAtIso,
        upgrade_url: tier === "free" ? "/pricing" : null,
      });
    }

    next();
  };
}
