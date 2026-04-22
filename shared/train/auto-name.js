// shared/train/auto-name.js
//
// Generate a session title from logged content, per modality. Called on
// session finish (confirmFinish in app/train/train.js) if the user never
// typed their own title. Never overwrites a user-provided title.
//
// Each modality has its own heuristic:
//   lift   → top exercises (≤3) or movement-pattern ("Push day"/"Pull day"/…)
//   cardio → distance/duration + activity label (when detectable)
//   swim   → stroke + lap count
//   climb  → route count + hardest grade

// Muscle-group → movement-pattern buckets. Mirrors the seed data in
// supabase/*_exercises*.sql which tags each exercise with muscle_groups.
const PUSH_MUSCLES = new Set(["chest", "upper_chest", "lower_chest", "front_delts", "side_delts", "triceps"]);
const PULL_MUSCLES = new Set(["back", "lats", "biceps", "rear_delts", "traps", "forearms"]);
const LEG_MUSCLES  = new Set(["quads", "glutes", "hamstrings", "calves", "adductors"]);
const CORE_MUSCLES = new Set(["abs", "obliques", "core", "hip_flexors"]);

// Short-form exercise name: drop the equipment prefix so "Barbell Bench
// Press" → "Bench Press". Gives enough context for a short title like
// "Bench Press + Squat + Row".
function shortExerciseName(fullName) {
  if (!fullName) return null;
  return String(fullName).replace(
    /^(Barbell|Dumbbell|DB|BB|EZ[- ]?Bar|Smith Machine|Cable|Machine|Kettlebell|KB|Trap[- ]?Bar|Landmine)\s+/i,
    "",
  ).trim();
}

function movementPattern(entries, exerciseLookup) {
  const groups = { push: 0, pull: 0, legs: 0, core: 0 };
  for (const [id, setCount] of entries) {
    const ex = exerciseLookup?.[id];
    const mgs = Array.isArray(ex?.muscle_groups) ? ex.muscle_groups : [];
    for (const mg of mgs) {
      if (PUSH_MUSCLES.has(mg)) groups.push += setCount;
      else if (PULL_MUSCLES.has(mg)) groups.pull += setCount;
      else if (LEG_MUSCLES.has(mg))  groups.legs += setCount;
      else if (CORE_MUSCLES.has(mg)) groups.core += setCount;
    }
  }
  const total = groups.push + groups.pull + groups.legs + groups.core;
  if (!total) return null;
  const dominant = Object.entries(groups).sort((a, b) => b[1] - a[1])[0];
  const [key, count] = dominant;
  // Single-pattern dominance threshold: ≥60% of tagged muscle-set-count.
  if (count / total >= 0.6) {
    if (key === "push") return "Push day";
    if (key === "pull") return "Pull day";
    if (key === "legs") return "Leg day";
    if (key === "core") return "Core day";
  }
  // Mixed fallbacks — upper, full-body.
  if (groups.push > 0 && groups.pull > 0 && groups.legs > 0) return "Full body";
  if (groups.push > 0 && groups.pull > 0) return "Upper body";
  if (groups.legs > 0 && (groups.push + groups.pull) > 0) return "Full body";
  return null;
}

function liftTitle(sets, exerciseLookup) {
  if (!sets || !sets.length) return "Lift session";
  const byExerciseId = new Map();
  for (const set of sets) {
    const id = set?.exercise_id;
    if (!id) continue;
    byExerciseId.set(id, (byExerciseId.get(id) || 0) + 1);
  }
  if (byExerciseId.size === 0) return "Lift session";
  const entries = Array.from(byExerciseId.entries()).sort((a, b) => b[1] - a[1]);
  const names = entries
    .slice(0, 3)
    .map(([id]) => shortExerciseName(exerciseLookup?.[id]?.name))
    .filter(Boolean);
  if (entries.length <= 3 && names.length > 0) {
    return names.join(" + ");
  }
  // 4+ exercises: prefer movement-pattern label, fall back to top-3 + more.
  const pattern = movementPattern(entries, exerciseLookup);
  if (pattern) return pattern;
  if (names.length >= 2) return `${names[0]} + ${names[1]} +${entries.length - 2} more`;
  return `${entries.length} lifts`;
}

function cardioTitle(sets) {
  if (!sets || !sets.length) return "Cardio session";
  const totalMeters = sets.reduce((acc, s) => {
    const m = Number(s?.distance_m) || Number(s?.detail?.distance_m) || 0;
    return acc + m;
  }, 0);
  const totalSecs = sets.reduce((acc, s) => {
    const d = Number(s?.duration_s) || Number(s?.detail?.duration_s) || 0;
    return acc + d;
  }, 0);
  // Activity type, if any set has detail.activity_type set to a known value.
  const typeSet = new Set(
    sets.map((s) => (s?.detail?.activity_type || s?.activity_type || "")).filter(Boolean),
  );
  const type = typeSet.size === 1 ? [...typeSet][0] : null;
  const labelMap = {
    running: "run",
    run: "run",
    cycling: "ride",
    cycle: "ride",
    walking: "walk",
    walk: "walk",
    hiking: "hike",
    rowing: "row",
    row: "row",
  };
  const verb = (type && labelMap[type.toLowerCase()]) || "cardio";
  if (totalMeters >= 500) {
    const km = (totalMeters / 1000).toFixed(totalMeters >= 10000 ? 0 : 1);
    return `${km} km ${verb}`;
  }
  if (totalSecs >= 60) {
    const mins = Math.round(totalSecs / 60);
    return `${mins} min ${verb}`;
  }
  return verb === "cardio" ? "Cardio session" : `${verb.charAt(0).toUpperCase()}${verb.slice(1)} session`;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function swimTitle(sets) {
  const laps = sets?.length || 0;
  if (!laps) return "Swim session";
  const strokes = new Set(sets.map((s) => s?.detail?.stroke).filter(Boolean));
  const strokeLabel = strokes.size === 1
    ? capitalize([...strokes][0])
    : strokes.size === 0 ? "Swim" : "Mixed";
  return `${strokeLabel} · ${laps} lap${laps === 1 ? "" : "s"}`;
}

// Compare two V-scale grades ("V4", "V10") — returns the harder one.
function hardestVGrade(grades) {
  const parsed = grades
    .map((g) => (String(g).match(/^V(\d+)/i) || [])[1])
    .map((n) => (n == null ? null : parseInt(n, 10)))
    .filter((n) => n != null && !Number.isNaN(n));
  if (!parsed.length) return null;
  return `V${Math.max(...parsed)}`;
}

// Fontainebleau / French sport: "6a", "6a+", "6b", "7c+"… rough lex sort.
function hardestFrenchGrade(grades) {
  const fr = grades.filter((g) => /^[3-9][a-c]\+?$/i.test(g));
  if (!fr.length) return null;
  return fr.slice().sort().pop();
}

function climbTitle(sets) {
  if (!sets || !sets.length) return "Climb session";
  const grades = sets.map((s) => s?.detail?.grade).filter(Boolean);
  const hardest = hardestVGrade(grades) || hardestFrenchGrade(grades) || (grades[0] || null);
  const routeCount = sets.length;
  const routeWord = `problem${routeCount === 1 ? "" : "s"}`;
  if (hardest) return `${routeCount} ${routeWord} · top ${hardest}`;
  return `${routeCount} ${routeWord}`;
}

/**
 * Generate a session title from what was logged. Returns null if the
 * content is too sparse to name meaningfully (caller should fall back
 * to "Untitled <modality> session").
 *
 * @param {{
 *   modality: string,
 *   sets?: any[],
 *   exerciseLookup?: Record<string, any>,
 * }} args
 * @returns {string|null}
 */
export function generateSessionTitle({ modality, sets = [], exerciseLookup = {} }) {
  if (!Array.isArray(sets) || sets.length === 0) return null;
  if (modality === "lift")   return liftTitle(sets, exerciseLookup);
  if (modality === "cardio") return cardioTitle(sets);
  if (modality === "swim")   return swimTitle(sets);
  if (modality === "climb")  return climbTitle(sets);
  return null;
}
