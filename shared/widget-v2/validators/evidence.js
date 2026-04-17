import { validateBase } from "./index.js";

const EVIDENCE_TYPES = new Set(["study_matrix", "effect_size_forest"]);
const DESIGN_ENUM = ["RCT", "meta", "cohort", "review", "other"];
const DIRECTION_ENUM = ["positive", "null", "negative"];

function validateStudyMatrix(data) {
  const errors = [];
  if (typeof data.question !== "string" || !data.question.trim()) errors.push("data.question");
  if (!Array.isArray(data.studies) || data.studies.length < 1) errors.push("data.studies must be non-empty");
  else {
    data.studies.forEach((s, i) => {
      if (typeof s.citation !== "string" || !s.citation.trim()) errors.push(`studies[${i}].citation`);
      if (!DESIGN_ENUM.includes(s.design)) errors.push(`studies[${i}].design`);
      if (!DIRECTION_ENUM.includes(s.direction)) errors.push(`studies[${i}].direction`);
      if (s.n !== null && s.n !== undefined && !Number.isInteger(s.n)) errors.push(`studies[${i}].n`);
    });
  }
  return errors;
}

function validateEffectForest(data) {
  const errors = [];
  if (typeof data.outcome !== "string" || !data.outcome.trim()) errors.push("data.outcome");
  if (!Array.isArray(data.rows) || data.rows.length < 1) errors.push("data.rows must be non-empty");
  else {
    data.rows.forEach((r, i) => {
      if (typeof r.label !== "string" || !r.label.trim()) errors.push(`rows[${i}].label`);
      if (typeof r.effect !== "number") errors.push(`rows[${i}].effect`);
      if (typeof r.ci_low !== "number" || typeof r.ci_high !== "number") errors.push(`rows[${i}].ci_low/ci_high`);
      if (r.ci_high < r.ci_low) errors.push(`rows[${i}] CI inverted`);
    });
  }
  return errors;
}

export function validateEvidenceWidget(payload) {
  const base = validateBase(payload);
  if (!base.valid) return base;
  if (!EVIDENCE_TYPES.has(payload.type)) {
    return { valid: false, errors: [`unknown evidence type: ${payload.type}`] };
  }
  const typeErrors =
    payload.type === "study_matrix" ? validateStudyMatrix(payload.data) :
    payload.type === "effect_size_forest" ? validateEffectForest(payload.data) :
    [];
  return { valid: typeErrors.length === 0, errors: typeErrors };
}
