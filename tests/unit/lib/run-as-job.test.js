// tests/unit/lib/run-as-job.test.js
// Shape test for runAsJob. Full integration coverage is in the Milestone 11
// smoke test. This test confirms the module exports a callable function with
// the expected arity — no live DB or pg-boss connection required.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAsJob } from "../../../scripts/lib/run-as-job.js";

test("runAsJob is exported as a function", () => {
  assert.equal(typeof runAsJob, "function");
});

test("runAsJob accepts at least 2 parameters (jobName, payload)", () => {
  // Function.length counts params before the first default value.
  // options has a default of {}, so length is 2. Both required params exist.
  assert.ok(runAsJob.length >= 2, `expected length >= 2, got ${runAsJob.length}`);
});
