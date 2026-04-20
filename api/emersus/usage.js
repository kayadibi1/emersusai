// api/emersus/usage.js
//
// GET /api/emersus/usage — returns {tier, used, limit, reset_at, cancelsAt}.
// Powers the UsageRing below the chat composer and the Usage card in
// /app/profile/. Two SELECTs: daily_message_counts for today + a small
// scan of billing_events for cancellation-pending state. tier-cache
// lookup is cached in-memory.

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

/**
 * Look at recent subscription.* events for this user and determine
 * whether they're in cancel-pending state: most recent relevant event
 * is 'subscription.canceled' with no later 'subscription.revoked' or
 * 'subscription.active'. Returns an ISO date string or null.
 *
 * Exported so tests can exercise the pure logic without a DB.
 */
export function resolveCancelsAt(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // Rows are ordered most-recent first. The first row whose type is
  // 'subscription.canceled' *and* isn't followed by a later activation
  // or revocation indicates a cancel-pending state.
  let sawPostCancel = false;
  for (const row of rows) {
    const t = row?.event_type;
    if (t === "subscription.canceled") {
      // If we've already seen an active/revoked after this in the scan
      // (remember: rows are DESC; "after" in time = "earlier in array"),
      // this cancel is no longer the most recent relevant state.
      if (sawPostCancel) return null;
      // Pull the period end from the webhook payload. Polar uses
      // current_period_end on subscription objects.
      const data = row?.raw?.data || {};
      return (
        data.current_period_end ||
        data.currentPeriodEnd ||
        data.ends_at ||
        data.endsAt ||
        null
      );
    }
    if (t === "subscription.active" || t === "subscription.revoked") {
      sawPostCancel = true;
    }
  }
  return null;
}

export async function usageHandler(req, res, { supabase = supabaseAdmin } = {}) {
  const userId = req.verifiedUserId;
  if (!userId) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const tier = await readTier(userId, { supabase });
  const limit = tier === "pro" ? 100 : 10;

  const [{ data: countRow }, { data: eventRows }] = await Promise.all([
    supabase
      .from("daily_message_counts")
      .select("count")
      .eq("user_id", userId)
      .eq("day", utcTodayIso())
      .maybeSingle(),
    tier === "pro"
      ? supabase
          .from("billing_events")
          .select("event_type, raw, created_at")
          .eq("user_id", userId)
          .like("event_type", "subscription.%")
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
  ]);

  const used = countRow?.count ?? 0;
  const cancelsAt = tier === "pro" ? resolveCancelsAt(eventRows) : null;

  res.json({
    tier,
    used,
    limit,
    reset_at: nextUtcMidnightIso(),
    cancels_at: cancelsAt,
  });
}

export default usageHandler;
