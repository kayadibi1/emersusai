// api/lib/email/components.js
// HTML escaping + bulletproof-button + stat/source/callout helpers for
// email templates. Every caller-supplied string MUST go through esc().
//
// All helpers return HTML strings (no DOM). They are composed by templates
// and by scripts/preview-emails.mjs.

import { T } from "./tokens.js";

/** Escape a string for safe interpolation into email HTML. */
export function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Bulletproof button. The outer <table> pattern is the only reliable way
 * to render a pill-shaped CTA across Outlook, Gmail, Apple Mail, and iOS.
 * Do NOT replace with a bare <a> — Outlook on Windows will strip padding
 * and background on <a> elements that are not inside a <td>.
 */
export function renderButton({ label, href }) {
  const h = esc(href);
  const l = esc(label);
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:22px 0;">
    <tr><td bgcolor="${T.accent}" style="background:${T.accent}; border-radius:2px;">
      <a href="${h}" target="_blank" rel="noopener" style="display:inline-block; padding:13px 22px; font-family:${T.stack.sans}; font-size:14px; font-weight:600; line-height:1; color:${T.accentInk}; text-decoration:none; letter-spacing:-0.005em;">${l}</a>
    </td></tr>
  </table>`;
}

/**
 * Label-above-value stat row. Templates .join('') multiple of these into
 * the body to build billing-receipt-style readouts.
 */
export function renderStatRow({ label, value }) {
  return `<div style="margin:10px 0; padding:16px 18px; background:${T.surfaceAlt}; border:1px solid ${T.line};">
    <div style="font-family:${T.stack.mono}; font-size:11px; font-weight:500; letter-spacing:0.18em; text-transform:uppercase; color:${T.dim}; margin-bottom:6px;">${esc(label)}</div>
    <div style="font-family:${T.stack.sans}; font-size:15px; color:${T.ink}; line-height:1.45;">${esc(value)}</div>
  </div>`;
}

/**
 * Citation source row mirroring landing Card 1. index is the [1] / [2]
 * numeric in the inline citation.
 */
export function renderSourceRow({ index, title, meta, href }) {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:8px 0;">
    <tr>
      <td width="32" valign="top" style="padding:12px 10px 12px 14px; background:${T.surfaceAlt}; border-top:1px solid ${T.line}; border-bottom:1px solid ${T.line}; border-left:1px solid ${T.line}; font-family:${T.stack.mono}; font-size:13px; font-weight:600; color:${T.accent};">${esc(index)}</td>
      <td valign="top" style="padding:12px 14px; background:${T.surfaceAlt}; border-top:1px solid ${T.line}; border-bottom:1px solid ${T.line}; border-right:1px solid ${T.line}; font-family:${T.stack.sans}; color:${T.ink};">
        <div style="font-size:14px; font-weight:500; line-height:1.45; color:${T.ink}; margin-bottom:4px;">${esc(title)}</div>
        <div style="font-family:${T.stack.mono}; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:${T.dim}; margin-bottom:8px;">${esc(meta)}</div>
        <a href="${esc(href)}" target="_blank" rel="noopener" style="font-family:${T.stack.mono}; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:${T.accent}; text-decoration:none;">Read →</a>
      </td>
    </tr>
  </table>`;
}

/** Tone-aware callout. Left border + tinted bg. */
export function renderCallout({ tone = "info", title, body }) {
  const palette = {
    info:    { border: T.info,    bg: "rgba(96,165,250,0.08)", text: T.info },
    warning: { border: T.warning, bg: "rgba(251,191,36,0.08)", text: T.warning },
    danger:  { border: T.danger,  bg: "rgba(248,113,113,0.08)", text: T.danger },
  };
  const p = palette[tone] || palette.info;
  const head = title
    ? `<div style="font-family:${T.stack.sans}; font-size:14px; font-weight:600; color:${p.text}; margin-bottom:4px;">${esc(title)}</div>`
    : "";
  return `<div style="margin:16px 0; padding:14px 18px; background:${p.bg}; border-left:3px solid ${p.border};">
    ${head}<div style="font-family:${T.stack.sans}; font-size:14px; color:${T.muted}; line-height:1.6;">${esc(body)}</div>
  </div>`;
}

/** Hairline divider. */
export function renderDivider() {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td style="border-top:1px solid ${T.line}; line-height:1; font-size:1px;">&nbsp;</td></tr>
  </table>`;
}

/** Monospaced code block for fallback URLs, checksums, etc. */
export function renderCodeBlock({ code }) {
  return `<div style="margin:10px 0 18px; padding:12px 14px; background:${T.surfaceAlt}; border:1px solid ${T.line}; font-family:${T.stack.mono}; font-size:12px; line-height:1.55; color:${T.ink}; word-break:break-all; white-space:pre-wrap;">${esc(code)}</div>`;
}
