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
