// api/email/unsubscribe.js
// GET|POST /api/email/unsubscribe?m=<send_id>&b=<bucket>&k=<hmac>
// HMAC-verified one-click unsubscribe.
// POST is required for List-Unsubscribe-Post: List-Unsubscribe=One-Click;
// same query-string verification as GET.

import { verifyUnsubscribe } from "../lib/email/tracking.js";
import { supabaseAdmin } from "../lib/clients.js";
import { T } from "../lib/email/tokens.js";

const VALID_BUCKETS = new Set(["research_alerts", "engagement", "all_marketing"]);

function renderConfirmationPage({ bucket }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Unsubscribed</title>
<style>body{margin:0;padding:0;background:${T.bg};color:${T.ink};font-family:${T.stack.sans};}
.wrap{max-width:480px;margin:0 auto;padding:80px 24px;text-align:center;}
h1{font-size:28px;font-weight:600;letter-spacing:-0.02em;margin:0 0 12px;}
p{color:${T.muted};line-height:1.6;}
.tag{display:inline-block;font-family:${T.stack.mono};font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${T.accent};margin-bottom:18px;}
a{color:${T.accent};border-bottom:1px solid ${T.accentLine};text-decoration:none;}
</style></head><body>
<div class="wrap">
<div class="tag">• Unsubscribed</div>
<h1>You're unsubscribed.</h1>
<p>You won't receive <strong style="color:${T.ink};">${bucket.replace(/_/g, " ")}</strong> emails from Emersus anymore. You'll still get account and billing notices. Change your mind? <a href="https://emersus.ai/app/profile?tab=notifications">Resubscribe</a>.</p>
</div></body></html>`;
}

export async function handleUnsubscribe({ query }, { supabase = supabaseAdmin } = {}) {
  const sendId = String(query?.m || "").trim();
  const bucket = String(query?.b || "").trim();
  const sig    = String(query?.k || "").trim();
  if (!sendId || !bucket || !sig || !VALID_BUCKETS.has(bucket)) {
    return { statusCode: 400, headers: {}, body: "bad params" };
  }
  if (!verifyUnsubscribe({ sendId, bucket, sig })) {
    return { statusCode: 400, headers: {}, body: "bad signature" };
  }
  const { data: sendRow } = await supabase
    .from("email_sends")
    .select("id, user_id")
    .eq("id", sendId)
    .maybeSingle();
  if (sendRow?.user_id) {
    const upsertResult = await supabase.from("email_unsubscribes").upsert(
      {
        user_id: sendRow.user_id,
        bucket,
        source: "one_click",
      },
      { onConflict: "user_id,bucket" },
    );
    if (upsertResult?.error) {
      // Log but still show the user the confirmation — retrying via
      // List-Unsubscribe is not guaranteed and a 5xx would be worse UX.
      console.error("[email-unsubscribe] upsert failed:", upsertResult.error.message);
    }
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: renderConfirmationPage({ bucket }),
  };
}

export async function unsubscribeExpressHandler(req, res) {
  const result = await handleUnsubscribe({ query: req.query });
  Object.entries(result.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.status(result.statusCode).send(result.body);
}
