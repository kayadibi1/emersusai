// shared/progress-ghost-samples.js
// Static demo data for the muted "ghost" previews shown on /app/progress/
// when a user is below the unlock threshold for a given chart slot.
//
// Shape matches what each chart helper in shared/progress-charts.js expects,
// so the render path is identical to real data — we just wrap it in a muted
// <ChartGhost>.

export const GHOST_TARGETS = {
  personal_records: { target: 1, unit: "session" },
  momentum:         { target: 3, unit: "sessions" },
  beeswarm:         { target: 5, unit: "sets on one lift" },
  zone_river:       { target: 4, unit: "cardio sessions" },
  control_chart:    { target: 4, unit: "weeks" },
  recent_sessions:  { target: 1, unit: "session" },
};

export const MOMENTUM_SAMPLE = [
  {
    slug: "bench-press",
    name: "Bench Press",
    current_e1rm_kg: 82.5,
    period_weeks: 12,
    last_set: { load_kg: 75, reps: 5, rpe: 8 },
    sparkline: [68, 68, 70, 72, 72, 74, 75, 77, 78, 80, 81, 82.5],
    pr_weeks: [5, 9, 11],
    momentum_kg: 4.5,
    momentum_label: "up",
    benchmark: { low_kg: 70, high_kg: 95, level: "intermediate" },
  },
  {
    slug: "back-squat",
    name: "Back Squat",
    current_e1rm_kg: 112,
    period_weeks: 12,
    last_set: { load_kg: 100, reps: 5, rpe: 8 },
    sparkline: [95, 96, 98, 100, 102, 104, 105, 107, 108, 110, 111, 112],
    pr_weeks: [3, 7, 11],
    momentum_kg: 5,
    momentum_label: "up",
    benchmark: { low_kg: 100, high_kg: 130, level: "intermediate" },
  },
  {
    slug: "deadlift",
    name: "Deadlift",
    current_e1rm_kg: 140,
    period_weeks: 12,
    last_set: { load_kg: 130, reps: 5, rpe: 8 },
    sparkline: [120, 122, 124, 125, 128, 130, 132, 134, 136, 138, 139, 140],
    pr_weeks: [5, 9, 11],
    momentum_kg: 7,
    momentum_label: "up",
    benchmark: { low_kg: 125, high_kg: 160, level: "intermediate" },
  },
];

// 24 demo sets across 6 weeks of bench-press. RPE 6-9 spread, loads climbing.
function makeBeeswarmSets() {
  const sets = [];
  const perWeek = [
    { week: 0, loads: [60, 60, 62, 62] },
    { week: 1, loads: [62, 64, 64, 65] },
    { week: 2, loads: [65, 67, 67, 70] },
    { week: 3, loads: [70, 70, 72, 72] },
    { week: 4, loads: [72, 74, 74, 75] },
    { week: 5, loads: [75, 75, 77, 80] },
  ];
  for (const w of perWeek) {
    for (const load of w.loads) {
      sets.push({
        week_idx: w.week,
        load_kg: load,
        reps: 5,
        rpe: load >= 77 ? 9 : load >= 70 ? 8 : 7,
        performed_at: null,
        is_pr: load >= 80,
      });
    }
  }
  return sets;
}

export const BEESWARM_SAMPLE = {
  exercise_slug: "bench-press",
  exercise_name: "Bench press",
  weeks: 6,
  sets: makeBeeswarmSets(),
  pr_load_kg: 80,
  total_sets: 24,
};

// 6 weeks, polarized pattern (z1 heavy, some z4/z5, little z2/z3)
export const ZONE_RIVER_SAMPLE = {
  weeks: [
    { week_idx: 0, z1: 45, z2: 5,  z3: 0,  z4: 10, z5: 0  },
    { week_idx: 1, z1: 60, z2: 10, z3: 0,  z4: 8,  z5: 5  },
    { week_idx: 2, z1: 50, z2: 8,  z3: 5,  z4: 0,  z5: 10 },
    { week_idx: 3, z1: 70, z2: 5,  z3: 0,  z4: 15, z5: 0  },
    { week_idx: 4, z1: 55, z2: 10, z3: 0,  z4: 5,  z5: 10 },
    { week_idx: 5, z1: 65, z2: 5,  z3: 5,  z4: 12, z5: 3  },
  ],
  pattern: "polarized",
  pattern_label: "Polarized pattern",
  hr_estimate_note: null,
};

// 6 weeks of ACWR in the safe corridor
export const CONTROL_CHART_SAMPLE = {
  weeks: [
    { week_idx: 0, date_start: null, acwr: 0.92, acute_load: 1800, chronic_load: 1950, out_of_control: false },
    { week_idx: 1, date_start: null, acwr: 1.05, acute_load: 2050, chronic_load: 1950, out_of_control: false },
    { week_idx: 2, date_start: null, acwr: 1.12, acute_load: 2200, chronic_load: 1965, out_of_control: false },
    { week_idx: 3, date_start: null, acwr: 0.98, acute_load: 1920, chronic_load: 1960, out_of_control: false },
    { week_idx: 4, date_start: null, acwr: 1.08, acute_load: 2120, chronic_load: 1965, out_of_control: false },
    { week_idx: 5, date_start: null, acwr: 1.02, acute_load: 2000, chronic_load: 1965, out_of_control: false },
  ],
  current_acwr: 1.02,
  mean_acwr: 1.03,
  excursions: 0,
  status: "in_control",
};

// Simple row shapes the existing PrCard / RecentSessionRow can render in a
// muted/placeholder style. Client renders three of these as the sample.
export const PR_SAMPLE = [
  { exercise_name: "Bench press", weight_kg: 82.5, delta_kg: null, is_first: false },
  { exercise_name: "Back squat",  weight_kg: 112,  delta_kg: null, is_first: false },
  { exercise_name: "Deadlift",    weight_kg: 140,  delta_kg: null, is_first: false },
];

export const RECENT_SESSIONS_SAMPLE = [
  { id: "ghost-1", modality: "lift",   title: "Upper body",  started_at: null, ended_at: null },
  { id: "ghost-2", modality: "cardio", title: "Zone 2 run",  started_at: null, ended_at: null },
];
