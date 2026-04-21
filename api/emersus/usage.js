// api/emersus/usage.js
//
// GET /api/emersus/usage — returns {tier, used, limit, reset_at,
// cancels_at, renews_at, subscription_status}. Powers the UsageRing
// below the chat composer and the Billing tab in /app/profile/. Reads
// denormalized subscription state from public.profiles (kept current
// by the Polar webhook) and falls back to a billing_events scan if the
// new columns are null — that covers any legacy rows from before the
// 2026-04-21 migration and any transient webhook gaps until the next
// reconciliation cron run.

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

  const [{ data: countRow }, { data: profileRow }] = await Promise.all([
    supabase
      .from("daily_message_counts")
      .select("count")
      .eq("user_id", userId)
      .eq("day", utcTodayIso())
      .maybeSingle(),
    tier === "pro"
      ? supabase
          .from("profiles")
          .select("pro_until, subscription_status, cancel_at_period_end")
          .eq("id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Primary path: use denormalized columns written by the webhook. Fall
  // back to scanning billing_events only when those columns are null
  // (legacy rows predating the 2026-04-21 migration).
  let cancelsAt = null;
  let renewsAt = null;
  let subscriptionStatus = null;
  if (tier === "pro") {
    if (profileRow && (profileRow.pro_until || profileRow.subscription_status)) {
      subscriptionStatus = profileRow.subscription_status ?? null;
      if (profileRow.cancel_at_period_end) {
        cancelsAt = profileRow.pro_until ?? null;
      } else {
        renewsAt = profileRow.pro_until ?? null;
      }
    } else {
      // Legacy fallback for rows that never got touched by the new webhook.
      const { data: eventRows } = await supabase
        .from("billing_events")
        .select("event_type, raw, created_at")
        .eq("user_id", userId)
        .like("event_type", "subscription.%")
        .order("created_at", { ascending: false })
        .limit(10);
      cancelsAt = resolveCancelsAt(eventRows);
    }
  }

  const used = countRow?.count ?? 0;

  res.json({
    tier,
    used,
    limit,
    reset_at: nextUtcMidnightIso(),
    cancels_at: cancelsAt,
    renews_at: renewsAt,
    subscription_status: subscriptionStatus,
  });
}

export default usageHandler;
