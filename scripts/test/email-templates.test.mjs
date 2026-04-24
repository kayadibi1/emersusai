import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURES } from "../email-fixtures.js";
import { renderAuthVerify } from "../../api/lib/email/templates/auth-verify.js";

test("auth-verify: renders full HTML document", () => {
  const html = renderAuthVerify(FIXTURES["auth-verify"]);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /Confirm your email\./);
});

test("auth-verify: contains the confirmation URL in the CTA", () => {
  const fx = FIXTURES["auth-verify"];
  const html = renderAuthVerify(fx);
  assert.match(html, new RegExp(escRe(fx.confirmUrl)));
});

test("auth-verify: escapes hostile strings from fixture", () => {
  const html = renderAuthVerify(FIXTURES["auth-verify"]);
  // Fixture user name contains <script>alert(1)</script>
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("auth-verify: shows the URL in a code block fallback", () => {
  const fx = FIXTURES["auth-verify"];
  const html = renderAuthVerify(fx);
  // The monospace code block uses word-break:break-all
  assert.match(html, /word-break:\s*break-all/);
});

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
