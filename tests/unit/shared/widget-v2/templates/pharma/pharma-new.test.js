import assert from "node:assert/strict";
import { test } from "node:test";
import { SupplementStackSchedule } from "../../../../../../shared/widget-v2/templates/pharma/supplement-stack-schedule.js";
import { LoadingVsMaintenance } from "../../../../../../shared/widget-v2/templates/pharma/loading-vs-maintenance.js";
import { AbsorptionMultiProtein } from "../../../../../../shared/widget-v2/templates/pharma/absorption-multi-protein.js";
import { EffectDurationStrip } from "../../../../../../shared/widget-v2/templates/pharma/effect-duration-strip.js";
import { DoseThresholdBand } from "../../../../../../shared/widget-v2/templates/pharma/dose-threshold-band.js";
import { validatePharmaWidget } from "../../../../../../shared/widget-v2/validators/pharma.js";

const base = { title: "t", display_width: "wide", summary: null, follow_up_chips: [] };

test("supplement_stack_schedule v+r", () => {
  const p = { ...base, type: "supplement_stack_schedule", data: { supplements: [{ name: "Creatine", doses: [{ hour: 8, amount: 5, unit: "g" }] }], day_label: "Training day" } };
  const r = validatePharmaWidget(p);
  assert.equal(r.valid, true, r.errors?.join("; "));
  assert.match(JSON.stringify(SupplementStackSchedule(p)), /Creatine/);
});

test("loading_vs_maintenance v+r", () => {
  const p = { ...base, type: "loading_vs_maintenance", data: { protocols: [{ label: "Loading", points: [{ x: 0, y: 0 }, { x: 7, y: 95 }] }, { label: "Maintenance", points: [{ x: 0, y: 0 }, { x: 28, y: 95 }] }], saturation_y: 95, x_label: "days", y_label: "% saturated" } };
  const r = validatePharmaWidget(p);
  assert.equal(r.valid, true, r.errors?.join("; "));
  assert.match(JSON.stringify(LoadingVsMaintenance(p)), /Loading/);
});

test("absorption_multi_protein v+r", () => {
  const p = { ...base, type: "absorption_multi_protein", data: { curves: [{ label: "Whey", peak_hour: 1, points: [{ hour: 0, amount: 0 }, { hour: 1, amount: 30 }, { hour: 3, amount: 5 }] }, { label: "Casein", peak_hour: 3, points: [{ hour: 0, amount: 0 }, { hour: 3, amount: 18 }, { hour: 6, amount: 8 }] }], total_hours: 6 } };
  const r = validatePharmaWidget(p);
  assert.equal(r.valid, true, r.errors?.join("; "));
  assert.match(JSON.stringify(AbsorptionMultiProtein(p)), /Whey/);
});

test("effect_duration_strip v+r", () => {
  const p = { ...base, type: "effect_duration_strip", data: { compounds: [{ name: "Caffeine", onset_hour: 0.25, peak_start_hour: 0.75, peak_end_hour: 2, wearoff_hour: 6 }], total_hours: 8 } };
  const r = validatePharmaWidget(p);
  assert.equal(r.valid, true, r.errors?.join("; "));
  assert.match(JSON.stringify(EffectDurationStrip(p)), /Caffeine/);
});

test("effect_duration_strip rejects peak inversion", () => {
  const p = { ...base, type: "effect_duration_strip", data: { compounds: [{ name: "X", onset_hour: 0, peak_start_hour: 4, peak_end_hour: 2, wearoff_hour: 6 }], total_hours: 8 } };
  assert.equal(validatePharmaWidget(p).valid, false);
});

test("dose_threshold_band v+r", () => {
  const p = { ...base, type: "dose_threshold_band", data: { compound: "Ashwagandha", dose_unit: "mg", current_dose: 300, zones: { sub_max: 200, therapeutic_min: 300, therapeutic_max: 600, over_min: 900 }, axis_max: 1200 } };
  const r = validatePharmaWidget(p);
  assert.equal(r.valid, true, r.errors?.join("; "));
  assert.match(JSON.stringify(DoseThresholdBand(p)), /Ashwagandha/);
});
