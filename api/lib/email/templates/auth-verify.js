// api/lib/email/templates/auth-verify.js
// Email sent to users who just signed up. Supabase Auth can't call this
// function directly — the rendered HTML is uploaded to Resend as a
// template, and Supabase fires it via SMTP with {{ .ConfirmationURL }}
// substituted at send time. See scripts/upload-resend-templates.mjs.

import { renderEmail } from "../shell.js";
import { renderCodeBlock } from "../components.js";
import { T } from "../tokens.js";

export function renderAuthVerify({ user, confirmUrl }) {
  const body = `
    <p style="margin:0 0 14px;">Welcome to Emersus. Tap the button below and you're in — the link is good for 24 hours.</p>
    <p style="margin:0 0 6px; color:${T.dim}; font-size:13px;">Button not working? Paste this into your browser:</p>
    ${renderCodeBlock({ code: confirmUrl })}
  `;
  return renderEmail({
    preheader: "You're one tap away from confirming your email.",
    eyebrow: "Account",
    title: "Confirm your email.",
    body,
    cta: { label: "Confirm email →", href: confirmUrl },
    footer: { toEmail: user.email },
  });
}
