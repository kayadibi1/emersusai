import { renderEmail } from "../shell.js";
import { renderStatRow, renderCallout } from "../components.js";
import { T } from "../tokens.js";

export function renderBillingPaymentFailed({ user, cardLast4, reason, retryAt, finalAttemptAt, updateUrl }) {
  const body = `
    ${renderCallout({ tone: "warning", title: "Payment didn't go through", body: reason })}
    ${renderStatRow({ label: "Card",            value: `•••• ${cardLast4}` })}
    ${renderStatRow({ label: "Next retry",      value: retryAt })}
    ${renderStatRow({ label: "Final attempt",   value: finalAttemptAt })}
    <p style="margin:18px 0 0; color:${T.muted}; font-size:14px;">You still have full access until the final attempt. Update your card and we'll re-run the charge.</p>
  `;
  return renderEmail({
    preheader: `We couldn't charge your card — card ending ${cardLast4}.`,
    eyebrow: "Billing",
    title: "Payment didn't go through.",
    body,
    cta: { label: "Update payment →", href: updateUrl },
    footer: { toEmail: user.email },
  });
}
