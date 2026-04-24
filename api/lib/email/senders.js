// api/lib/email/senders.js
// Per-template sender wrappers. Each one:
//   1. (marketing only) checks the suppression list
//   2. (optional) checks idempotency key against email_sends.tags
//   3. inserts an email_sends row, captures send_id
//   4. renders the template (closure over send_id for signed CTAs)
//   5. calls sendResendEmail with tags + optional headers
//   6. patches email_sends.resend_id
//
// Returns { sendId, resendId, skipped? }.

import { sendResendEmail } from "../resend-mail.js";
import { supabaseAdmin } from "../clients.js";
import { buildTrackedUrl, signUnsubscribe } from "./tracking.js";

import { renderAuthVerify }           from "./templates/auth-verify.js";
import { renderAuthReset }            from "./templates/auth-reset.js";
import { renderAuthWelcome }          from "./templates/auth-welcome.js";
import { renderAuthPasswordChanged }  from "./templates/auth-password-changed.js";
import { renderBillingReceipt }       from "./templates/billing-receipt.js";
import { renderBillingRenewal }       from "./templates/billing-renewal.js";
import { renderBillingPaymentFailed } from "./templates/billing-payment-failed.js";
import { renderBillingCancellation }  from "./templates/billing-cancellation.js";
import { renderLegalTosUpdate }       from "./templates/legal-tos-update.js";
import { renderLegalPrivacyUpdate }   from "./templates/legal-privacy-update.js";
import { renderDataExportReady }      from "./templates/data-export-ready.js";
import { renderResearchNewPaper }     from "./templates/research-new-paper.js";

const FROM      = () => process.env.RESEND_FROM_EMAIL || "Emersus <noreply@emersus.ai>";
const REPLY_TO  = () => process.env.RESEND_REPLY_TO_EMAIL || "info@emersus.ai";

function buildUnsubscribeUrl({ sendId, bucket, baseUrl = "https://emersus.ai" }) {
  const sig = signUnsubscribe({ sendId, bucket });
  const q = new URLSearchParams({ m: sendId, b: bucket, k: sig });
  return `${baseUrl}/api/email/unsubscribe?${q.toString()}`;
}

/** Suppression check. Fail-open on DB error (logged upstream). */
async function isSuppressed({ userId, bucket, supabase }) {
  if (!userId) return false;
  const { data, error } = await supabase
    .from("email_unsubscribes")
    .select("bucket")
    .eq("user_id", userId)
    .in("bucket", [bucket, "all_marketing"]);
  if (error) return false;
  return (data?.length || 0) > 0;
}

/** Core flow. renderFn gets (sendId). buildHeaders gets (sendId) and may return undefined. */
async function sendEmail({
  template,
  userId,
  to,
  subject,
  renderFn,
  marketing = false,
  marketingBucket,
  idempotencyKey,
  buildHeaders,
  supabase = supabaseAdmin,
  send = sendResendEmail,
}) {
  if (marketing) {
    if (!marketingBucket) {
      throw new Error(`marketingBucket required for marketing template ${template}`);
    }
    const suppressed = await isSuppressed({ userId, bucket: marketingBucket, supabase });
    if (suppressed) return { sendId: null, resendId: null, skipped: "suppressed" };
  }

  if (idempotencyKey) {
    const existing = await supabase
      .from("email_sends")
      .select("id, resend_id")
      .contains("tags", { idempotency_key: idempotencyKey })
      .limit(1)
      .maybeSingle?.();
    if (existing?.data?.id) {
      return { sendId: existing.data.id, resendId: existing.data.resend_id, skipped: "idempotent" };
    }
  }

  const { data: sendRow, error: insertErr } = await supabase
    .from("email_sends")
    .insert({
      template,
      user_id: userId || null,
      to_email: to,
      subject,
      tags: idempotencyKey ? { idempotency_key: idempotencyKey } : {},
    })
    .select("id")
    .single();
  if (insertErr) throw new Error(`email_sends insert failed: ${insertErr.message}`);
  const sendId = sendRow.id;

  const html    = renderFn(sendId);
  const headers = buildHeaders ? buildHeaders(sendId) : undefined;

  const tags = [
    { name: "template", value: template },
    { name: "send_id",  value: sendId },
  ];
  if (userId) tags.push({ name: "user_id", value: userId });

  const result = await send({
    from: FROM(),
    to,
    replyTo: REPLY_TO(),
    subject,
    html,
    tags,
    ...(headers ? { headers } : {}),
  });

  const resendId = result?.data?.id || null;
  if (resendId) {
    await supabase.from("email_sends").update({ resend_id: resendId }).eq("id", sendId);
  }

  return { sendId, resendId };
}

// ================ per-template senders ================

export async function sendAuthVerify({ userId, to, confirmUrl }) {
  return sendEmail({
    template: "auth-verify",
    userId, to,
    subject: "Confirm your email",
    renderFn: () => renderAuthVerify({ user: { email: to }, confirmUrl }),
  });
}

export async function sendAuthReset({ userId, to, resetUrl, expiresIn }) {
  return sendEmail({
    template: "auth-reset",
    userId, to,
    subject: "Reset your Emersus password",
    renderFn: () => renderAuthReset({ user: { email: to }, resetUrl, expiresIn }),
  });
}

export async function sendAuthWelcome({ userId, to, samplePrompts }) {
  return sendEmail({
    template: "auth-welcome",
    userId, to,
    subject: "Welcome to Emersus",
    renderFn: (sendId) => {
      const appUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/app/",
        utmCampaign: "auth-welcome", marketing: false, userId,
      });
      return renderAuthWelcome({ user: { email: to }, appUrl, samplePrompts });
    },
  });
}

export async function sendAuthPasswordChanged({ userId, to, changedAt, device, location, ip }) {
  return sendEmail({
    template: "auth-password-changed",
    userId, to,
    subject: "Your password was changed",
    renderFn: (sendId) => {
      const resetUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/auth/reset-password",
        utmCampaign: "auth-password-changed", marketing: false, userId,
      });
      return renderAuthPasswordChanged({ user: { email: to }, changedAt, device, location, ip, resetUrl });
    },
  });
}

export async function sendBillingReceipt({ userId, to, plan, period, amount, cardLast4, invoiceUrl }) {
  return sendEmail({
    template: "billing-receipt",
    userId, to,
    subject: `Receipt from Emersus — ${amount}`,
    renderFn: (sendId) => {
      const tracked = buildTrackedUrl({
        sendId, target: invoiceUrl,
        utmCampaign: "billing-receipt", marketing: false, userId,
      });
      return renderBillingReceipt({ user: { email: to }, plan, period, amount, cardLast4, invoiceUrl: tracked });
    },
  });
}

export async function sendBillingRenewal({ userId, to, plan, nextChargeAt, amount, idempotencyKey }) {
  return sendEmail({
    template: "billing-renewal",
    userId, to,
    subject: `Your Emersus subscription renews ${nextChargeAt}`,
    idempotencyKey,
    renderFn: (sendId) => {
      const manageUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/app/profile?tab=billing",
        utmCampaign: "billing-renewal", marketing: false, userId,
      });
      return renderBillingRenewal({ user: { email: to }, plan, nextChargeAt, amount, manageUrl });
    },
  });
}

export async function sendBillingPaymentFailed({ userId, to, cardLast4, reason, retryAt, finalAttemptAt }) {
  return sendEmail({
    template: "billing-payment-failed",
    userId, to,
    subject: "We couldn't charge your card",
    renderFn: (sendId) => {
      const updateUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/app/profile?tab=billing",
        utmCampaign: "billing-payment-failed", marketing: false, userId,
      });
      return renderBillingPaymentFailed({ user: { email: to }, cardLast4, reason, retryAt, finalAttemptAt, updateUrl });
    },
  });
}

export async function sendBillingCancellation({ userId, to, accessThrough, refund }) {
  return sendEmail({
    template: "billing-cancellation",
    userId, to,
    subject: "Your subscription is cancelled",
    renderFn: (sendId) => {
      const reactivateUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/pricing/",
        utmCampaign: "billing-cancellation", marketing: false, userId,
      });
      return renderBillingCancellation({ user: { email: to }, accessThrough, refund, reactivateUrl });
    },
  });
}

export async function sendLegalTosUpdate({ userId, to, summary, changes, effectiveAt }) {
  return sendEmail({
    template: "legal-tos-update",
    userId, to,
    subject: `Updated Terms of Service · effective ${effectiveAt}`,
    renderFn: (sendId) => {
      const termsUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/terms/",
        utmCampaign: "legal-tos-update", marketing: false, userId,
      });
      return renderLegalTosUpdate({ user: { email: to }, summary, changes, effectiveAt, termsUrl });
    },
  });
}

export async function sendLegalPrivacyUpdate({ userId, to, summary, changes, effectiveAt }) {
  return sendEmail({
    template: "legal-privacy-update",
    userId, to,
    subject: `Updated Privacy Policy · effective ${effectiveAt}`,
    renderFn: (sendId) => {
      const privacyUrl = buildTrackedUrl({
        sendId, target: "https://emersus.ai/privacy/",
        utmCampaign: "legal-privacy-update", marketing: false, userId,
      });
      return renderLegalPrivacyUpdate({ user: { email: to }, summary, changes, effectiveAt, privacyUrl });
    },
  });
}

export async function sendDataExportReady({ userId, to, downloadUrl, size, rows, format, expiresIn, sha256 }) {
  return sendEmail({
    template: "data-export-ready",
    userId, to,
    subject: "Your data export is ready",
    renderFn: (sendId) => {
      const tracked = buildTrackedUrl({
        sendId, target: downloadUrl,
        utmCampaign: "data-export-ready", marketing: false, userId,
      });
      return renderDataExportReady({ user: { email: to }, downloadUrl: tracked, size, rows, format, expiresIn, sha256 });
    },
  });
}

export async function sendResearchNewPaper({ userId, to, topic, paper, reason, idempotencyKey }) {
  return sendEmail({
    template: "research-new-paper",
    userId, to,
    subject: `New paper on ${topic}: ${paper.title.slice(0, 48)}…`,
    marketing: true,
    marketingBucket: "research_alerts",
    idempotencyKey,
    renderFn: (sendId) => {
      const readUrl = buildTrackedUrl({
        sendId, target: `https://emersus.ai/chat?ref=new-paper&p=${encodeURIComponent(paper.doi)}`,
        utmCampaign: "research-new-paper", marketing: true, userId,
      });
      const unsubscribeUrl = buildUnsubscribeUrl({ sendId, bucket: "research_alerts" });
      return renderResearchNewPaper({ user: { email: to }, topic, paper, readUrl, reason, unsubscribeUrl });
    },
    buildHeaders: (sendId) => {
      const url = buildUnsubscribeUrl({ sendId, bucket: "research_alerts" });
      return {
        "List-Unsubscribe": `<${url}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      };
    },
  });
}
