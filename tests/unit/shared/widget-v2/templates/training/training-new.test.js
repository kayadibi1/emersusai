import assert from "node:assert/strict";
import { test } from "node:test";
import { MevMrvRange } from "../../../../../../shared/widget-v2/templates/training/mev-mrv-range.js";
import { RpeHistogram } from "../../../../../../shared/widget-v2/templates/training/rpe-histogram.js";
import { RepSchemeGrid } from "../../../../../../shared/widget-v2/templates/training/rep-scheme-grid.js";
import { TrainingStressBalance } from "../../../../../../shared/widget-v2/templates/training/training-stress-balance.js";
import { FatigueReadinessComposite } from "../../../../../../shared/widget-v2/templates/training/fatigue-readiness-composite.js";
import { WeeklyPlanCalendar } from "../../../../../../shared/widget-v2/templates/training/weekly-plan-calendar.js";
import { DeloadProtocol } from "../../../../../../shared/widget-v2/templates/training/deload-protocol.js";
import { validateTrainingWidget } from "../../../../../../shared/widget-v2/validators/training.js";

const b = { title: "t", display_width: "wide", summary: null, follow_up_chips: [] };

test("mev_mrv_range", () => {
  const p = { ...b, type: "mev_mrv_range", data: { metric_label: "Sets per week", muscles: [{ name: "Chest", mev: 8, mav: 14, mrv: 22, current: 14 }, { name: "Back", mev: 10, mav: 18, mrv: 25, current: 12 }] } };
  const r = validateTrainingWidget(p);
  assert.equal(r.valid, true, r.errors?.join("; "));
  assert.match(JSON.stringify(MevMrvRange(p)), /Chest/);
});
test("rpe_histogram", () => {
  const p = { ...b, type: "rpe_histogram", data: { buckets: [{ rpe: 6, count: 2 }, { rpe: 7, count: 5 }, { rpe: 8, count: 10 }, { rpe: 9, count: 3 }], target_rpe: 8 } };
  assert.equal(validateTrainingWidget(p).valid, true);
  assert.match(JSON.stringify(RpeHistogram(p)), /8/);
});
test("rep_scheme_grid", () => {
  const p = { ...b, type: "rep_scheme_grid", data: { schemes: [{ label: "Heavy singles", reps_low: 1, reps_high: 3, pct_low: 90, pct_high: 100, focus: "STR" }, { label: "Hypertrophy sweet spot", reps_low: 8, reps_high: 12, pct_low: 65, pct_high: 75, focus: "HYP" }] } };
  assert.equal(validateTrainingWidget(p).valid, true);
  assert.match(JSON.stringify(RepSchemeGrid(p)), /Hypertrophy/);
});
test("training_stress_balance", () => {
  const p = { ...b, type: "training_stress_balance", data: { series: [{ date: "2026-04-01", ctl: 40, atl: 60, tsb: -20 }, { date: "2026-04-02", ctl: 42, atl: 55, tsb: -13 }, { date: "2026-04-03", ctl: 44, atl: 50, tsb: -6 }, { date: "2026-04-04", ctl: 45, atl: 48, tsb: -3 }, { date: "2026-04-05", ctl: 46, atl: 42, tsb: 4 }] } };
  assert.equal(validateTrainingWidget(p).valid, true);
  assert.match(JSON.stringify(TrainingStressBalance(p)), /2026-04-05/);
});
test("fatigue_readiness_composite", () => {
  const p = { ...b, type: "fatigue_readiness_composite", data: { readiness_score: 78, signals: [{ name: "Sleep", score: 85 }, { name: "HRV", score: 70 }, { name: "Soreness", score: 60 }] } };
  assert.equal(validateTrainingWidget(p).valid, true);
  assert.match(JSON.stringify(FatigueReadinessComposite(p)), /78/);
});
test("weekly_plan_calendar", () => {
  const p = { ...b, type: "weekly_plan_calendar", data: { days: [
    { label: "Mon", session: "Upper", intensity: 0.8 },
    { label: "Tue", session: "Lower", intensity: 0.7 },
    { label: "Wed", session: null, intensity: 0 },
    { label: "Thu", session: "Upper", intensity: 0.9 },
    { label: "Fri", session: "Lower", intensity: 0.6 },
    { label: "Sat", session: null, intensity: 0 },
    { label: "Sun", session: null, intensity: 0 },
  ] } };
  assert.equal(validateTrainingWidget(p).valid, true);
  assert.match(JSON.stringify(WeeklyPlanCalendar(p)), /Upper/);
});
test("weekly_plan_calendar rejects wrong day count", () => {
  const p = { ...b, type: "weekly_plan_calendar", data: { days: [{ label: "Mon", session: null, intensity: 0 }] } };
  assert.equal(validateTrainingWidget(p).valid, false);
});
test("deload_protocol", () => {
  const p = { ...b, type: "deload_protocol", data: {
    before: { sets: 20, rpe: 9 },
    during: { sets: 10, rpe: 6 },
    after: { sets: 16, rpe: 8 },
    fatigue_curve: [{ label: "w1", value: 30 }, { label: "w2", value: 55 }, { label: "w3", value: 80 }, { label: "deload", value: 30 }, { label: "w5", value: 45 }],
  } };
  assert.equal(validateTrainingWidget(p).valid, true);
  assert.match(JSON.stringify(DeloadProtocol(p)), /deload/);
});
