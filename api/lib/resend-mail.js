import { Resend } from "resend";

function normalizeRecipient(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || "").trim();
}

export function getResendTemplateId(name) {
  return String(process.env[`RESEND_TEMPLATE_${name}_ID`] || "").trim();
}

export async function sendResendEmail({
  from,
  to,
  subject,
  replyTo,
  cc,
  bcc,
  html,
  text,
  templateId,
  templateVariables,
  tags,
  headers,
}) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const resend = new Resend(apiKey);
  const payload = {
    from,
    to: normalizeRecipient(to),
    subject,
  };

  const normalizedReplyTo = normalizeRecipient(replyTo);
  const normalizedCc = normalizeRecipient(cc);
  const normalizedBcc = normalizeRecipient(bcc);

  if (normalizedReplyTo) payload.replyTo = normalizedReplyTo;
  if (normalizedCc && (!Array.isArray(normalizedCc) || normalizedCc.length > 0)) payload.cc = normalizedCc;
  if (normalizedBcc && (!Array.isArray(normalizedBcc) || normalizedBcc.length > 0)) payload.bcc = normalizedBcc;
  if (tags) payload.tags = tags;
  if (headers) payload.headers = headers;

  if (templateId) {
    payload.template = {
      id: templateId,
      variables: templateVariables || {},
    };
  } else {
    if (html) payload.html = html;
    if (text) payload.text = text;
  }

  return resend.emails.send(payload);
}
