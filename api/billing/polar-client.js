// api/billing/polar-client.js
//
// Singleton Polar SDK client + constant lookups for product IDs.
// Reads env lazily on first access so tests / server boot don't fail
// when these vars are absent in non-prod runs. Callers that require
// Polar should call requirePolar() — it throws a clear error when
// POLAR_ACCESS_TOKEN is missing, instead of letting the SDK fail with
// an opaque 401 inside a handler.

import { Polar } from "@polar-sh/sdk";

let client = null;

export function requirePolar() {
  if (client) return client;

  const token = process.env.POLAR_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "POLAR_ACCESS_TOKEN is not set — cannot talk to Polar. " +
        "See ~/app/.env on Hetzner or .env locally."
    );
  }

  // We're live on production Polar. No server:'sandbox' flag.
  client = new Polar({ accessToken: token });
  return client;
}

export const PRODUCT_IDS = {
  get monthly() {
    const id = process.env.POLAR_PRODUCT_ID_MONTHLY;
    if (!id) throw new Error("POLAR_PRODUCT_ID_MONTHLY is not set.");
    return id;
  },
  get yearly() {
    const id = process.env.POLAR_PRODUCT_ID_YEARLY;
    if (!id) throw new Error("POLAR_PRODUCT_ID_YEARLY is not set.");
    return id;
  },
};

export function resolveProductId(plan) {
  if (plan === "monthly") return PRODUCT_IDS.monthly;
  if (plan === "yearly") return PRODUCT_IDS.yearly;
  throw new Error(`Unknown plan: ${plan}. Expected 'monthly' or 'yearly'.`);
}

// Test-only: reset the cached client so a test can swap POLAR_ACCESS_TOKEN.
export function _resetClientForTests() {
  client = null;
}
