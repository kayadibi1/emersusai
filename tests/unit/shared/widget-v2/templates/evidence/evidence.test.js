import assert from "node:assert/strict";
import { test } from "node:test";
import { StudyMatrix } from "../../../../../../shared/widget-v2/templates/evidence/study-matrix.js";
import { EffectSizeForest } from "../../../../../../shared/widget-v2/templates/evidence/effect-size-forest.js";
import { validateEvidenceWidget } from "../../../../../../shared/widget-v2/validators/evidence.js";

const SM_PAYLOAD = {
  title: "Creatine for strength",
  display_width: "wide",
  summary: null,
  follow_up_chips: [],
  type: "study_matrix",
  data: {
    question: "Does creatine improve 1RM strength?",
    studies: [
      { citation: "Branch 2003 (meta)", n: 500, design: "meta", effect_size: 0.43, direction: "positive" },
      { citation: "Chilibeck 2017 (RCT)", n: 240, design: "RCT", effect_size: 0.35, direction: "positive" },
      { citation: "Rawson 2011 (RCT)", n: 70, design: "RCT", effect_size: 0.04, direction: "null" },
    ],
  },
};

test("validator accepts study_matrix", () => {
  const r = validateEvidenceWidget(SM_PAYLOAD);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects bad design enum", () => {
  const bad = { ...SM_PAYLOAD, data: { ...SM_PAYLOAD.data, studies: [{ citation: "X", design: "opinion", direction: "positive" }] } };
  const r = validateEvidenceWidget(bad);
  assert.equal(r.valid, false);
});

test("validator rejects bad direction", () => {
  const bad = { ...SM_PAYLOAD, data: { ...SM_PAYLOAD.data, studies: [{ citation: "X", design: "RCT", direction: "maybe" }] } };
  const r = validateEvidenceWidget(bad);
  assert.equal(r.valid, false);
});

test("study_matrix renders citations + question", () => {
  const el = StudyMatrix(SM_PAYLOAD);
  const s = JSON.stringify(el);
  assert.match(s, /1RM strength/);
  assert.match(s, /Branch 2003/);
  assert.match(s, /Chilibeck 2017/);
});

const ESF_PAYLOAD = {
  title: "Creatine effect sizes",
  display_width: "wide",
  summary: null,
  follow_up_chips: [],
  type: "effect_size_forest",
  data: {
    outcome: "Bench press 1RM (kg)",
    rows: [
      { label: "Branch 2003", effect: 0.43, ci_low: 0.28, ci_high: 0.58 },
      { label: "Chilibeck 2017", effect: 0.35, ci_low: 0.15, ci_high: 0.55 },
      { label: "Rawson 2011", effect: 0.04, ci_low: -0.2, ci_high: 0.28 },
    ],
  },
};

test("validator accepts effect_size_forest", () => {
  const r = validateEvidenceWidget(ESF_PAYLOAD);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects inverted CI", () => {
  const bad = { ...ESF_PAYLOAD, data: { ...ESF_PAYLOAD.data, rows: [{ label: "X", effect: 0.2, ci_low: 0.5, ci_high: 0.1 }] } };
  const r = validateEvidenceWidget(bad);
  assert.equal(r.valid, false);
});

test("effect_size_forest renders labels + outcome", () => {
  const el = EffectSizeForest(ESF_PAYLOAD);
  const s = JSON.stringify(el);
  assert.match(s, /Bench press 1RM/);
  assert.match(s, /Branch 2003/);
  assert.match(s, /Rawson 2011/);
});
