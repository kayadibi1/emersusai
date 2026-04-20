// api/billing/webhook.js
//
// POST /api/billing/polar/webhook — Polar signature-verified webhook.
// Splits verification (webhookHandler) from business logic
// (handleVerifiedEvent) so the business logic is easy to unit-test
// without having to forge signatures.
//
// Idempotency: we INSERT INTO billing_events (external_id UNIQUE).
// A conflict means we've seen this event before (Polar retries on any
// non-2xx response) → skip downstream work but still return 2xx so
// Polar stops retrying.
//
// Tier mapping: subscription.* events carry a `status` field. We flip
// tier=pro when status is 'active' or 'trialing'; tier=free on
// 'past_due' | 'revoked' | 'unpaid' | 'incomplete_expired'. A bare
// subscription.canceled (user clicked cancel but still has access
// until period end) doesn't change tier — the eventual revoked event
// is what demotes them.

import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { supabaseAdmin } from "../lib/clients.js";
import { invalidateTier as invalidateTierDefault } from "../emersus/user-rate-limit.js";

const PRO_STATUSES = new Set(["active", "trialing"]);
const FREE_STATUSES = new Set([
  "past_due",
  "revoked",
  "unpaid",
  "incomplete_expired",
]);

function extractUserId(event) {
  return (
    event?.data?.metadata?.user_id ||
    event?.data?.customer?.external_customer_id ||
    null
  );
}

/**
 * Core business logic. Pure enough to unit-test: takes the already-
 * verified event + dep-injected supabase + invalidateTier. externalId
 * is the Standard-Webhooks id from the 'webhook-id' header — it's the
 * authoritative dedup key for retries. Falls back to a type+resource
 * composite if the header is missing.
 */
export async function handleVerifiedEvent(
  event,
  {
    supabase = supabaseAdmin,
    invalidateTier = invalidateTierDefault,
    externalId = null,
  } = {}
) {
  const userId = extractUserId(event);
  const dedupKey =
    externalId || `${event.type}:${event.data?.id || "unknown"}`;

  // Idempotency: try to insert first. If we conflict on external_id,
  // this event was already processed — skip downstream work.
  const insertResult = await supabase.from("billing_events").insert({
    external_id: dedupKey,
    user_id: userId,
    event_type: event.type,
    raw: event,
  });

  if (insertResult?.error) {
    if (insertResult.error.code === "23505") {
      // Unique violation → already processed. Silent no-op.
      return { status: "duplicate" };
    }
    // Unexpected error — log and skip downstream so we don't double-apply
    // on retry.
    console.error(
      "[polar-webhook] billing_events insert failed:",
      insertResult.error.message || insertResult.error
    );
    return { status: "insert_error" };
  }

  // order.refunded defensively revokes Pro. A refund in Polar's dashboard
  // doesn't always auto-cancel the subscription, so if we didn't demote
  // on this signal we could have a refunded user still on tier='pro'.
  if (event.type === "order.refunded") {
    if (!userId) {
      console.warn("[polar-webhook] order.refunded without user_id");
      return { status: "no_user" };
    }
    const updateResult = await supabase
      .from("profiles")
      .update({ tier: "free" })
      .eq("id", userId);
    if (updateResult?.error) {
      console.error("[polar-webhook] refund tier update failed:",
        updateResult.error.message);
      return { status: "update_error" };
    }
    invalidateTier(userId);
    return { status: "tier_changed", tier: "free" };
  }

  // All other non-subscription events are logged only.
  if (!event.type?.startsWith("subscription.")) {
    return { status: "logged" };
  }

  // subscription.canceled fires when the user asks to cancel but still
  // has access until period end. Don't demote — wait for revoked.
  if (event.type === "subscription.canceled") {
    return { status: "logged" };
  }

  if (!userId) {
    console.warn(
      `[polar-webhook] ${event.type} without user_id — cannot update tier`
    );
    return { status: "no_user" };
  }

  const status = event.data?.status;
  let nextTier = null;
  if (PRO_STATUSES.has(status)) nextTier = "pro";
  else if (FREE_STATUSES.has(status)) nextTier = "free";

  if (!nextTier) {
    return { status: "no_change" };
  }

  const updateResult = await supabase
    .from("profiles")
    .update({ tier: nextTier })
    .eq("id", userId);

  if (updateResult?.error) {
    console.error(
      "[polar-webhook] profile tier update failed:",
      updateResult.error.message || updateResult.error
    );
    return { status: "update_error" };
  }

  invalidateTier(userId);
  return { status: "tier_changed", tier: nextTier };
}

/**
 * Express handler — verifies the signature, then delegates to
 * handleVerifiedEvent. Requires express.raw() on the mount so req.body
 * is a Buffer, not a parsed JSON object.
 */
export async function webhookHandler(req, res) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[polar-webhook] POLAR_WEBHOOK_SECRET not set");
    return res.status(500).send("");
  }

  let event;
  try {
    event = validateEvent(req.body, req.headers, secret);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return res.status(403).send("");
    }
    console.error("[polar-webhook] validateEvent error:", err);
    return res.status(400).send("");
  }

  // Standard-Webhooks delivery id. Polar sets this header; it's the
  // canonical dedup key across retries.
  const externalId =
    req.headers["webhook-id"] || req.headers["x-webhook-id"] || null;

  try {
    await handleVerifiedEvent(event, { externalId });
    return res.status(202).send("");
  } catch (err) {
    console.error("[polar-webhook] handler error:", err);
    // 500 tells Polar to retry — we want that for transient DB issues.
    return res.status(500).send("");
  }
}

export default webhookHandler;
