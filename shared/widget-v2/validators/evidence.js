import { validateBase } from "./index.js";

const EVIDENCE_TYPES = new Set([
  "study_matrix", "effect_size_forest",
  "forest_plot", "evidence_strength_card", "butterfly_comparison",
  "study_quality_matrix", "meta_regression_line", "ci_ladder",
  "citation_timeline", "study_beeswarm",
]);
const DESIGN_ENUM = ["RCT", "meta", "cohort", "review", "other"];
const DIRECTION_ENUM = ["positive", "null", "negative"];

const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

function vStudyMatrix(d) {
  const e = [];
  if (!isStr(d.question)) e.push("question");
  if (!Array.isArray(d.studies) || d.studies.length < 1) e.push("studies");
  else d.studies.forEach((s, i) => {
    if (!isStr(s.citation)) e.push(`studies[${i}].citation`);
    if (!DESIGN_ENUM.includes(s.design)) e.push(`studies[${i}].design`);
    if (!DIRECTION_ENUM.includes(s.direction)) e.push(`studies[${i}].direction`);
  });
  return e;
}
function vEffectForest(d) {
  const e = [];
  if (!isStr(d.outcome)) e.push("outcome");
  if (!Array.isArray(d.rows) || d.rows.length < 1) e.push("rows");
  else d.rows.forEach((r, i) => {
    if (!isStr(r.label)) e.push(`rows[${i}].label`);
    if (!isNum(r.effect)) e.push(`rows[${i}].effect`);
    if (!isNum(r.ci_low) || !isNum(r.ci_high) || r.ci_high < r.ci_low) e.push(`rows[${i}].ci`);
  });
  return e;
}
function vForestPlot(d) {
  const e = [];
  if (!isStr(d.outcome_label)) e.push("outcome_label");
  if (!d.x_axis || !isNum(d.x_axis.min) || !isNum(d.x_axis.max)) e.push("x_axis");
  if (!Array.isArray(d.fp_studies) || d.fp_studies.length < 2) e.push("fp_studies");
  else d.fp_studies.forEach((s, i) => {
    if (!isStr(s.label)) e.push(`fp_studies[${i}].label`);
    if (!isNum(s.n) || s.n < 1) e.push(`fp_studies[${i}].n`);
    if (!isNum(s.effect) || !isNum(s.ci_low) || !isNum(s.ci_high)) e.push(`fp_studies[${i}].ci`);
  });
  if (!d.pooled || !isNum(d.pooled.effect) || !isInt(d.pooled.k)) e.push("pooled");
  return e;
}
function vStrengthCard(d) {
  const e = [];
  if (!isStr(d.claim)) e.push("claim");
  if (!["strong", "moderate", "limited", "insufficient"].includes(d.level)) e.push("level");
  if (!Array.isArray(d.factors) || d.factors.length < 1) e.push("factors");
  else d.factors.forEach((f, i) => {
    if (!isStr(f.name)) e.push(`factors[${i}].name`);
    if (!["high", "moderate", "low"].includes(f.rating)) e.push(`factors[${i}].rating`);
  });
  return e;
}
function vButterfly(d) {
  const e = [];
  if (!isStr(d.subject)) e.push("subject");
  if (!Array.isArray(d.pros) || d.pros.length < 1) e.push("pros");
  if (!Array.isArray(d.cons) || d.cons.length < 1) e.push("cons");
  for (const arr of [d.pros || [], d.cons || []]) {
    arr.forEach((item, i) => {
      if (!isStr(item.label)) e.push(`label[${i}]`);
      if (!isNum(item.magnitude) || item.magnitude < 0) e.push(`magnitude[${i}]`);
    });
  }
  return e;
}
function vQualityMatrix(d) {
  const e = [];
  if (!Array.isArray(d.quality_studies) || d.quality_studies.length < 2) e.push("quality_studies");
  else d.quality_studies.forEach((s, i) => {
    if (!isStr(s.label)) e.push(`quality_studies[${i}].label`);
    if (!isInt(s.n) || s.n < 1) e.push(`quality_studies[${i}].n`);
    if (!isNum(s.duration_weeks) || s.duration_weeks < 0) e.push(`quality_studies[${i}].duration_weeks`);
    if (!DESIGN_ENUM.includes(s.design)) e.push(`quality_studies[${i}].design`);
  });
  return e;
}
function vMetaRegression(d) {
  const e = [];
  if (!isStr(d.x_label)) e.push("x_label");
  if (!isStr(d.y_label)) e.push("y_label");
  if (!Array.isArray(d.regression_points) || d.regression_points.length < 3) e.push("regression_points (≥3)");
  else d.regression_points.forEach((p, i) => {
    if (!isStr(p.label)) e.push(`regression_points[${i}].label`);
    if (!isNum(p.x) || !isNum(p.y)) e.push(`regression_points[${i}]`);
  });
  if (!d.regression || !isNum(d.regression.slope) || !isNum(d.regression.intercept) || !isNum(d.regression.r_squared)) e.push("regression");
  return e;
}
function vCILadder(d) {
  const e = [];
  if (!isStr(d.outcome)) e.push("outcome");
  if (!Array.isArray(d.ladder_protocols) || d.ladder_protocols.length < 2) e.push("ladder_protocols");
  else d.ladder_protocols.forEach((p, i) => {
    if (!isStr(p.label)) e.push(`ladder_protocols[${i}].label`);
    if (!isNum(p.effect) || !isNum(p.ci_low) || !isNum(p.ci_high)) e.push(`ladder_protocols[${i}].ci`);
  });
  return e;
}
function vCitationTimeline(d) {
  const e = [];
  if (!Array.isArray(d.timeline_studies) || d.timeline_studies.length < 1) e.push("timeline_studies");
  else d.timeline_studies.forEach((s, i) => {
    if (!isInt(s.year) || s.year < 1950) e.push(`timeline_studies[${i}].year`);
    if (!isStr(s.label)) e.push(`timeline_studies[${i}].label`);
    if (!isInt(s.citations) || s.citations < 0) e.push(`timeline_studies[${i}].citations`);
  });
  return e;
}
function vBeeswarm(d) {
  const e = [];
  if (!isStr(d.outcome)) e.push("outcome");
  if (!Array.isArray(d.beeswarm_dots) || d.beeswarm_dots.length < 3) e.push("beeswarm_dots (≥3)");
  else d.beeswarm_dots.forEach((s, i) => {
    if (!isStr(s.label)) e.push(`beeswarm_dots[${i}].label`);
    if (!isNum(s.effect)) e.push(`beeswarm_dots[${i}].effect`);
  });
  return e;
}

export function validateEvidenceWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!EVIDENCE_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown evidence type: ${payload.type}`] };
  }
  const map = {
    study_matrix: vStudyMatrix,
    effect_size_forest: vEffectForest,
    forest_plot: vForestPlot,
    evidence_strength_card: vStrengthCard,
    butterfly_comparison: vButterfly,
    study_quality_matrix: vQualityMatrix,
    meta_regression_line: vMetaRegression,
    ci_ladder: vCILadder,
    citation_timeline: vCitationTimeline,
    study_beeswarm: vBeeswarm,
  };
  const errors = map[payload.type](payload.data);
  return { valid: errors.length === 0, errors };
}
