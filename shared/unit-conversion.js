// Weight unit conversion helpers.
// Canonical storage is kg. UI converts at the edges.

const KG_TO_LBS = 2.20462;
const LBS_TO_KG = 0.453592;

// Locales that default to lbs (imperial system countries)
const LBS_LOCALES = new Set(["en-US", "en-LR", "my-MM"]);

/**
 * Detect the user's preferred weight unit from browser locale.
 * @returns {"kg"|"lbs"}
 */
export function detectWeightUnitFromLocale() {
  if (typeof navigator === "undefined") return "kg";
  const lang = navigator.language || "";
  // Exact match first, then language prefix
  if (LBS_LOCALES.has(lang)) return "lbs";
  if (lang.startsWith("en-US")) return "lbs";
  return "kg";
}

/**
 * Resolve the user's weight unit, preferring their explicit choice,
 * falling back to locale detection, then kg.
 * @param {string|null|undefined} profileUnit
 * @returns {"kg"|"lbs"}
 */
export function resolveWeightUnit(profileUnit) {
  if (profileUnit === "kg" || profileUnit === "lbs") return profileUnit;
  return detectWeightUnitFromLocale();
}

/**
 * Convert kilograms to the target unit.
 * @param {number|null|undefined} kg
 * @param {"kg"|"lbs"} targetUnit
 * @returns {number|null}
 */
export function fromKg(kg, targetUnit) {
  if (kg == null || isNaN(kg)) return null;
  if (targetUnit === "lbs") return kg * KG_TO_LBS;
  return kg;
}

/**
 * Convert a value in the source unit back to kilograms (canonical storage).
 * @param {number|null|undefined} value
 * @param {"kg"|"lbs"} sourceUnit
 * @returns {number|null}
 */
export function toKg(value, sourceUnit) {
  if (value == null || isNaN(value)) return null;
  if (sourceUnit === "lbs") return value * LBS_TO_KG;
  return value;
}

/**
 * Format a weight value for display with unit suffix.
 * @param {number|null|undefined} kg - Weight in kilograms (canonical)
 * @param {"kg"|"lbs"} unit - Target display unit
 * @param {{decimals?: number, noSuffix?: boolean}} opts
 * @returns {string}
 */
export function formatWeight(kg, unit, { decimals = 0, noSuffix = false } = {}) {
  if (kg == null || isNaN(kg)) return "-";
  const value = fromKg(kg, unit);
  const rounded = decimals > 0 ? value.toFixed(decimals) : Math.round(value);
  return noSuffix ? String(rounded) : `${rounded}${unit}`;
}

/**
 * Format total volume (sum of load × reps). Shows tonnes/thousand-lbs for large values.
 * @param {number|null|undefined} kg - Total volume in kilograms
 * @param {"kg"|"lbs"} unit
 * @returns {string}
 */
export function formatVolumeWithUnit(kg, unit) {
  if (kg == null || isNaN(kg)) return "0" + unit;
  const value = fromKg(kg, unit);
  if (unit === "lbs") {
    // Use "k lbs" for thousands (parallel to tonnes for kg)
    if (value >= 10000) return `${(value / 1000).toFixed(1)}k lbs`;
    return `${Math.round(value)} lbs`;
  }
  // kg: use tonnes above 1000kg
  if (value >= 1000) return `${(value / 1000).toFixed(1)}t`;
  return `${Math.round(value)}kg`;
}

/**
 * Parse a prescribed load string from an LLM plan (e.g., "60kg", "135 lbs", "bodyweight").
 * Returns the numeric value in kg + the detected source unit.
 * Returns null for non-numeric strings (bodyweight, RPE-only prescriptions).
 * @param {string|null|undefined} loadStr
 * @returns {{kg: number, sourceUnit: "kg"|"lbs"}|null}
 */
export function parseLoadString(loadStr) {
  if (!loadStr || typeof loadStr !== "string") return null;
  const trimmed = loadStr.trim().toLowerCase();
  if (!trimmed) return null;

  // Match a number with optional unit suffix
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(kg|lbs?|pounds?|kilos?)?/i);
  if (!match) return null;

  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;

  const unitMatch = match[2]?.toLowerCase();
  const sourceUnit = (unitMatch && (unitMatch.startsWith("lb") || unitMatch.startsWith("pound"))) ? "lbs" : "kg";

  return {
    kg: sourceUnit === "lbs" ? num * LBS_TO_KG : num,
    sourceUnit,
  };
}

/**
 * Reformat a prescribed load string in the user's preferred unit.
 * Preserves non-numeric strings (e.g., "bodyweight", "RPE 8").
 * @param {string|null|undefined} loadStr
 * @param {"kg"|"lbs"} targetUnit
 * @returns {string|null} - The reformatted string, or the original if not parseable
 */
export function displayLoadString(loadStr, targetUnit) {
  if (!loadStr) return loadStr;
  const parsed = parseLoadString(loadStr);
  if (!parsed) return loadStr; // Not a numeric load — pass through
  if (parsed.sourceUnit === targetUnit) return loadStr;
  return formatWeight(parsed.kg, targetUnit);
}
