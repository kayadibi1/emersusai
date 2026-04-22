// shared/train/input-helpers.js
//
// Shared input-clamping helpers for the Train modality components.
// HTML's <input type="number" max="..."> is advisory — browsers still
// accept typed values past max. These helpers enforce hard bounds at
// the onChange-state-update boundary so nothing beyond the configured
// range ever lands in React state (or gets POSTed to the server).
//
// Also handles:
//   - pastes larger than max: clamped to max (not rejected)
//   - negatives: clamped to min (can't type "-" either)
//   - non-numeric keystrokes: rejected silently
//   - transient "" and "." in decimal mode: passed through so users
//     can clear the field or start typing a decimal

/**
 * Build an onChange handler that clamps the input value.
 * @param {(v: string) => void} setter - the React state setter
 * @param {{ min?: number, max?: number, decimal?: boolean }} opts
 * @returns {(e: { target: { value: string } }) => void}
 */
export function clampNumericChange(setter, opts = {}) {
  const { min = 0, max = Infinity, decimal = false } = opts;
  const formatRe = decimal ? /^\d*\.?\d*$/ : /^\d*$/;
  return (e) => {
    const raw = String(e?.target?.value ?? "");
    if (raw === "") { setter(""); return; }
    if (!formatRe.test(raw)) return;          // letters / symbols → reject
    const n = parseFloat(raw);
    if (Number.isNaN(n)) { setter(raw); return; }  // e.g. lone "."
    if (n < min) { setter(String(min)); return; }
    if (n > max) { setter(String(max)); return; }  // clamp (handles paste)
    setter(raw);
  };
}

/**
 * Parse a mm:ss or hh:mm:ss string into total seconds, then clamp to
 * [0, maxSeconds]. Returns the clamped seconds count (int), not a
 * re-formatted string. Callers are expected to either re-render the
 * formatted string on blur, or pass the clamped value to the server
 * on submit and leave the display alone mid-typing.
 *
 * @param {string} raw
 * @param {number} maxSeconds
 * @returns {number}
 */
export function clampDurationSeconds(raw, maxSeconds) {
  if (!raw) return 0;
  const parts = String(raw).split(":").map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p) || p < 0)) return 0;
  let secs = 0;
  if (parts.length === 1) secs = parts[0];
  else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
  else if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Math.max(0, Math.min(secs, maxSeconds));
}

// ─── Per-field caps ───────────────────────────────────────────────
// Upper bounds are set well beyond human-realistic performance so the
// UI doesn't get in the way — just keeps out obviously-wrong inputs.
export const LIMITS = {
  lift: {
    loadKg: { min: 0, max: 1000, decimal: true },   // 1000 kg deadlift > current WR
    reps:   { min: 0, max: 500,  decimal: false },  // 500 reps is beyond any human set
  },
  cardio: {
    distanceKm: { min: 0, max: 500, decimal: true },   // 500 km > any single session
    hr:         { min: 20, max: 250, decimal: false }, // 20–250 bpm covers all humans
    durationSeconds: 24 * 3600,                         // cap at 24 h per segment
  },
  swim: {
    lapSeconds: 30 * 60,         // cap at 30 min per lap (any slower than that = error)
  },
};
