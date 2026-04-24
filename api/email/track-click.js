// api/email/track-click.js
// GET /api/email/track/click?m=<send_id>&to=<b64url>&k=<hmac>
// Verifies HMAC, logs 'clicked' event, 302s to target.
// Fails closed (400) on any verification failure. Logging errors do not
// block the redirect — better to ship the user to the right URL than to
// black-hole them on a transient DB hiccup.

import { verifyClick } from "../lib/email/tracking.js";
import { supabaseAdmin } from "../lib/clients.js";

export async function handleTrackClick({ query }, { supabase = supabaseAdmin } = {}) {
  const sendId = String(query?.m || "").trim();
  const toEnc  = String(query?.to || "").trim();
  const sig    = String(query?.k || "").trim();
  if (!sendId || !toEnc || !sig) {
    return { statusCode: 400, headers: {}, body: "missing params" };
  }

  let target;
  try {
    target = Buffer.from(toEnc, "base64url").toString("utf8");
    if (!target) throw new Error("empty target");
    new URL(target); // throws on invalid URL
  } catch {
    return { statusCode: 400, headers: {}, body: "bad target" };
  }

  if (!verifyClick({ sendId, target, sig })) {
    return { statusCode: 400, headers: {}, body: "bad signature" };
  }

  try {
    await supabase.from("email_events").insert({
      send_id: sendId,
      resend_id: "click-" + sendId,
      kind: "clicked",
      payload: { url: target, source: "server-redirect" },
      occurred_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[email-click] log failed:", err.message);
  }

  return { statusCode: 302, headers: { Location: target }, body: null };
}

export async function trackClickExpressHandler(req, res) {
  const result = await handleTrackClick({ query: req.query });
  Object.entries(result.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.status(result.statusCode);
  if (result.body !== null) res.send(result.body);
  else res.end();
}
