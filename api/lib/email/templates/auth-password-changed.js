// api/lib/email/templates/auth-password-changed.js
// Email sent when a user's password is changed. Shows device, location, IP
// with a danger callout and immediate reset CTA.

import { renderEmail } from "../shell.js";
import { renderStatRow, renderCallout } from "../components.js";

export function renderAuthPasswordChanged({ user, changedAt, device, location, ip, resetUrl }) {
  const stats = [
    renderStatRow({ label: "Changed at",  value: changedAt }),
    renderStatRow({ label: "Device",      value: device }),
    renderStatRow({ label: "Location",    value: location }),
    renderStatRow({ label: "IP address",  value: ip }),
  ].join("");

  const body = `
    <p style="margin:0 0 18px;">Your Emersus password was just changed. If that was you, no action needed.</p>
    ${stats}
    ${renderCallout({ tone: "danger", title: "Didn't do this?", body: "Reset your password immediately. Your account may be compromised." })}
  `;
  return renderEmail({
    preheader: "Your Emersus password was changed just now.",
    eyebrow: "Account",
    title: "Password changed.",
    body,
    cta: { label: "I didn't do this →", href: resetUrl },
    footer: { toEmail: user.email },
  });
}
