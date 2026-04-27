// api/emersus/pipeline/mode2-flags.js
//
// Centralized feature-flag and config helpers for the Mode-2 Qualifier-
// Preservation Verifier (MQPV). All env reads happen here so tests can
// mock once and downstream modules read pure functions.

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return String(raw).toLowerCase() === "true";
}

function envNumber(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

export function mode2VerifierEnabled() {
  return envFlag("MODE2_VERIFIER_ENABLED", false);
}

export function mode2Rewrite2Enabled() {
  // Whether the second rewrite (preserve-or-hedge fallback) is allowed.
  // Bench-driven scale-back may set this to false if telemetry shows
  // rewrite #2 rarely activates and rarely helps.
  return envFlag("MODE2_REWRITE_2_ENABLED", true);
}

export function mode2DisabledQualifiers() {
  // Comma-separated qualifier types to skip in the validator (e.g.,
  // "effect_size,sample_size"). Bench-driven scale-back fills this in.
  const raw = process.env.MODE2_DISABLED_QUALIFIERS || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function mode2ExtractorModel() {
  return process.env.MODE2_EXTRACTOR_MODEL || "gpt-5.4-mini";
}

export function mode2ValidatorModel() {
  return process.env.MODE2_VALIDATOR_MODEL || "gpt-5.4-mini";
}

export function mode2RewriterModel() {
  return process.env.MODE2_REWRITER_MODEL || "gpt-5.4-mini";
}

export function mode2LengthRatioFloor() {
  return envNumber("MODE2_LENGTH_RATIO_FLOOR", 0.6);
}

export function mode2LengthRatioCeiling() {
  return envNumber("MODE2_LENGTH_RATIO_CEILING", 1.5);
}
