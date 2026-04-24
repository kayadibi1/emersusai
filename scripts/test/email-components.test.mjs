import { test } from "node:test";
import assert from "node:assert/strict";
import { esc } from "../../api/lib/email/components.js";

test("esc escapes &, <, >, quotes", () => {
  assert.equal(esc(`<script>alert("x")</script>`),
    `&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;`);
  assert.equal(esc(`a & b`), `a &amp; b`);
  assert.equal(esc(`it's`), `it&#39;s`);
});

test("esc stringifies non-strings", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(42), "42");
});

import {
  renderButton,
  renderStatRow,
  renderSourceRow,
  renderCallout,
  renderDivider,
  renderCodeBlock,
} from "../../api/lib/email/components.js";

test("renderButton returns a table-wrapped bulletproof button", () => {
  const html = renderButton({ label: "Confirm email", href: "https://example.com/c?t=x" });
  assert.match(html, /<table/);
  assert.match(html, /href="https:\/\/example\.com\/c\?t=x"/);
  assert.match(html, /Confirm email/);
  assert.match(html, /#34d399/);
});

test("renderButton escapes hostile label and href", () => {
  const html = renderButton({
    label: `<script>x</script>`,
    href: `https://e.x/?q="<script>`,
  });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="https:\/\/e\.x\/\?q="<script>"/);
});

test("renderStatRow emits label above value", () => {
  const html = renderStatRow({ label: "Plan", value: "Pro · monthly" });
  assert.match(html, /Plan/);
  assert.match(html, /Pro · monthly/);
  assert.match(html, /#18181b/);
});

test("renderSourceRow has index + title + meta + read link", () => {
  const html = renderSourceRow({
    index: 1,
    title: "Creatine cognition",
    meta: "Exp Gerontol · 2018 · Review",
    href: "https://doi.org/x",
  });
  assert.match(html, />1</);
  assert.match(html, /Creatine cognition/);
  assert.match(html, /Exp Gerontol/);
  assert.match(html, /href="https:\/\/doi\.org\/x"/);
  assert.match(html, /Read/);
});

test("renderCallout supports info|warning|danger tones", () => {
  for (const tone of ["info", "warning", "danger"]) {
    const html = renderCallout({ tone, title: "Heads up", body: "Watch this." });
    assert.match(html, /Heads up/);
    assert.match(html, /Watch this\./);
  }
});

test("renderCallout danger tone uses danger color", () => {
  const html = renderCallout({ tone: "danger", body: "Oh no" });
  assert.match(html, /#f87171/);
});

test("renderDivider is a single hairline row", () => {
  const html = renderDivider();
  assert.match(html, /<tr/);
  assert.match(html, /rgba\(255,255,255,0\.10\)/);
});

test("renderCodeBlock preserves long tokens and escapes", () => {
  const html = renderCodeBlock({
    code: `https://emersus.ai/x?t=abc<script>`,
  });
  assert.match(html, /abc&lt;script&gt;/);
  assert.match(html, /word-break:\s*break-all/);
});
