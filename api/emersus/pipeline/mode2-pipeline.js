// api/emersus/pipeline/mode2-pipeline.js
//
// Orchestrator for the Mode-2 Qualifier-Preservation Verifier.
// Runs: extract qualifiers → validate prose → conditional rewrites → re-validate.
// All sub-functions are dependency-injectable for testing.

import { buildQualifierExtractor } from "./mode2-qualifier-extract.js";
import { validateQualifierPreservation } from "./mode2-validate.js";
import { rewriteForQualifierPreservation } from "./mode2-rewriter.js";
import { mode2Rewrite2Enabled } from "./mode2-flags.js";

/**
 * Run the MQPV pipeline against a chat context.
 *
 * @param {Object} ctx — emersus pipeline ctx with ctx.prose + ctx.evidence.items
 * @param {Object} [deps] — for testing
 * @param {Object} [deps.extractor] — { extract(source) } pre-built (allows custom callJudge)
 * @param {Function} [deps.validate] — validateQualifierPreservation
 * @param {Function} [deps.rewrite] — rewriteForQualifierPreservation
 * @param {boolean} [deps.rewrite2Enabled] — override env flag
 * @returns {Promise<{ rewritten_prose: string|null, telemetry: object }>}
 */
export async function runMode2Pipeline(ctx, deps = {}) {
  const t0 = Date.now();
  const evidenceItems = ctx?.evidence?.items || [];
  const prose = ctx?.prose || "";

  const extractor = deps.extractor || buildQualifierExtractor();
  const validate = deps.validate || validateQualifierPreservation;
  const rewrite = deps.rewrite || rewriteForQualifierPreservation;
  const rewrite2Enabled = deps.rewrite2Enabled !== undefined ? deps.rewrite2Enabled : mode2Rewrite2Enabled();

  const telemetry = {
    rewrites_attempted: 0,
    initial_failures: 0,
    after_r1_failures: null,
    final_failures: 0,
    extraction_cost_usd: 0,
    validation_cost_usd: 0,
    rewrite_cost_usd: 0,
    extraction_latency_ms: 0,
    validation_latency_ms: 0,
    rewrite_latency_ms: 0,
    total_latency_ms: 0,
    qualifiers_dropped_breakdown: {},
    validation_json: null,
    errors: {},
  };

  if (!prose || evidenceItems.length === 0) {
    telemetry.total_latency_ms = Date.now() - t0;
    return { rewritten_prose: null, telemetry };
  }

  // Phase 1: extract qualifiers per cited source (parallel)
  const extractStart = Date.now();
  const sourceWithIdx = evidenceItems.map((it, i) => ({
    ...it,
    source_id: i + 1,
    id: i + 1,
  }));
  const extractionResults = await Promise.all(
    sourceWithIdx.map((s) => extractor.extract(s))
  );
  telemetry.extraction_latency_ms = Date.now() - extractStart;
  for (const e of extractionResults) {
    telemetry.extraction_cost_usd += e.cost_usd || 0;
  }
  const citedSources = sourceWithIdx.map((s, i) => ({
    id: s.id,
    qualifiers: extractionResults[i]?.qualifiers || {},
  }));

  // Phase 2: initial validation
  const v0Start = Date.now();
  const v0 = await validate({ prose, citedSources });
  telemetry.validation_latency_ms += Date.now() - v0Start;
  telemetry.validation_cost_usd += v0.cost_usd || 0;
  telemetry.initial_failures = v0.total_missing || 0;
  telemetry.qualifiers_dropped_breakdown = v0.qualifiers_dropped_breakdown || {};
  telemetry.validation_json = v0;
  if (v0.error) telemetry.errors.validation = v0.error;

  if (v0.error || telemetry.initial_failures === 0) {
    telemetry.final_failures = telemetry.initial_failures;
    telemetry.total_latency_ms = Date.now() - t0;
    return { rewritten_prose: null, telemetry };
  }

  // Phase 3: rewrite #1 (preserve)
  const r1Start = Date.now();
  const r1 = await rewrite({
    originalProse: prose,
    validationResult: v0,
    citedSources,
    mode: "preserve",
  });
  telemetry.rewrite_latency_ms += Date.now() - r1Start;
  telemetry.rewrite_cost_usd += r1.cost_usd || 0;
  telemetry.rewrites_attempted = 1;
  if (r1.error) telemetry.errors.rewrite_1 = r1.error;

  if (r1.error || !r1.length_ratio_acceptable) {
    // Rewrite failed; ship original
    telemetry.after_r1_failures = telemetry.initial_failures;
    telemetry.final_failures = telemetry.initial_failures;
    telemetry.total_latency_ms = Date.now() - t0;
    return { rewritten_prose: null, telemetry };
  }

  // Re-validate after rewrite #1
  const v1Start = Date.now();
  const v1 = await validate({ prose: r1.prose, citedSources });
  telemetry.validation_latency_ms += Date.now() - v1Start;
  telemetry.validation_cost_usd += v1.cost_usd || 0;
  telemetry.after_r1_failures = v1.total_missing || 0;

  if (v1.total_missing === 0 || !rewrite2Enabled) {
    telemetry.final_failures = telemetry.after_r1_failures;
    telemetry.total_latency_ms = Date.now() - t0;
    return { rewritten_prose: r1.prose, telemetry };
  }

  // Phase 4: rewrite #2 (preserve_or_hedge)
  const r2Start = Date.now();
  const r2 = await rewrite({
    originalProse: r1.prose,
    validationResult: v1,
    citedSources,
    mode: "preserve_or_hedge",
  });
  telemetry.rewrite_latency_ms += Date.now() - r2Start;
  telemetry.rewrite_cost_usd += r2.cost_usd || 0;
  telemetry.rewrites_attempted = 2;
  if (r2.error) telemetry.errors.rewrite_2 = r2.error;

  if (r2.error || !r2.length_ratio_acceptable) {
    // Rewrite #2 failed; ship rewrite #1's output
    telemetry.final_failures = telemetry.after_r1_failures;
    telemetry.total_latency_ms = Date.now() - t0;
    return { rewritten_prose: r1.prose, telemetry };
  }

  // Re-validate after rewrite #2 (informational only)
  const v2Start = Date.now();
  const v2 = await validate({ prose: r2.prose, citedSources });
  telemetry.validation_latency_ms += Date.now() - v2Start;
  telemetry.validation_cost_usd += v2.cost_usd || 0;
  telemetry.final_failures = v2.total_missing || 0;
  telemetry.total_latency_ms = Date.now() - t0;
  return { rewritten_prose: r2.prose, telemetry };
}
