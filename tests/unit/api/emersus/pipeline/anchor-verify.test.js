// tests/unit/api/emersus/pipeline/anchor-verify.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeForSubstring } from "../../../../../api/emersus/pipeline/anchor-verify.js";

test("normalize lowercases", () => {
  assert.equal(normalizeForSubstring("Trained Men"), "trained men");
});

test("normalize collapses whitespace", () => {
  assert.equal(normalizeForSubstring("  trained\nmen  "), "trained men");
});

test("normalize unifies '5 g' / '5g' / '5 grams'", () => {
  assert.equal(normalizeForSubstring("5 g"), "5g");
  assert.equal(normalizeForSubstring("5g"), "5g");
  assert.equal(normalizeForSubstring("5 grams"), "5g");
  assert.equal(normalizeForSubstring("5  G"), "5g");
});

test("normalize unifies week/wk", () => {
  assert.equal(normalizeForSubstring("8 weeks"), "8wk");
  assert.equal(normalizeForSubstring("8 wk"), "8wk");
  assert.equal(normalizeForSubstring("eight weeks"), "8wk");
  assert.equal(normalizeForSubstring("twelve wk"), "12wk");
});

test("normalize converts number-words up to twenty", () => {
  assert.equal(normalizeForSubstring("twenty subjects"), "20 subjects");
});

test("normalize handles null/undefined", () => {
  assert.equal(normalizeForSubstring(null), "");
  assert.equal(normalizeForSubstring(undefined), "");
});
