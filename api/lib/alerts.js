// api/lib/alerts.js
// Centralized alert dispatcher. Sends email via Resend, honors the
// alert rate ceiling (>10/hour suppresses), honors ALERT_SILENT env,
// records every alert attempt in public.alert_log.
//
// Per spec §7g:
//   - Recipients: process.env.ALERT_EMAILS (falls back to ADMIN_EMAILS)
//   - Silent mode: ALERT_SILENT=1 logs but does not send
//   - Rate ceiling: > 10 alerts in last hour → suppress
import { supabaseAdmin } from "./clients.js";
import {
  getResendTemplateId,
  sendResendEmail,
} from "./resend-mail.js";

const RATE_CEILING_PER_HOUR = 10;
const FROM_ADDR = process.env.ALERT_FROM_EMAIL ?? "Emersus Alerts <alerts@emersus.ai>";

function parseRecipients() {
  const raw = (process.env.ALERT_EMAILS ?? process.env.ADMIN_EMAILS ?? "");
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * @param {{ type: string, subject: string, body: string, html?: string }} opts
 */
export async function sendAlert({ type, subject, body, html }) {
  // Always log the attempt (even if silent or suppressed)
  const logPayload = { type, subject, body_preview: body?.slice(0, 500), html_present: !!html };
  const { data: logRow, error: logErr } = await supabaseAdmin
    .from("alert_log")
    .insert({ alert_type: type, payload: logPayload })
    .select()
    .single();
  if (logErr) {
    // Log insert failure is worth surfacing but we still try to send
    process.stderr.write(`[alerts] alert_log insert failed: ${logErr.message}\n`);
  }

  // Silent mode: log only
  if (process.env.ALERT_SILENT === "1") {
    return { sent: false, suppressed: "silent_mode", alertLogId: logRow?.id };
  }

  // Rate ceiling: >10 sends in the last hour → suppress
  const { count: recentCount } = await supabaseAdmin
    .from("alert_log")
    .select("id", { count: "exact", head: true })
    .gte("sent_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if ((recentCount ?? 0) > RATE_CEILING_PER_HOUR) {
    return { sent: false, suppressed: "rate_ceiling", recentCount, alertLogId: logRow?.id };
  }

  // Recipients
  const to = parseRecipients();
  if (to.length === 0) {
    return { sent: false, suppressed: "no_recipients", alertLogId: logRow?.id };
  }

  if (!process.env.RESEND_API_KEY) {
    return { sent: false, suppressed: "no_resend_key", alertLogId: logRow?.id };
  }

  try {
    const fallbackHtml =
      html ??
      `<pre style="font-family:monospace;white-space:pre-wrap">${body.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</pre>`;
    const result = await sendResendEmail({
      from: FROM_ADDR,
      to,
      subject,
      text: body,
      html: fallbackHtml,
      templateId: getResendTemplateId("ALERT"),
      templateVariables: {
        alert_type: type,
        subject,
        body,
        body_html: fallbackHtml,
      },
    });
    return { sent: true, resendId: result?.data?.id, alertLogId: logRow?.id };
  } catch (err) {
    process.stderr.write(`[alerts] resend send failed: ${err.message}\n`);
    return { sent: false, suppressed: "send_error", error: err.message, alertLogId: logRow?.id };
  }
}
