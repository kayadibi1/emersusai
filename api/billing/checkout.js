// api/billing/checkout.js
//
// POST /api/billing/polar/checkout — creates a Polar checkout session
// for the authenticated user and returns {url} for the client to redirect.
// Accepts {plan: 'monthly' | 'yearly'}. Metadata.user_id flows through
// Polar's subscription + webhooks so the webhook handler can flip the
// correct profiles.tier row. external_customer_id enables Polar's
// customer portal to recognize the user on return.

import { requirePolar, resolveProductId } from "./polar-client.js";
import { capture } from "../lib/analytics.js";

let clientOverride = null;

export function _setPolarClientForTests(c) {
  clientOverride = c;
}

function getClient() {
  return clientOverride || requirePolar();
}

function siteUrl() {
  return process.env.SITE_URL || "https://emersus.ai";
}

export async function checkoutHandler(req, res) {
  const userId = req.verifiedUserId;
  if (!userId) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const plan = req.body?.plan;
  if (plan !== "monthly" && plan !== "yearly") {
    return res
      .status(400)
      .json({ error: "plan must be 'monthly' or 'yearly'." });
  }

  let productId;
  try {
    productId = resolveProductId(plan);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const email = req.supabaseUser?.email;

  try {
    const checkout = await getClient().checkouts.create({
      products: [productId],
      customerEmail: email,
      externalCustomerId: userId,
      successUrl: `${siteUrl()}/app/profile?upgraded=1`,
      metadata: { user_id: userId, plan },
    });
    try {
      capture(userId, "billing_checkout_started", { plan });
    } catch (_) { /* analytics best-effort */ }
    return res.json({ url: checkout.url, id: checkout.id });
  } catch (err) {
    console.error("[polar-checkout] create failed:", err?.message || err);
    return res
      .status(502)
      .json({ error: "Could not create a checkout session. Try again." });
  }
}

export default checkoutHandler;
