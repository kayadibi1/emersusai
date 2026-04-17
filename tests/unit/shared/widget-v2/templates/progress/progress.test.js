import assert from "node:assert/strict";
import { test } from "node:test";
import { PRTimeline } from "../../../../../../shared/widget-v2/templates/progress/pr-timeline.js";
import { VolumeTrend } from "../../../../../../shared/widget-v2/templates/progress/volume-trend.js";
import { validateProgressWidget } from "../../../../../../shared/widget-v2/validators/progress.js";

const PR_PAYLOAD = {
  title: "Bench press PRs",
  display_width: "wide",
  summary: null,
  follow_up_chips: [],
  type: "pr_timeline",
  data: {
    lift: "Bench Press",
    unit: "kg",
    entries: [
      { date: "2026-01-14", load: 80, reps: 5 },
      { date: "2026-02-11", load: 85, reps: 5 },
      { date: "2026-03-10", load: 87, reps: 5 },
      { date: "2026-04-08", load: 90, reps: 3 },
    ],
  },
};

test("validator accepts pr_timeline", () => {
  const r = validateProgressWidget(PR_PAYLOAD);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects bad date format", () => {
  const bad = { ...PR_PAYLOAD, data: { ...PR_PAYLOAD.data, entries: [{ date: "Jan 1 2026", load: 80, reps: 5 }] } };
  const r = validateProgressWidget(bad);
  assert.equal(r.valid, false);
});

test("validator rejects non-positive load", () => {
  const bad = { ...PR_PAYLOAD, data: { ...PR_PAYLOAD.data, entries: [{ date: "2026-01-01", load: 0, reps: 5 }] } };
  const r = validateProgressWidget(bad);
  assert.equal(r.valid, false);
});

test("pr_timeline component renders lift name + entry count", () => {
  const el = PRTimeline(PR_PAYLOAD);
  const s = JSON.stringify(el);
  assert.match(s, /Bench Press/);
  assert.match(s, /4 entries/);
});

const VT_PAYLOAD = {
  title: "Weekly squat volume",
  display_width: "wide",
  summary: null,
  follow_up_chips: [],
  type: "volume_trend",
  data: {
    metric: "Squat tonnage (kg)",
    points: [
      { week_start: "2026-01-05", value: 4800 },
      { week_start: "2026-01-12", value: 5200 },
      { week_start: "2026-01-19", value: 5600 },
      { week_start: "2026-01-26", value: 5900 },
    ],
  },
};

test("validator accepts volume_trend", () => {
  const r = validateProgressWidget(VT_PAYLOAD);
  assert.equal(r.valid, true, r.errors?.join("; "));
});

test("validator rejects single-point volume trend", () => {
  const bad = { ...VT_PAYLOAD, data: { ...VT_PAYLOAD.data, points: [{ week_start: "2026-01-01", value: 100 }] } };
  const r = validateProgressWidget(bad);
  assert.equal(r.valid, false);
});

test("volume_trend component renders metric label", () => {
  const el = VolumeTrend(VT_PAYLOAD);
  const s = JSON.stringify(el);
  assert.match(s, /Squat tonnage/);
});
