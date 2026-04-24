// api/lib/email/templates/auth-reset.js
// Email sent to users who requested a password reset. Similar pattern to
// auth-verify: the rendered HTML is uploaded to Resend as a template.

import { renderEmail } from "../shell.js";
import { renderCodeBlock, renderCallout } from "../components.js";
import { T } from "../tokens.js";

export function renderAuthReset({ user, resetUrl, expiresIn }) {
  const body = `
    <p style="margin:0 0 14px;">Someone requested a password reset for your Emersus account. Tap below to pick a new one — the link is valid for ${expiresIn}.</p>
    <p style="margin:0 0 6px; color:${T.dim}; font-size:13px;">Button not working? Paste this into your browser:</p>
    ${renderCodeBlock({ code: resetUrl })}
    ${renderCallout({ tone: "warning", title: "Didn't request this?", body: "Ignore this email — your password won't change unless you open the link." })}
  `;
  return renderEmail({
    preheader: `Reset your Emersus password — link valid for ${expiresIn}.`,
    eyebrow: "Account",
    title: "Reset your password.",
    body,
    cta: { label: "Reset password →", href: resetUrl },
    footer: { toEmail: user.email },
  });
}
