import { renderEmail } from "../shell.js";
import { renderStatRow } from "../components.js";
import { T } from "../tokens.js";

export function renderBillingCancellation({ user, accessThrough, refund, reactivateUrl }) {
  const body = `
    <p style="margin:0 0 18px;">Your subscription is cancelled. Here's what happens next:</p>
    ${renderStatRow({ label: "Access through", value: accessThrough })}
    ${renderStatRow({ label: "Refund",         value: refund })}
    <p style="margin:18px 0 0; color:${T.muted}; font-size:14px;">Your saved library, chat history, and profile stick around — you keep read-only access to everything even on the Free plan.</p>
    <p style="margin:14px 0 0; color:${T.dim}; font-size:13px;">Change your mind? Reactivate in one tap — no data migration.</p>
  `;
  return renderEmail({
    preheader: `Cancellation confirmed — access until ${accessThrough}.`,
    eyebrow: "Billing",
    title: "Cancellation confirmed.",
    body,
    cta: { label: "Reactivate →", href: reactivateUrl },
    footer: { toEmail: user.email },
  });
}
