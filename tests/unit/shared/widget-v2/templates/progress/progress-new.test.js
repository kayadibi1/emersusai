import assert from "node:assert/strict";
import { test } from "node:test";
import { LiftProgressGrid } from "../../../../../../shared/widget-v2/templates/progress/lift-progress-grid.js";
import { WeeklyVolumeTrendProgress } from "../../../../../../shared/widget-v2/templates/progress/weekly-volume-trend.js";
import { AdherenceCalendarHeatmap } from "../../../../../../shared/widget-v2/templates/progress/adherence-calendar-heatmap.js";
import { BodyCompTrend } from "../../../../../../shared/widget-v2/templates/progress/body-comp-trend.js";
import { GoalTrajectoryDual } from "../../../../../../shared/widget-v2/templates/progress/goal-trajectory-dual.js";
import { InterventionSlopegraph } from "../../../../../../shared/widget-v2/templates/progress/intervention-slopegraph.js";
import { SessionConsistencyStrip } from "../../../../../../shared/widget-v2/templates/progress/session-consistency-strip.js";
import { Vo2maxTrend } from "../../../../../../shared/widget-v2/templates/progress/vo2max-trend.js";
import { SleepConsistencyBars } from "../../../../../../shared/widget-v2/templates/progress/sleep-consistency-bars.js";
import { PrCelebrationCard } from "../../../../../../shared/widget-v2/templates/progress/pr-celebration-card.js";
import { StreakCounterCard } from "../../../../../../shared/widget-v2/templates/progress/streak-counter-card.js";
import { validateProgressWidget } from "../../../../../../shared/widget-v2/validators/progress.js";

const b = { title: "t", display_width: "wide", summary: null, follow_up_chips: [] };

test("lift_progress_grid", () => {
  const p = { ...b, type: "lift_progress_grid", data: { lifts: [
    { name: "Squat", current: 140, delta_pct: 8.2, sparkline: [120, 125, 130, 135, 140], plateau: false },
    { name: "Bench", current: 100, delta_pct: 0.5, sparkline: [100, 100, 100, 100, 100], plateau: true },
  ] } };
  assert.equal(validateProgressWidget(p).valid, true);
  assert.match(JSON.stringify(LiftProgressGrid(p)), /Squat/);
});
test("weekly_volume_trend", () => {
  const p = { ...b, type: "weekly_volume_trend", data: { muscle_order: ["Chest", "Back", "Legs"], weeks: [
    { week_start: "2026-01-05", muscle_sets: [{ muscle: "Chest", sets: 12 }, { muscle: "Back", sets: 14 }, { muscle: "Legs", sets: 18 }] },
    { week_start: "2026-01-12", muscle_sets: [{ muscle: "Chest", sets: 14 }, { muscle: "Back", sets: 16 }, { muscle: "Legs", sets: 20 }] },
    { week_start: "2026-01-19", muscle_sets: [{ muscle: "Chest", sets: 15 }, { muscle: "Back", sets: 18 }, { muscle: "Legs", sets: 22 }] },
  ] } };
  assert.equal(validateProgressWidget(p).valid, true);
  assert.match(JSON.stringify(WeeklyVolumeTrendProgress(p)), /Chest/);
});
test("adherence_calendar_heatmap", () => {
  const p = { ...b, type: "adherence_calendar_heatmap", data: { cells: [
    { date: "2026-01-05", intensity: 0.8 }, { date: "2026-01-06", intensity: 0.6 },
    { date: "2026-01-08", intensity: 0.9 }, { date: "2026-01-10", intensity: 0.7 },
  ] } };
  assert.equal(validateProgressWidget(p).valid, true);
  assert.ok(AdherenceCalendarHeatmap(p));
});
test("body_comp_trend", () => {
  const p = { ...b, type: "body_comp_trend", data: { comp_points: [
    { date: "2026-01-01", bw: 80, lbm: 65, fm: 15 },
    { date: "2026-02-01", bw: 79, lbm: 66, fm: 13 },
    { date: "2026-03-01", bw: 78, lbm: 66.5, fm: 11.5 },
  ] } };
  assert.equal(validateProgressWidget(p).valid, true);
  assert.match(JSON.stringify(BodyCompTrend(p)), /2026-03-01/);
});
test("goal_trajectory_dual", () => {
  const p = { ...b, type: "goal_trajectory_dual", data: {
    actual: [{ date: "2026-01-01", value: 120 }, { date: "2026-02-01", value: 125 }, { date: "2026-03-01", value: 131 }],
    projected: [{ date: "2026-04-01", low: 133, high: 138 }, { date: "2026-05-01", low: 136, high: 144 }, { date: "2026-06-01", low: 139, high: 150 }],
    goal_value: 140,
  } };
  assert.equal(validateProgressWidget(p).valid, true);
  assert.ok(GoalTrajectoryDual(p));
});
test("intervention_slopegraph", () => {
  const p = { ...b, type: "intervention_slopegraph", data: { before_label: "Before", after_label: "After", people: [
    { label: "A", before: 100, after: 115 }, { label: "B", before: 95, after: 110 }, { label: "C", before: 105, after: 105 },
  ] } };
  assert.equal(validateProgressWidget(p).valid, true);
  assert.match(JSON.stringify(InterventionSlopegraph(p)), /Before/);
});
test("session_consistency_strip", () => {
  const p = { ...b, type: "session_consistency_strip", data: { sessions: [
    { date: "2026-01-05", hour: 6.5 }, { date: "2026-01-06", hour: 6.75 },
    { date: "2026-01-08", hour: 7 }, { date: "2026-01-10", hour: 6.5 }, { date: "2026-01-12", hour: 7.25 },
  ] } };
  assert.equal(validateProgressWidget(p).valid, true);
  assert.ok(SessionConsistencyStrip(p));
});
test("vo2max_trend", () => {
  const p = { ...b, type: "vo2max_trend", data: { age_group: "30-39_male", vo2_points: [
    { date: "2026-01-01", value: 38 }, { date: "2026-02-01", value: 41 }, { date: "2026-03-01", value: 43 },
  ] } };
  assert.equal(validateProgressWidget(p).valid, true);
  assert.match(JSON.stringify(Vo2maxTrend(p)), /Fair|Good/);
});
test("sleep_consistency_bars", () => {
  const p = { ...b, type: "sleep_consistency_bars", data: { target_bed: 22, target_wake: 6, nights: [
    { date: "2026-04-10", bed_hour: 22.5, wake_hour: 6 },
    { date: "2026-04-11", bed_hour: 23, wake_hour: 6.5 },
    { date: "2026-04-12", bed_hour: 22, wake_hour: 6 },
  ] } };
  assert.equal(validateProgressWidget(p).valid, true);
  assert.ok(SleepConsistencyBars(p));
});
test("pr_celebration_card", () => {
  const p = { ...b, type: "pr_celebration_card", data: { lift: "Back Squat 1RM", value: 140, unit: "kg", previous: 135, context: "New 3-month high" } };
  assert.equal(validateProgressWidget(p).valid, true);
  assert.match(JSON.stringify(PrCelebrationCard(p)), /140/);
});
test("streak_counter_card", () => {
  const p = { ...b, type: "streak_counter_card", data: { current: 12, best: 24, last_14: Array(14).fill(true) } };
  assert.equal(validateProgressWidget(p).valid, true);
  assert.match(JSON.stringify(StreakCounterCard(p)), /12/);
});
test("streak_counter_card rejects wrong last_14 length", () => {
  const p = { ...b, type: "streak_counter_card", data: { current: 1, best: 1, last_14: [true, false] } };
  assert.equal(validateProgressWidget(p).valid, false);
});
