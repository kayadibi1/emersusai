import assert from "node:assert/strict";
import { test } from "node:test";
import { DoseResponseCurve } from "../../../../../../shared/widget-v2/templates/pharma/dose-response-curve.js";
import { HalfLifeDecay } from "../../../../../../shared/widget-v2/templates/pharma/half-life-decay.js";
import { validatePharmaWidget } from "../../../../../../shared/widget-v2/validators/pharma.js";

const DRC_PAYLOAD = {
  title: "Creatine dose-response",
  display_width: "wide",
  summary: null,
  follow_up_chips: [],
  type: "dose_response_curve",
  data: {
    compound: "Creatine monohydrate",
    unit: "g",
    points: [
      { dose: 1, effect_pct: 2, study_n: 30 },
      { dose: 3, effect_pct: 7, study_n: 120 },
      { dose: 5, effect_pct: 9, study_n: 220 },
      { dose: 10, effect_pct: 9.2, study_n: 45 },
      { dose: 20, effect_pct: 9.1, study_n: 18 },
    ],
    recommended_range: { min: 3, max: 5 },
  },
};

test("validator accepts dose_response_curve", () => {
  const r = validatePharmaWidget(DRC_PAYLOAD);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects single-point curve", () => {
  const bad = { ...DRC_PAYLOAD, data: { ...DRC_PAYLOAD.data, points: [{ dose: 5, effect_pct: 10 }] } };
  const r = validatePharmaWidget(bad);
  assert.equal(r.valid, false);
});

test("validator rejects inverted range", () => {
  const bad = { ...DRC_PAYLOAD, data: { ...DRC_PAYLOAD.data, recommended_range: { min: 10, max: 3 } } };
  const r = validatePharmaWidget(bad);
  assert.equal(r.valid, false);
});

test("dose_response component renders compound + range label", () => {
  const el = DoseResponseCurve(DRC_PAYLOAD);
  const s = JSON.stringify(el);
  assert.match(s, /Creatine monohydrate/);
  assert.match(s, /range 3-5/);
});

const HLD_PAYLOAD = {
  title: "Caffeine half-life",
  display_width: "wide",
  summary: null,
  follow_up_chips: [],
  type: "half_life_decay",
  data: {
    compound: "Caffeine",
    half_life_hours: 5,
    initial_dose: 200,
    dose_unit: "mg",
    horizon_hours: 30,
  },
};

test("validator accepts half_life_decay", () => {
  const r = validatePharmaWidget(HLD_PAYLOAD);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects zero half_life", () => {
  const bad = { ...HLD_PAYLOAD, data: { ...HLD_PAYLOAD.data, half_life_hours: 0 } };
  const r = validatePharmaWidget(bad);
  assert.equal(r.valid, false);
});

test("half_life_decay renders compound + half-life tick labels", () => {
  const el = HalfLifeDecay(HLD_PAYLOAD);
  const s = JSON.stringify(el);
  assert.match(s, /Caffeine/);
  assert.match(s, /1×t½/);
  assert.match(s, /200 mg/);
});
