export const REQUIRED_FIELDS = [
  "goal",
  "experience_level",
  "dietary_preferences",
  "equipment",
  "injuries_limitations",
];

function isCaptured(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function computeOnboardingProgress(profile) {
  if (!profile || typeof profile !== "object") return 0.0;
  const captured = REQUIRED_FIELDS.reduce(
    (n, field) => (isCaptured(profile[field]) ? n + 1 : n),
    0,
  );
  return captured / REQUIRED_FIELDS.length;
}
