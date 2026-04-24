import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail } from "../../api/lib/email/shell.js";

const base = {
  preheader: "You're one tap away.",
  eyebrow: "Account",
  title: "Confirm your email.",
  body: `<p>Welcome.</p>`,
  footer: { toEmail: "sid@example.com" },
};

test("renderEmail returns a full HTML document", () => {
  const html = renderEmail(base);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html\s+lang="en">/);
  assert.match(html, /<\/html>/);
});

test("renderEmail includes color-scheme meta", () => {
  const html = renderEmail(base);
  assert.match(html, /<meta\s+name="color-scheme"\s+content="dark"/);
  assert.match(html, /<meta\s+name="supported-color-schemes"\s+content="dark"/);
});

test("renderEmail includes hidden preheader and the body", () => {
  const html = renderEmail(base);
  assert.match(html, /display:\s*none/);
  assert.match(html, /You&#39;re one tap away\./);
  assert.match(html, /<p>Welcome\.<\/p>/);
});

test("renderEmail includes eyebrow + title", () => {
  const html = renderEmail(base);
  assert.match(html, /Account/);
  assert.match(html, /Confirm your email\./);
});

test("renderEmail escapes eyebrow + title + preheader", () => {
  const html = renderEmail({
    ...base,
    eyebrow: `<script>x</script>`,
    title: `<img onerror=1>`,
    preheader: `<b>hi</b>`,
  });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.doesNotMatch(html, /<img onerror=1>/);
  assert.doesNotMatch(html, /<b>hi<\/b>/);
});

test("renderEmail renders a CTA when cta provided", () => {
  const html = renderEmail({
    ...base,
    cta: { label: "Confirm email →", href: "https://emersus.ai/c?t=1" },
  });
  assert.match(html, /Confirm email →/);
  assert.match(html, /href="https:\/\/emersus\.ai\/c\?t=1"/);
});

test("renderEmail footer shows 'Sent to <email>' line", () => {
  const html = renderEmail(base);
  assert.match(html, /Sent to sid@example\.com/);
});

test("renderEmail marketing adds unsubscribe link", () => {
  const html = renderEmail({
    ...base,
    marketing: true,
    unsubscribeUrl: "https://emersus.ai/api/email/unsubscribe?m=1&b=research_alerts&k=x",
  });
  assert.match(html, /Unsubscribe/);
  assert.match(html, /href="https:\/\/emersus\.ai\/api\/email\/unsubscribe\?m=1&amp;b=research_alerts&amp;k=x"/);
});

test("renderEmail transactional has NO unsubscribe link", () => {
  const html = renderEmail(base);
  assert.doesNotMatch(html, /Unsubscribe/);
});
