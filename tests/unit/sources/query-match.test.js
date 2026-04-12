// tests/unit/sources/query-match.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQueryIntoGroups, matchesQueryGroups } from "../../../scripts/sources/_query-match.js";

// ---- parseQueryIntoGroups ----

test("parseQueryIntoGroups splits on top-level AND into ordered groups", () => {
  const q = "(creatine OR phosphocreatine) AND (resistance OR strength)";
  const groups = parseQueryIntoGroups(q);
  assert.equal(groups.length, 2);
  assert.ok(groups[0].includes("creatine"));
  assert.ok(groups[0].includes("phosphocreatine"));
  assert.ok(groups[1].includes("resistance"));
  assert.ok(groups[1].includes("strength"));
});

test("parseQueryIntoGroups preserves quoted phrases as single multi-word terms", () => {
  const q = '(creatine OR "creatine monohydrate") AND ("resistance training" OR strength)';
  const groups = parseQueryIntoGroups(q);
  assert.equal(groups.length, 2);
  assert.ok(groups[0].includes("creatine monohydrate"), `expected 'creatine monohydrate' in group 0, got ${JSON.stringify(groups[0])}`);
  assert.ok(groups[1].includes("resistance training"), `expected 'resistance training' in group 1, got ${JSON.stringify(groups[1])}`);
});

test("parseQueryIntoGroups drops short (<4 char) and stopword tokens", () => {
  const q = "creatine AND the AND this AND or";
  const groups = parseQueryIntoGroups(q);
  // "the", "this", "or" → dropped. Only "creatine" survives in group 0.
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], ["creatine"]);
});

test("parseQueryIntoGroups returns empty array for empty/null query", () => {
  assert.deepEqual(parseQueryIntoGroups(""), []);
  assert.deepEqual(parseQueryIntoGroups(null), []);
  assert.deepEqual(parseQueryIntoGroups(undefined), []);
});

test("parseQueryIntoGroups handles the real creatine topic query correctly", () => {
  const q = '(creatine OR "creatine monohydrate" OR phosphocreatine) AND ("resistance training" OR strength OR hypertrophy OR "exercise performance")';
  const groups = parseQueryIntoGroups(q);
  assert.equal(groups.length, 2, "expected 2 AND-groups");
  // Group 0: creatine-related
  assert.ok(groups[0].includes("creatine"));
  assert.ok(groups[0].includes("creatine monohydrate"));
  assert.ok(groups[0].includes("phosphocreatine"));
  // Group 1: exercise-related
  assert.ok(groups[1].includes("resistance training"));
  assert.ok(groups[1].includes("strength"));
  assert.ok(groups[1].includes("hypertrophy"));
  assert.ok(groups[1].includes("exercise performance"));
});

// ---- matchesQueryGroups ----

test("matchesQueryGroups requires at least one term from every group", () => {
  const groups = [
    ["creatine", "phosphocreatine"],
    ["resistance training", "strength", "hypertrophy"],
  ];
  // Paper with both: passes
  assert.equal(
    matchesQueryGroups(groups, "Creatine supplementation and muscle strength", null),
    true,
  );
  // Paper with only creatine (no exercise word): fails
  assert.equal(
    matchesQueryGroups(groups, "Dietary creatine intake in healthy adults", null),
    false,
  );
  // Paper with only exercise word (no creatine): fails
  assert.equal(
    matchesQueryGroups(groups, "Resistance training effects on cognition", null),
    false,
  );
  // Drug-resistance paper matching "resistance" via substring but no creatine: fails
  assert.equal(
    matchesQueryGroups(groups, "Fast Evolution of SOS-Independent Multi-Drug Resistance", null),
    false,
  );
});

test("matchesQueryGroups falls back to abstract when title doesn't match", () => {
  const groups = [["creatine"], ["strength"]];
  assert.equal(
    matchesQueryGroups(
      groups,
      "A short title with neither term",
      "The abstract mentions creatine supplementation and resistance-based strength gains.",
    ),
    true,
  );
});

test("matchesQueryGroups returns true for empty groups (no filter)", () => {
  assert.equal(matchesQueryGroups([], "anything", null), true);
  assert.equal(matchesQueryGroups(null, "anything", null), true);
});

test("matchesQueryGroups is case-insensitive", () => {
  const groups = [["creatine"], ["strength"]];
  assert.equal(
    matchesQueryGroups(groups, "CREATINE AND STRENGTH TRAINING", null),
    true,
  );
});

test("matchesQueryGroups handles multi-word phrase terms as substrings", () => {
  const groups = [["creatine"], ["resistance training"]];
  // "resistance training" as a phrase present
  assert.equal(
    matchesQueryGroups(groups, "Creatine supplementation during resistance training programs", null),
    true,
  );
  // "resistance" alone without "training" should NOT match the phrase
  assert.equal(
    matchesQueryGroups(groups, "Creatine affects antibiotic resistance pathways", null),
    false,
  );
});
