// tests/unit/shared/why-this-answer.test.js
//
// Unit tests for the title-equivalent excerpt detection used by the
// "Why this answer?" reveal in shared/react-chat-app.js. The helper is
// extracted to its own module so it can be tested without spinning up
// React.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isTitleEquivalentExcerpt } from "../../../shared/why-this-answer-helpers.js";

test("isTitleEquivalentExcerpt: identical strings", () => {
  assert.equal(
    isTitleEquivalentExcerpt("Sugar and oral health", "Sugar and oral health"),
    true
  );
});

test("isTitleEquivalentExcerpt: case + whitespace insensitive", () => {
  assert.equal(
    isTitleEquivalentExcerpt("  SUGAR and Oral Health\n", "Sugar and oral health"),
    true
  );
});

test("isTitleEquivalentExcerpt: punctuation insensitive", () => {
  assert.equal(
    isTitleEquivalentExcerpt("Sugar, and oral health.", "Sugar and oral health"),
    true
  );
});

test("isTitleEquivalentExcerpt: real abstract is not title-equivalent", () => {
  const excerpt =
    "Sugar consumption has been linked to multiple oral health outcomes including caries and erosion. This review summarizes the evidence...";
  assert.equal(isTitleEquivalentExcerpt(excerpt, "Sugar and oral health"), false);
});

test("isTitleEquivalentExcerpt: title prefix on a real abstract is fine", () => {
  // Some chunks include the title at the top followed by abstract text.
  // Treat as title-equivalent only when the excerpt ADDS little beyond the title.
  const excerpt =
    "Sugar and oral health Sugar consumption has been linked to caries and erosion across multiple cohort studies. This narrative review synthesizes evidence from 2010 to 2024.";
  assert.equal(isTitleEquivalentExcerpt(excerpt, "Sugar and oral health"), false);
});

test("isTitleEquivalentExcerpt: empty/missing inputs return false", () => {
  assert.equal(isTitleEquivalentExcerpt("", "Title"), false);
  assert.equal(isTitleEquivalentExcerpt("Title", ""), false);
  assert.equal(isTitleEquivalentExcerpt(null, "Title"), false);
  assert.equal(isTitleEquivalentExcerpt(undefined, "Title"), false);
});

test("isTitleEquivalentExcerpt: title-prefix with tiny trailing text still counts", () => {
  // Edge case: chunk content "Sugar and oral health 2026" — only adds
  // a year. Should be treated as title-equivalent (no real passage info).
  assert.equal(
    isTitleEquivalentExcerpt("Sugar and oral health 2026", "Sugar and oral health"),
    true
  );
});
