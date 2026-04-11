// Tests for computeCanShareFiles() — the Web Share API capability check
// used by shared/share-modal.js. The check is a pure function of the
// navigator and File constructor, so it's unit-testable in plain node
// with fake navigators.
//
// Run: node scripts/test-share-capability.js

import assert from "node:assert/strict";
import { computeCanShareFiles } from "../shared/share-capability.js";

// ── Missing environment ─────────────────────────────────────────────

assert.equal(computeCanShareFiles(undefined, File), false);
assert.equal(computeCanShareFiles(null, File), false);
assert.equal(computeCanShareFiles({}, File), false);
assert.equal(computeCanShareFiles({ canShare: () => true }, undefined), false);
assert.equal(computeCanShareFiles({ canShare: () => true }, null), false);

// ── canShare returns a boolean ──────────────────────────────────────

{
  let calls = 0;
  const nav = {
    canShare: (arg) => {
      calls++;
      assert.ok(arg && Array.isArray(arg.files) && arg.files.length === 1,
        "should be called with { files: [File] }");
      return true;
    },
  };
  assert.equal(computeCanShareFiles(nav, File), true);
  assert.equal(calls, 1, "canShare should be invoked exactly once");
}

{
  const nav = { canShare: () => false };
  assert.equal(computeCanShareFiles(nav, File), false);
}

// Non-boolean truthy/falsy return values get coerced to a real boolean.
assert.equal(computeCanShareFiles({ canShare: () => 1 }, File), true);
assert.equal(computeCanShareFiles({ canShare: () => 0 }, File), false);
assert.equal(computeCanShareFiles({ canShare: () => "yes" }, File), true);

// ── canShare throws → gracefully returns false ─────────────────────

{
  const nav = {
    canShare: () => {
      throw new TypeError("file sharing unsupported");
    },
  };
  assert.equal(computeCanShareFiles(nav, File), false);
}

// ── File constructor throws → gracefully returns false ─────────────

{
  const BadFile = function () {
    throw new Error("no File in this env");
  };
  const nav = { canShare: () => true };
  assert.equal(computeCanShareFiles(nav, BadFile), false);
}

console.log("share-capability tests: OK");
