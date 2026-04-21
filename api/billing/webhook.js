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
// 'revoked' | 'incomplete_expired'. We deliberately ignore 'past_due'
// and 'unpaid' so Polar's dunning retry window owns the grace period —
// Polar retries for N days (configured in its dashboard) and emits
// 'revoked' when it gives up. A bare subscription.canceled (user
// clicked cancel but still has access until period end) also doesn't
// change tier — the eventual revoked event is what demotes them.

import { randomUUID } from "node:crypto";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { supabaseAdmin } from "../lib/clients.js";
import { invalidateTier as invalidateTierDefault } from "../emersus/user-rate-limit.js";
import { capture as captureDefault } from "../lib/analytics.js";

const PRO_STATUSES = new Set(["active", "trialing"]);
const FREE_STATUSES = new Set(["revoked", "incomplete_expired"]);

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
    capture = captureDefault,
    externalId = null,
  } = {}
) {
  const userId = extractUserId(event);
  // external_id is NOT NULL in the DB. Build the dedup key defensively so no
  // combination of missing header + missing event fields can ever yield an
  // empty string or null. The random-UUID fallback loses idempotency for
  // that one event, but that's preferable to insert failing entirely — and
  // it only fires when the event shape is already malformed.
  const dedupKey =
    (typeof externalId === "string" && externalId) ||
    (event?.type && event?.data?.id ? `${event.type}:${event.data.id}` : null) ||
    `fallback:${randomUUID()}`;

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
    // Unexpected DB error — throw so the HTTP handler returns 500 and
    // Polar retries. Previously we returned a status string here, which
    // the handler treated as success → Polar saw 202 → no retries, tier
    // never flipped. That bug reached prod on the first live checkout.
    console.error(
      "[polar-webhook] billing_events insert failed:",
      insertResult.error.message || insertResult.error
    );
    throw new Error(
      `billing_events insert failed: ${insertResult.error.message || "unknown"}`
    );
  }

  // order.refunded defensively revokes Pro. A refund in Polar's dashboard
  // doesn't always auto-cancel the subscription, so if we didn't demote
  // on this signal we could have a refunded user still on tier='pro'.
  if (event.type === "order.refunded") {
    if (!userId) {
      console.warn("[polar-webhook] order.refunded without user_id");
      return { status: "no_user" };
    }
    // Clear the denormalized subscription-state columns too — otherwise we
    // leave a profile at tier='free' with pro_until=future +
    // subscription_status='active', and anything that reads those columns
    // without gating on tier sees an inconsistent view.
    const updateResult = await supabase
      .from("profiles")
      .update({
        tier: "free",
        subscription_status: null,
        cancel_at_period_end: false,
        pro_until: null,
      })
      .eq("id", userId);
    if (updateResult?.error) {
      console.error("[polar-webhook] refund tier update failed:",
        updateResult.error.message);
      throw new Error(
        `profile tier update failed: ${updateResult.error.message || "unknown"}`
      );
    }
    invalidateTier(userId);
    try {
      capture(userId, "billing_subscription_revoked", {
        reason: "order_refunded",
        event_type: event.type,
      });
    } catch (_) { /* analytics best-effort */ }
    return { status: "tier_changed", tier: "free" };
  }

  // All other non-subscription events are logged only.
  if (!event.type?.startsWith("subscription.")) {
    return { status: "logged" };
  }

  if (!userId) {
    console.warn(
      `[polar-webhook] ${event.type} without user_id — cannot update profile`
    );
    return { status: "no_user" };
  }

  // Denormalized subscription-state columns on profiles — kept current on
  // every subscription.* event so the UI/usage endpoint can render
  // "Renews on Y" / "Cancels on Y" without scanning billing_events. Order
  // of fields in the patch is intentional: tier is optional (set below only
  // when the status transition warrants it), the rest always reflect the
  // latest payload.
  const patch = {
    subscription_status: event.data?.status ?? null,
    cancel_at_period_end: Boolean(event.data?.cancel_at_period_end),
    pro_until:
      event.data?.current_period_end ||
      event.data?.ends_at ||
      null,
  };

  const status = event.data?.status;
  let nextTier = null;
  if (PRO_STATUSES.has(status)) nextTier = "pro";
  else if (FREE_STATUSES.has(status)) nextTier = "free";
  // subscription.canceled fires when the user asks to cancel but still has
  // access until period end. Don't demote here — wait for revoked. But do
  // persist the cancel_at_period_end flag above so the UI can render the
  // pending-cancellation banner.
  if (event.type !== "subscription.canceled" && nextTier) {
    patch.tier = nextTier;
  }

  const updateResult = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId);

  if (updateResult?.error) {
    console.error(
      "[polar-webhook] profile update failed:",
      updateResult.error.message || updateResult.error
    );
    throw new Error(
      `profile update failed: ${updateResult.error.message || "unknown"}`
    );
  }

  if (patch.tier) {
    invalidateTier(userId);
    try {
      const eventName = patch.tier === "pro"
        ? "billing_subscription_active"
        : "billing_subscription_revoked";
      capture(userId, eventName, {
        event_type: event.type,
        status,
        subscription_id: event.data?.id,
      });
    } catch (_) { /* analytics best-effort */ }
    return { status: "tier_changed", tier: patch.tier };
  }
  return { status: "state_synced" };
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
