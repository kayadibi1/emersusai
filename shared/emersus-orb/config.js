// shared/emersus-orb/config.js
// Central tunables for the chat orb. All physics/visual knobs locked from the
// brainstorm session on 2026-04-22. Override any numeric value via ?tune=1 URL
// flag plus a matching query key (dev only).

export const DEFAULTS = Object.freeze({
  // physics (user-tuned)
  curve:         0.04,
  continuous:    0,
  overshoot:     0,
  preBurst:      1.0,
  staggerMs:     750,
  spin:          1.0,

  // rendering
  particleCount: 260,
  trailLen:      40,

  // timing
  transitWindowMs: 2200,   // per-particle transit window (underdamped phase)
  burstWindowMs:   350,    // pre-burst spring-amplification window
  stateTxMs:       2200,   // state change eased-lerp duration
});

const TUNABLE_KEYS = new Set([
  'curve', 'continuous', 'overshoot', 'preBurst', 'staggerMs', 'spin',
]);

export function readTuning(search) {
  const out = { ...DEFAULTS };
  if (!search) return out;
  const qs = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(qs);
  if (params.get('tune') !== '1') return out;
  for (const [k, v] of params.entries()) {
    if (!TUNABLE_KEYS.has(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}
