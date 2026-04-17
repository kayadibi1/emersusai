import assert from "node:assert/strict";
import { test } from "node:test";
import { ForestPlot } from "../../../../../../shared/widget-v2/templates/evidence/forest-plot.js";
import { EvidenceStrengthCard } from "../../../../../../shared/widget-v2/templates/evidence/evidence-strength-card.js";
import { ButterflyComparison } from "../../../../../../shared/widget-v2/templates/evidence/butterfly-comparison.js";
import { StudyQualityMatrix } from "../../../../../../shared/widget-v2/templates/evidence/study-quality-matrix.js";
import { MetaRegressionLine } from "../../../../../../shared/widget-v2/templates/evidence/meta-regression-line.js";
import { CiLadder } from "../../../../../../shared/widget-v2/templates/evidence/ci-ladder.js";
import { CitationTimeline } from "../../../../../../shared/widget-v2/templates/evidence/citation-timeline.js";
import { StudyBeeswarm } from "../../../../../../shared/widget-v2/templates/evidence/study-beeswarm.js";
import { validateEvidenceWidget } from "../../../../../../shared/widget-v2/validators/evidence.js";

const b = { title: "t", display_width: "wide", summary: null, follow_up_chips: [] };

test("forest_plot", () => {
  const p = { ...b, type: "forest_plot", data: { outcome_label: "Bench 1RM", x_axis: { min: -0.5, max: 1.2, label: "SMD" }, fp_studies: [
    { label: "Branch 2003", n: 500, effect: 0.43, ci_low: 0.28, ci_high: 0.58, is_outlier: false },
    { label: "Chilibeck 2017", n: 240, effect: 0.35, ci_low: 0.15, ci_high: 0.55, is_outlier: false },
  ], pooled: { k: 2, effect: 0.39, ci_low: 0.3, ci_high: 0.5 } } };
  assert.equal(validateEvidenceWidget(p).valid, true);
  assert.match(JSON.stringify(ForestPlot(p)), /Branch/);
});
test("evidence_strength_card", () => {
  const p = { ...b, type: "evidence_strength_card", data: { claim: "Creatine improves 1RM by ~7%", level: "strong", factors: [
    { name: "Risk of bias", rating: "low", note: null },
    { name: "Consistency", rating: "high", note: "Across 30+ RCTs" },
    { name: "Directness", rating: "high", note: null },
  ] } };
  assert.equal(validateEvidenceWidget(p).valid, true);
  assert.match(JSON.stringify(EvidenceStrengthCard(p)), /STRONG/);
});
test("butterfly_comparison", () => {
  const p = { ...b, type: "butterfly_comparison", data: { subject: "Creatine", pros: [{ label: "Strength", magnitude: 7 }, { label: "Power", magnitude: 5 }], cons: [{ label: "Water weight", magnitude: 2 }] } };
  assert.equal(validateEvidenceWidget(p).valid, true);
  assert.match(JSON.stringify(ButterflyComparison(p)), /Creatine/);
});
test("study_quality_matrix", () => {
  const p = { ...b, type: "study_quality_matrix", data: { quality_studies: [
    { label: "Branch 2003", n: 500, duration_weeks: 8, design: "meta" },
    { label: "Chilibeck 2017", n: 240, duration_weeks: 12, design: "RCT" },
    { label: "Rawson 2011", n: 70, duration_weeks: 6, design: "RCT" },
  ] } };
  assert.equal(validateEvidenceWidget(p).valid, true);
  assert.match(JSON.stringify(StudyQualityMatrix(p)), /Branch/);
});
test("meta_regression_line", () => {
  const p = { ...b, type: "meta_regression_line", data: { x_label: "Dose (g)", y_label: "SMD", regression_points: [
    { label: "S1", x: 3, y: 0.35 }, { label: "S2", x: 5, y: 0.45 }, { label: "S3", x: 10, y: 0.42 }, { label: "S4", x: 20, y: 0.40 },
  ], regression: { slope: 0.01, intercept: 0.34, r_squared: 0.52 } } };
  assert.equal(validateEvidenceWidget(p).valid, true);
  assert.match(JSON.stringify(MetaRegressionLine(p)), /Dose/);
});
test("ci_ladder", () => {
  const p = { ...b, type: "ci_ladder", data: { outcome: "Bench 1RM", ladder_protocols: [
    { label: "5g creatine + whey", effect: 0.55, ci_low: 0.4, ci_high: 0.7 },
    { label: "5g creatine alone", effect: 0.38, ci_low: 0.2, ci_high: 0.55 },
    { label: "HMB", effect: 0.18, ci_low: 0.02, ci_high: 0.33 },
  ] } };
  assert.equal(validateEvidenceWidget(p).valid, true);
  assert.match(JSON.stringify(CiLadder(p)), /creatine/);
});
test("citation_timeline", () => {
  const p = { ...b, type: "citation_timeline", data: { timeline_studies: [
    { year: 1992, label: "Harris 1992", citations: 1800 },
    { year: 2003, label: "Branch meta", citations: 950 },
    { year: 2017, label: "Chilibeck", citations: 320 },
    { year: 2021, label: "Kreider update", citations: 180 },
  ] } };
  assert.equal(validateEvidenceWidget(p).valid, true);
  assert.match(JSON.stringify(CitationTimeline(p)), /Harris/);
});
test("study_beeswarm", () => {
  const p = { ...b, type: "study_beeswarm", data: { outcome: "SMD on 1RM", beeswarm_dots: [
    { label: "S1", effect: 0.45 }, { label: "S2", effect: 0.33 }, { label: "S3", effect: -0.05 }, { label: "S4", effect: 0.28 }, { label: "S5", effect: 0.51 },
  ] } };
  assert.equal(validateEvidenceWidget(p).valid, true);
  assert.match(JSON.stringify(StudyBeeswarm(p)), /SMD/);
});
