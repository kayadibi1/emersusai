import assert from "node:assert/strict";
import { test } from "node:test";
import { PeriodizationLadder } from "../../../../../../shared/widget-v2/templates/training/periodization-ladder.js";
import { VolumeIntensityGrid } from "../../../../../../shared/widget-v2/templates/training/volume-intensity-grid.js";
import { validateTrainingWidget } from "../../../../../../shared/widget-v2/validators/training.js";

const PERIODIZATION_PAYLOAD = {
  title: "12-week hypertrophy block",
  display_width: "wide",
  summary: null,
  follow_up_chips: [],
  type: "periodization_ladder",
  data: {
    weeks: 12,
    focus_metric: "volume",
    phases: [
      { name: "Accumulation", start_week: 1, end_week: 4, relative_load: 0.75 },
      { name: "Intensification", start_week: 5, end_week: 8, relative_load: 0.9 },
      { name: "Realization", start_week: 9, end_week: 11, relative_load: 1.0 },
      { name: "Deload", start_week: 12, end_week: 12, relative_load: 0.5 },
    ],
  },
};

test("validator accepts periodization_ladder", () => {
  const r = validateTrainingWidget(PERIODIZATION_PAYLOAD);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects end_week < start_week", () => {
  const bad = { ...PERIODIZATION_PAYLOAD, data: { ...PERIODIZATION_PAYLOAD.data, phases: [{ name: "X", start_week: 5, end_week: 2, relative_load: 0.8 }] } };
  const r = validateTrainingWidget(bad);
  assert.equal(r.valid, false);
});

test("validator rejects bad focus_metric", () => {
  const bad = { ...PERIODIZATION_PAYLOAD, data: { ...PERIODIZATION_PAYLOAD.data, focus_metric: "vibes" } };
  const r = validateTrainingWidget(bad);
  assert.equal(r.valid, false);
});

test("periodization component renders phase names", () => {
  const el = PeriodizationLadder(PERIODIZATION_PAYLOAD);
  const s = JSON.stringify(el);
  assert.match(s, /Accumulation/);
  assert.match(s, /Realization/);
  assert.match(s, /Deload/);
});

const VIG_PAYLOAD = {
  title: "Volume by lift",
  display_width: "wide",
  summary: null,
  follow_up_chips: [],
  type: "volume_intensity_grid",
  data: {
    lifts: ["Squat", "Bench", "Deadlift"],
    weeks: [1, 2, 3, 4],
    cells: [
      { lift: "Squat", week: 1, volume: 120 },
      { lift: "Squat", week: 2, volume: 130 },
      { lift: "Bench", week: 1, volume: 80 },
      { lift: "Deadlift", week: 4, volume: 150 },
    ],
  },
};

test("validator accepts volume_intensity_grid", () => {
  const r = validateTrainingWidget(VIG_PAYLOAD);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects negative volume", () => {
  const bad = { ...VIG_PAYLOAD, data: { ...VIG_PAYLOAD.data, cells: [{ lift: "X", week: 1, volume: -5 }] } };
  const r = validateTrainingWidget(bad);
  assert.equal(r.valid, false);
});

test("grid component renders lift names + week headers", () => {
  const el = VolumeIntensityGrid(VIG_PAYLOAD);
  const s = JSON.stringify(el);
  assert.match(s, /Squat/);
  assert.match(s, /Deadlift/);
  assert.match(s, /w1/);
  assert.match(s, /w4/);
});
