// api/billing/portal.js
//
// GET /api/billing/polar/portal — creates a pre-authenticated Polar
// customer-portal session for the signed-in user and 302-redirects to
// the resulting URL. The portal lets users cancel, update payment
// method, and see invoices on Polar's hosted page.
//
// Looks up the customer by externalCustomerId (the user's Supabase UUID
// we set at checkout). If Polar 404s (user never checked out), we
// return 404 so the caller can show "You don't have a subscription".

import { requirePolar } from "./polar-client.js";

let clientOverride = null;

export function _setPolarClientForTests(c) {
  clientOverride = c;
}

function getClient() {
  return clientOverride || requirePolar();
}

export async function portalHandler(req, res) {
  const userId = req.verifiedUserId;
  if (!userId) {
    return res.status(401).json({ error: "Authentication required." });
  }

  // Clients that can't follow a 302 (e.g. fetch from the browser)
  // can request ?json=1 to get {url} back and navigate themselves.
  const wantsJson = req.query?.json === "1";

  try {
    const session = await getClient().customerPortal.sessions.create({
      customerExternalId: userId,
    });
    if (wantsJson) {
      return res.json({ url: session.customerPortalUrl });
    }
    return res.redirect(session.customerPortalUrl);
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    if (status === 404) {
      return res.status(404).json({
        error: "No Polar customer found for this account — you haven't purchased a subscription yet.",
      });
    }
    console.error("[polar-portal] session create failed:", err?.message || err);
    return res
      .status(502)
      .json({ error: "Could not open the billing portal. Try again." });
  }
}

export default portalHandler;
