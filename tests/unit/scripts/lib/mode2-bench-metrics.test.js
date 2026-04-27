import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregate,
  renderMarkdown,
  buildRecommendations,
} from "../../../../scripts/lib/mode2-bench-metrics.js";

const SAMPLE_ROWS = [
  // Chat 1: 0 rewrites (no missing)
  { mode2_rewrites_attempted: 0, mode2_initial_failures: 0, mode2_after_r1_failures: null, mode2_final_failures: 0,
    mode2_extraction_cost_usd: 0.001, mode2_validation_cost_usd: 0.0005, mode2_rewrite_cost_usd: 0,
    mode2_total_latency_ms: 2500, mode2_qualifiers_dropped_breakdown: {} },
  // Chat 2: 1 rewrite (r1 fixed everything)
  { mode2_rewrites_attempted: 1, mode2_initial_failures: 3, mode2_after_r1_failures: 0, mode2_final_failures: 0,
    mode2_extraction_cost_usd: 0.001, mode2_validation_cost_usd: 0.001, mode2_rewrite_cost_usd: 0.005,
    mode2_total_latency_ms: 6000, mode2_qualifiers_dropped_breakdown: { population: 2, dose: 1 } },
  // Chat 3: 2 rewrites (r1 didn't fix; r2 hedged)
  { mode2_rewrites_attempted: 2, mode2_initial_failures: 4, mode2_after_r1_failures: 2, mode2_final_failures: 0,
    mode2_extraction_cost_usd: 0.001, mode2_validation_cost_usd: 0.0015, mode2_rewrite_cost_usd: 0.010,
    mode2_total_latency_ms: 12000, mode2_qualifiers_dropped_breakdown: { population: 3, study_design: 1 } },
];

test("aggregate: counts rewrites distribution", () => {
  const m = aggregate(SAMPLE_ROWS);
  assert.equal(m.headline.total_chats, 3);
  assert.equal(m.headline.rewrites_0_count, 1);
  assert.equal(m.headline.rewrites_1_count, 1);
  assert.equal(m.headline.rewrites_2_count, 1);
});

test("aggregate: cost averages", () => {
  const m = aggregate(SAMPLE_ROWS);
  assert.ok(m.cost.avg_total_usd > 0);
  assert.ok(m.cost.avg_extraction_usd > 0);
  assert.ok(m.cost.avg_rewrite_usd > 0);
});

test("aggregate: effectiveness — initial vs final mode_2 rate", () => {
  const m = aggregate(SAMPLE_ROWS);
  // total claims-with-missing initially: 0+3+4 = 7
  // total claims-with-missing finally: 0+0+0 = 0
  assert.equal(m.effectiveness.total_initial_failures, 7);
  assert.equal(m.effectiveness.total_final_failures, 0);
});

test("aggregate: qualifiers_dropped breakdown summed", () => {
  const m = aggregate(SAMPLE_ROWS);
  assert.equal(m.qualifiers_dropped_total.population, 5); // 0 + 2 + 3
  assert.equal(m.qualifiers_dropped_total.dose, 1);
  assert.equal(m.qualifiers_dropped_total.study_design, 1);
});

test("buildRecommendations: flags drop-rewrite-2 when rare and ineffective", () => {
  const lowR2 = [
    ...Array.from({ length: 100 }, () => ({
      mode2_rewrites_attempted: 1,
      mode2_initial_failures: 1,
      mode2_after_r1_failures: 0,
      mode2_final_failures: 0,
      mode2_extraction_cost_usd: 0.001,
      mode2_validation_cost_usd: 0.001,
      mode2_rewrite_cost_usd: 0.005,
      mode2_total_latency_ms: 6000,
      mode2_qualifiers_dropped_breakdown: {},
    })),
    // 1 chat with rewrite_2 that didn't help
    { mode2_rewrites_attempted: 2, mode2_initial_failures: 1, mode2_after_r1_failures: 1, mode2_final_failures: 1,
      mode2_extraction_cost_usd: 0.001, mode2_validation_cost_usd: 0.0015, mode2_rewrite_cost_usd: 0.010,
      mode2_total_latency_ms: 12000, mode2_qualifiers_dropped_breakdown: {} },
  ];
  const m = aggregate(lowR2);
  const recs = buildRecommendations(m);
  assert.ok(recs.some((r) => /drop rewrite #?2/i.test(r)), "should recommend dropping rewrite #2");
});

test("buildRecommendations: flags latency regression", () => {
  const slow = Array.from({ length: 100 }, (_, i) => ({
    mode2_rewrites_attempted: 1,
    mode2_initial_failures: 1,
    mode2_after_r1_failures: 0,
    mode2_final_failures: 0,
    mode2_extraction_cost_usd: 0.001,
    mode2_validation_cost_usd: 0.001,
    mode2_rewrite_cost_usd: 0.005,
    // 6 chats > 10000 ms (over the 5% threshold)
    mode2_total_latency_ms: i < 6 ? 12000 : 5000,
    mode2_qualifiers_dropped_breakdown: {},
  }));
  const m = aggregate(slow);
  const recs = buildRecommendations(m);
  assert.ok(recs.some((r) => /latency/i.test(r)), "should recommend latency review");
});

test("renderMarkdown: emits all sections", () => {
  const m = aggregate(SAMPLE_ROWS);
  const md = renderMarkdown(m, { runId: "test", recommendations: ["x"] });
  assert.match(md, /## Headline/);
  assert.match(md, /## Cost/);
  assert.match(md, /## Effectiveness/);
  assert.match(md, /## Activation distribution/);
  assert.match(md, /## Qualifier-drop breakdown/);
  assert.match(md, /## Recommendations/);
});
