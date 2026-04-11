// Climbing grade definitions and ordering.
// Per-system grade arrays in ascending difficulty order.
// No cross-system conversion in v1.

export const GRADE_SYSTEMS = {
  V: {
    label: "V-scale (bouldering)",
    grades: ["V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12", "V13", "V14", "V15", "V16", "V17"],
  },
  YDS: {
    label: "YDS (sport)",
    grades: [
      "5.6", "5.7", "5.8", "5.9",
      "5.10a", "5.10b", "5.10c", "5.10d",
      "5.11a", "5.11b", "5.11c", "5.11d",
      "5.12a", "5.12b", "5.12c", "5.12d",
      "5.13a", "5.13b", "5.13c", "5.13d",
      "5.14a", "5.14b", "5.14c", "5.14d",
      "5.15a", "5.15b", "5.15c", "5.15d",
    ],
  },
  Font: {
    label: "Fontainebleau (bouldering)",
    grades: [
      "3", "4", "4+", "5", "5+", "6A", "6A+", "6B", "6B+", "6C", "6C+",
      "7A", "7A+", "7B", "7B+", "7C", "7C+", "8A", "8A+", "8B", "8B+", "8C", "8C+", "9A",
    ],
  },
  French: {
    label: "French (sport)",
    grades: [
      "5", "5+", "6a", "6a+", "6b", "6b+", "6c", "6c+",
      "7a", "7a+", "7b", "7b+", "7c", "7c+",
      "8a", "8a+", "8b", "8b+", "8c", "8c+", "9a", "9a+", "9b",
    ],
  },
};

/**
 * Return grade index (higher = harder). Returns -1 if unknown.
 */
export function gradeIndex(grade, system) {
  const def = GRADE_SYSTEMS[system];
  if (!def) return -1;
  return def.grades.indexOf(grade);
}

/**
 * Compare two grades in the same system. Positive if a is harder.
 */
export function compareGrades(a, b, system) {
  return gradeIndex(a, system) - gradeIndex(b, system);
}

/**
 * Find the hardest grade from an array of {grade, send_type, grade_system}.
 * Only considers sends and flashes (not projects).
 */
export function hardestSent(routes) {
  if (!Array.isArray(routes) || routes.length === 0) return null;
  const sent = routes.filter(r => r.send_type === "flash" || r.send_type === "send");
  if (sent.length === 0) return null;

  let hardest = sent[0];
  for (const r of sent.slice(1)) {
    if (r.grade_system !== hardest.grade_system) continue;
    if (compareGrades(r.grade, hardest.grade, r.grade_system) > 0) {
      hardest = r;
    }
  }
  return hardest;
}

/**
 * Map session style → default grade system.
 */
export function defaultSystemForStyle(style) {
  switch (style) {
    case "bouldering":
      return "V";
    case "sport_climbing":
    case "top_rope_climbing":
    case "trad_climbing":
      return "YDS";
    default:
      return "V";
  }
}
