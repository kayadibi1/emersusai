// shared/emersus-orb/state.js
// State machine for the orb — idle / thinking / responding. Pure logic only;
// no DOM, no three.js.

export const STATES = Object.freeze({
  idle: {
    cycleMs: 9000,
    springBase: 0.026, dragBase: 0.88, springTx: 0.045, dragTx: 0.935,
    jitter: 0, trail: 0.08, flow: 0.0, linkAlpha: 0.08,
    camSpeed: 0.22, camTilt: 0.10,
    brightness: 0.82, tint: { r: 90, g: 110, b: 160 }, tintAmt: 0.06,
    stateRotX: 0.06, stateRotY: 0.00, stateRotZ: 0.04,
    breathAmp: 0.00, breathFreq: 0.25,
  },
  thinking: {
    cycleMs: 6000,
    springBase: 0.042, dragBase: 0.84, springTx: 0.060, dragTx: 0.920,
    jitter: 0, trail: 0.12, flow: 0.0, linkAlpha: 0.22,
    camSpeed: 0.32, camTilt: 0.16,
    brightness: 1.00, tint: { r: 191, g: 246, b: 228 }, tintAmt: 0.12,
    stateRotX: 0.18, stateRotY: 0.22, stateRotZ: 0.12,
    breathAmp: 0.08, breathFreq: 0.75,
  },
  responding: {
    cycleMs: 2000,
    springBase: 0.036, dragBase: 0.90, springTx: 0.050, dragTx: 0.930,
    jitter: 0, trail: 0.05, flow: 0.8, linkAlpha: 0.22,
    camSpeed: 0.34, camTilt: 0.18,
    brightness: 0.98, tint: { r: 80, g: 145, b: 242 }, tintAmt: 0.14,
    stateRotX: 0.08, stateRotY: 0.55, stateRotZ: 0.00,
    breathAmp: 0.02, breathFreq: 0.50,
  },
});

export function lerp(a, b, t) { return a + (b - a) * t; }
export function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }
export function bell(t, peak, width) { return Math.exp(-Math.pow((t - peak) / width, 2)); }

// Interpolates every scalar + tint RGB between two STATE entries.
export function lerpStateParams(a, b, t) {
  return {
    cycleMs: lerp(a.cycleMs, b.cycleMs, t),
    springBase: lerp(a.springBase, b.springBase, t),
    dragBase: lerp(a.dragBase, b.dragBase, t),
    springTx: lerp(a.springTx, b.springTx, t),
    dragTx: lerp(a.dragTx, b.dragTx, t),
    jitter: lerp(a.jitter, b.jitter, t),
    trail: lerp(a.trail, b.trail, t),
    flow: lerp(a.flow, b.flow, t),
    linkAlpha: lerp(a.linkAlpha, b.linkAlpha, t),
    camSpeed: lerp(a.camSpeed, b.camSpeed, t),
    camTilt: lerp(a.camTilt, b.camTilt, t),
    brightness: lerp(a.brightness, b.brightness, t),
    tint: {
      r: lerp(a.tint.r, b.tint.r, t),
      g: lerp(a.tint.g, b.tint.g, t),
      b: lerp(a.tint.b, b.tint.b, t),
    },
    tintAmt: lerp(a.tintAmt, b.tintAmt, t),
    stateRotX: lerp(a.stateRotX, b.stateRotX, t),
    stateRotY: lerp(a.stateRotY, b.stateRotY, t),
    stateRotZ: lerp(a.stateRotZ, b.stateRotZ, t),
    breathAmp: lerp(a.breathAmp, b.breathAmp, t),
    breathFreq: lerp(a.breathFreq, b.breathFreq, t),
  };
}
