// api/lib/email/shell.js
// Email shell: full HTML document, 600px centered table, Graphite·Jade dark.
// One exported function; every template calls it with slots filled.

import { T } from "./tokens.js";
import { esc } from "./components.js";

/**
 * @param {Object} p
 * @param {string} p.preheader   inbox preview text (escaped, padded)
 * @param {string} p.eyebrow     uppercased tag above title
 * @param {string} p.title       h1 text
 * @param {string} p.body        raw HTML (components are trusted)
 * @param {{label:string,href:string}} [p.cta]
 * @param {{toEmail:string}} p.footer
 * @param {boolean} [p.marketing=false]
 * @param {string} [p.unsubscribeUrl]  required if marketing=true
 */
export function renderEmail({
  preheader,
  eyebrow,
  title,
  body,
  cta,
  footer,
  marketing = false,
  unsubscribeUrl,
}) {
  // Preheader padded with zero-width spaces so Gmail doesn't fill the
  // preview line with body copy.
  const preheaderPad = "​‌‍﻿".repeat(20);
  const preheaderHtml = `<div style="display:none; overflow:hidden; line-height:1; max-height:0; max-width:0; opacity:0; visibility:hidden;">${esc(preheader)}${preheaderPad}</div>`;

  const ctaHtml = cta
    ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;">
        <tr><td bgcolor="${T.accent}" style="background:${T.accent}; border-radius:2px;">
          <a href="${esc(cta.href)}" target="_blank" rel="noopener" style="display:inline-block; padding:13px 22px; font-family:${T.stack.sans}; font-size:14px; font-weight:600; line-height:1; color:${T.accentInk}; text-decoration:none; letter-spacing:-0.005em;">${esc(cta.label)}</a>
        </td></tr>
      </table>`
    : "";

  const unsubLink = marketing && unsubscribeUrl
    ? ` · <a href="${esc(unsubscribeUrl)}" style="color:${T.dim}; text-decoration:none; border-bottom:1px solid ${T.line};">Unsubscribe</a>`
    : "";

  const legal = ` · <a href="https://emersus.ai/privacy/" style="color:${T.dim}; text-decoration:none; border-bottom:1px solid ${T.line};">Privacy</a> · <a href="https://emersus.ai/terms/" style="color:${T.dim}; text-decoration:none; border-bottom:1px solid ${T.line};">Terms</a>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(title)}</title>
<style>
  body { margin:0; padding:0; background:${T.bg}; }
  @media (max-width: 480px) {
    .em-pad { padding-left: 18px !important; padding-right: 18px !important; }
    .em-inner { padding: 28px 18px 22px !important; }
    .em-footer { padding: 18px !important; }
    .em-h1 { font-size: 24px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background:${T.bg}; color:${T.ink}; font-family:${T.stack.sans}; -webkit-font-smoothing:antialiased;">
${preheaderHtml}
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${T.bg};">
  <tr><td align="center" class="em-pad" style="padding:28px 12px;">
    <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:${T.surface}; border:1px solid ${T.line};">
      <tr><td style="height:1px; line-height:1px; font-size:1px; background:${T.accentLine};">&nbsp;</td></tr>
      <tr><td class="em-inner" style="padding:36px 32px 28px;">
        <div style="font-family:${T.stack.sans}; font-size:15px; font-weight:600; letter-spacing:-0.02em; color:${T.ink}; margin-bottom:28px;">em<b style="color:${T.accent}; font-weight:600;">∴</b>rsus</div>
        <div style="font-family:${T.stack.mono}; font-size:11px; font-weight:500; letter-spacing:0.18em; text-transform:uppercase; color:${T.accent}; margin-bottom:12px;">
          <span style="display:inline-block; width:6px; height:6px; background:${T.accent}; border-radius:50%; margin-right:8px; vertical-align:2px;">&nbsp;</span>${esc(eyebrow)}
        </div>
        <h1 class="em-h1" style="margin:0 0 14px; font-family:${T.stack.sans}; font-size:28px; font-weight:600; line-height:1.15; letter-spacing:-0.02em; color:${T.ink};">${esc(title)}</h1>
        <div style="font-family:${T.stack.sans}; font-size:15px; line-height:1.65; color:${T.muted};">${body}</div>
        ${ctaHtml}
      </td></tr>
      <tr><td class="em-footer" style="padding:20px 32px 28px; border-top:1px solid ${T.line}; font-family:${T.stack.mono}; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:${T.dim}; line-height:1.9;">
        Sent to ${esc(footer.toEmail)}<br>
        Emersus AI · <a href="mailto:info@emersus.ai" style="color:${T.dim}; text-decoration:none; border-bottom:1px solid ${T.line};">info@emersus.ai</a>${legal}${unsubLink}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
