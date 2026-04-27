// tests/unit/api/emersus/pipeline/mode2-pipeline.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runMode2Pipeline } from "../../../../../api/emersus/pipeline/mode2-pipeline.js";

function makeCtx({ prose = "", evidence = [] } = {}) {
  return {
    prose,
    evidence: { items: evidence },
  };
}

const MOCK_SOURCE = (id) => ({
  id,
  pmid: 1000 + id,
  title: `Source ${id}`,
  excerpt: `excerpt ${id}`,
  abstract: `abstract ${id}`,
  full_text: null,
});

test("returns no rewrite when validation passes (no missing)", async () => {
  const ctx = makeCtx({
    prose: "Original prose citesrc1.",
    evidence: [MOCK_SOURCE(1)],
  });
  const r = await runMode2Pipeline(ctx, {
    extractor: { extract: async () => ({ qualifiers: { population: "x" }, cost_usd: 0.0001, latency_ms: 100 }) },
    validate: async () => ({
      per_claim_missing: [],
      total_missing: 0,
      qualifiers_dropped_breakdown: {},
      cost_usd: 0.0001,
      latency_ms: 50,
    }),
    rewrite: async () => { throw new Error("should not be called"); },
  });
  assert.equal(r.rewritten_prose, null);
  assert.equal(r.telemetry.rewrites_attempted, 0);
  assert.equal(r.telemetry.initial_failures, 0);
  assert.equal(r.telemetry.final_failures, 0);
});

test("rewrite #1 succeeds, no rewrite #2 needed", async () => {
  const ctx = makeCtx({
    prose: "Original creatine improves strength citesrc1.",
    evidence: [MOCK_SOURCE(1)],
  });
  let validateCalls = 0;
  const r = await runMode2Pipeline(ctx, {
    extractor: { extract: async () => ({ qualifiers: { population: "trained men" }, cost_usd: 0.0001, latency_ms: 100 }) },
    validate: async () => {
      validateCalls += 1;
      if (validateCalls === 1) {
        return {
          per_claim_missing: [{ claim_text: "x", source_idx: 1, missing: ["population"] }],
          total_missing: 1,
          qualifiers_dropped_breakdown: { population: 1 },
          cost_usd: 0.0001,
          latency_ms: 50,
        };
      }
      // After rewrite #1 — no missing
      return {
        per_claim_missing: [],
        total_missing: 0,
        qualifiers_dropped_breakdown: {},
        cost_usd: 0.0001,
        latency_ms: 50,
      };
    },
    rewrite: async () => ({
      prose: "Rewritten with trained men citesrc1.",
      length_ratio_acceptable: true,
      cost_usd: 0.001,
      latency_ms: 1000,
    }),
  });
  assert.equal(r.rewritten_prose, "Rewritten with trained men citesrc1.");
  assert.equal(r.telemetry.rewrites_attempted, 1);
  assert.equal(r.telemetry.initial_failures, 1);
  assert.equal(r.telemetry.after_r1_failures, 0);
  assert.equal(r.telemetry.final_failures, 0);
});

test("rewrite #1 still has missing → rewrite #2 fires (preserve_or_hedge)", async () => {
  const ctx = makeCtx({
    prose: "Original.",
    evidence: [MOCK_SOURCE(1)],
  });
  let validateCalls = 0;
  let rewriteModes = [];
  const r = await runMode2Pipeline(ctx, {
    extractor: { extract: async () => ({ qualifiers: { population: "trained men" }, cost_usd: 0.0001, latency_ms: 100 }) },
    validate: async () => {
      validateCalls += 1;
      // initial: 1 missing; after r1: still 1 missing; after r2: 0
      if (validateCalls === 3) {
        return { per_claim_missing: [], total_missing: 0, qualifiers_dropped_breakdown: {}, cost_usd: 0.0001, latency_ms: 50 };
      }
      return {
        per_claim_missing: [{ claim_text: "x", source_idx: 1, missing: ["population"] }],
        total_missing: 1,
        qualifiers_dropped_breakdown: { population: 1 },
        cost_usd: 0.0001,
        latency_ms: 50,
      };
    },
    rewrite: async ({ mode }) => {
      rewriteModes.push(mode);
      return {
        prose: "Rewritten with hedge.",
        length_ratio_acceptable: true,
        cost_usd: 0.001,
        latency_ms: 1000,
      };
    },
  });
  assert.deepEqual(rewriteModes, ["preserve", "preserve_or_hedge"]);
  assert.equal(r.telemetry.rewrites_attempted, 2);
  assert.equal(r.telemetry.after_r1_failures, 1);
  assert.equal(r.telemetry.final_failures, 0);
});

test("MODE2_REWRITE_2_ENABLED=false skips rewrite #2", async () => {
  const ctx = makeCtx({
    prose: "Original.",
    evidence: [MOCK_SOURCE(1)],
  });
  let rewriteCount = 0;
  const r = await runMode2Pipeline(ctx, {
    extractor: { extract: async () => ({ qualifiers: { population: "trained men" }, cost_usd: 0.0001, latency_ms: 100 }) },
    validate: async () => ({
      per_claim_missing: [{ claim_text: "x", source_idx: 1, missing: ["population"] }],
      total_missing: 1,
      qualifiers_dropped_breakdown: { population: 1 },
      cost_usd: 0.0001,
      latency_ms: 50,
    }),
    rewrite: async () => {
      rewriteCount += 1;
      return {
        prose: "Rewritten still missing.",
        length_ratio_acceptable: true,
        cost_usd: 0.001,
        latency_ms: 1000,
      };
    },
    rewrite2Enabled: false,
  });
  assert.equal(rewriteCount, 1, "only rewrite #1 should fire");
  assert.equal(r.telemetry.rewrites_attempted, 1);
});

test("validator error: ship original, no rewrites", async () => {
  const ctx = makeCtx({
    prose: "Original.",
    evidence: [MOCK_SOURCE(1)],
  });
  const r = await runMode2Pipeline(ctx, {
    extractor: { extract: async () => ({ qualifiers: {}, cost_usd: 0.0001, latency_ms: 100 }) },
    validate: async () => ({
      per_claim_missing: [],
      total_missing: 0,
      qualifiers_dropped_breakdown: {},
      cost_usd: 0,
      latency_ms: 0,
      error: "validator timeout",
    }),
    rewrite: async () => { throw new Error("should not be called"); },
  });
  assert.equal(r.rewritten_prose, null);
  assert.equal(r.telemetry.rewrites_attempted, 0);
  assert.match(r.telemetry.errors?.validation || "", /validator timeout/);
});

test("rewrite length-ratio fallback ships original prose", async () => {
  const ctx = makeCtx({
    prose: "This is a fairly long original prose that should not be replaced by a tiny rewrite.",
    evidence: [MOCK_SOURCE(1)],
  });
  const r = await runMode2Pipeline(ctx, {
    extractor: { extract: async () => ({ qualifiers: { population: "x" }, cost_usd: 0.0001, latency_ms: 100 }) },
    validate: async () => ({
      per_claim_missing: [{ claim_text: "x", source_idx: 1, missing: ["population"] }],
      total_missing: 1,
      qualifiers_dropped_breakdown: { population: 1 },
      cost_usd: 0,
      latency_ms: 0,
    }),
    rewrite: async () => ({
      prose: "tiny",
      length_ratio_acceptable: false,
      cost_usd: 0.001,
      latency_ms: 1000,
      error: "length_ratio_out_of_bounds",
    }),
  });
  // rewrite returned bad output → keep original
  assert.equal(r.rewritten_prose, null);
  assert.match(r.telemetry.errors?.rewrite_1 || "", /length_ratio/);
});
