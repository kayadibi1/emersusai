// shared/emersus-orb/index.js
// Public API entry. Orchestrates shape / physics / state / render.

import { SHAPE_GENERATORS, SHAPE_SPIN, SHAPE_NAMES } from './shapes.js';
import { greedyNearestAssign, curlAxisForPath, initialTangentVelocity } from './physics.js';
import { STATES, easeInOutCubic, bell, lerpStateParams, breathScale } from './state.js';
import { createRenderer, updatePoints, updateLinks, updateTrails, render as drawFrame } from './render.js';
import { DEFAULTS, readTuning } from './config.js';

const COLORS = [[191,246,228], [52,211,153], [80,145,242], [67,56,202]];

function rotateY(p, a) { const c=Math.cos(a), s=Math.sin(a); return [p[0]*c + p[2]*s, p[1], -p[0]*s + p[2]*c]; }
function rotateX(p, a) { const c=Math.cos(a), s=Math.sin(a); return [p[0], p[1]*c - p[2]*s, p[1]*s + p[2]*c]; }
function rotateZ(p, a) { const c=Math.cos(a), s=Math.sin(a); return [p[0]*c - p[1]*s, p[0]*s + p[1]*c, p[2]]; }
function rotateAxis(p, axis, angle) {
  const [x, y, z] = p;
  const [ux, uy, uz] = axis;
  const c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
  const dot = x*ux + y*uy + z*uz;
  const cx = uy*z - uz*y, cy = uz*x - ux*z, cz = ux*y - uy*x;
  return [
    x*c + cx*s + ux*dot*k,
    y*c + cy*s + uy*dot*k,
    z*c + cz*s + uz*dot*k,
  ];
}

export function createEmersusOrb(canvas, opts = {}) {
  const tuning = readTuning(typeof window !== 'undefined' ? window.location.search : '');
  const size = opts.size || 160;
  const initialState = opts.initialState || 'idle';
  const initialShape = opts.initialShape || 'sphere';
  if (!STATES[initialState]) throw new Error(`emersus-orb: unknown initialState "${initialState}"`);
  if (!SHAPE_GENERATORS[initialShape]) throw new Error(`emersus-orb: unknown initialShape "${initialShape}"`);

  // ─── Reduced-motion detection ───
  let reducedMotion = false;
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = mq.matches;
    mq.addEventListener?.('change', (e) => { reducedMotion = e.matches; });
  }

  const particleCount = DEFAULTS.particleCount;
  const trailLen = DEFAULTS.trailLen;

  const renderCtx = createRenderer(canvas, { size, particleCount, trailLen });

  // particles — full state per particle
  const pts = [];
  const initTargets = SHAPE_GENERATORS[initialShape](particleCount);
  for (let i = 0; i < particleCount; i++) {
    const c = COLORS[i % COLORS.length];
    pts.push({
      x: initTargets[i][0], y: initTargets[i][1], z: initTargets[i][2],
      tx: initTargets[i][0], ty: initTargets[i][1], tz: initTargets[i][2],
      vx: 0, vy: 0, vz: 0,
      rx: initTargets[i][0], ry: initTargets[i][1], rz: initTargets[i][2],
      baseRGB: c,
      transitStart: 0, transitAbsorbed: true, pendingTarget: null,
      springJ: 0.9 + Math.random() * 0.2, dragJ: 0.97 + Math.random() * 0.06,
      curlAx: 0, curlAy: 1, curlAz: 0, curlSign: Math.random() < 0.5 ? 1 : -1,
      trail: new Array(trailLen).fill(null), trailIdx: 0,
    });
  }

  let current = JSON.parse(JSON.stringify(STATES[initialState]));
  current.tint = { ...STATES[initialState].tint };
  let state = initialState;
  let stx = null;
  let currentShape = initialShape;
  let lastShapeChange = performance.now();
  let spinAxis = SHAPE_SPIN[initialShape].axis.slice();
  let spinSpeed = SHAPE_SPIN[initialShape].speed;
  let spinAngle = 0;
  let stateRotAngleX = 0, stateRotAngleY = 0, stateRotAngleZ = 0;
  let rafId = 0;
  let destroyed = false;
  let lastTime = performance.now();

  function setState(next) {
    if (next === state || destroyed) return;
    if (!STATES[next]) return;
    stx = {
      from: state,
      to: next,
      start: performance.now(),
      fromParams: lerpStateParams(current, current, 0),
      toParams: STATES[next],
    };
    state = next;
  }

  function transitionToShape(name) {
    if (name === currentShape || !SHAPE_GENERATORS[name]) return;
    currentShape = name;
    const newTargets = SHAPE_GENERATORS[name](particleCount);
    const startPositions = pts.map(p => [p.x, p.y, p.z]);
    const reassigned = greedyNearestAssign(startPositions, newTargets);
    const now = performance.now();
    for (let i = 0; i < particleCount; i++) {
      const delay = Math.random() * tuning.staggerMs;
      pts[i].transitStart = now + delay;
      pts[i].transitAbsorbed = false;
      pts[i].pendingTarget = reassigned[i];
    }
    lastShapeChange = now;
  }

  function setShape(name) { transitionToShape(name); }

  // ─── Pause RAF when off-screen or tab hidden ───
  let isVisible = true;
  let isOnScreen = true;
  function shouldRun() { return isVisible && isOnScreen && !destroyed; }
  function maybeStart() {
    if (shouldRun() && !rafId) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  }
  function maybeStop() {
    if (!shouldRun() && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }
  function onVisibility() {
    isVisible = document.visibilityState !== 'hidden';
    if (isVisible) maybeStart(); else maybeStop();
  }
  document.addEventListener('visibilitychange', onVisibility);

  let io = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver(entries => {
      for (const e of entries) isOnScreen = e.isIntersecting;
      if (isOnScreen) maybeStart(); else maybeStop();
    }, { threshold: 0.01 });
    io.observe(canvas);
  }

  function tick(now) {
    if (destroyed || !shouldRun()) { rafId = 0; return; }
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    // STATE TRANSITION
    let txForce = 0;
    if (stx) {
      const raw = Math.min(1, (now - stx.start) / DEFAULTS.stateTxMs);
      const eased = easeInOutCubic(raw);
      const from = stx.fromParams;
      current = lerpStateParams(from, stx.toParams, eased);
      txForce = bell(raw, 0.45, 0.25);
      if (raw >= 1) stx = null;
    } else {
      current = lerpStateParams(current, STATES[state], 0.02);
    }

    // Intrinsic shape rotation lerp
    const targetSpin = SHAPE_SPIN[currentShape];
    for (let i = 0; i < 3; i++) spinAxis[i] = spinAxis[i] + (targetSpin.axis[i] - spinAxis[i]) * 0.03;
    const aLen = Math.hypot(spinAxis[0], spinAxis[1], spinAxis[2]) || 1;
    spinAxis[0] /= aLen; spinAxis[1] /= aLen; spinAxis[2] /= aLen;
    spinSpeed = spinSpeed + (targetSpin.speed - spinSpeed) * 0.03;
    spinAngle += dt * spinSpeed * tuning.spin;

    if (!reducedMotion) {
      stateRotAngleX += dt * current.stateRotX;
      stateRotAngleY += dt * current.stateRotY;
      stateRotAngleZ += dt * current.stateRotZ;
    }

    // Auto shape-cycle: responding only. Idle and thinking freeze.
    if (!reducedMotion && state === 'responding' && (now - lastShapeChange) > STATES.responding.cycleMs) {
      const options = SHAPE_NAMES.filter(k => k !== currentShape);
      const nextName = options[(Math.random() * options.length) | 0];
      transitionToShape(nextName);
    }

    // Update particles
    const effDragTx = current.dragBase + (current.dragTx - current.dragBase) * tuning.overshoot;
    for (const p of pts) {
      // Adopt target at stagger delay — "launch"
      if (!p.transitAbsorbed && p.pendingTarget && now >= p.transitStart) {
        const dx = p.pendingTarget[0] - p.x;
        const dy = p.pendingTarget[1] - p.y;
        const dz = p.pendingTarget[2] - p.z;
        const dist = Math.hypot(dx, dy, dz);
        const dir = dist > 0 ? [dx/dist, dy/dist, dz/dist] : [1, 0, 0];
        const curl = curlAxisForPath(dir);
        p.curlAx = curl[0]; p.curlAy = curl[1]; p.curlAz = curl[2];
        const [tvx, tvy, tvz] = initialTangentVelocity(curl, dist, tuning.curve, p.curlSign);
        p.vx = tvx; p.vy = tvy; p.vz = tvz;
        p.tx = p.pendingTarget[0]; p.ty = p.pendingTarget[1]; p.tz = p.pendingTarget[2];
        p.transitAbsorbed = true;
        p.pendingTarget = null;
      }

      const inTransit = p.transitAbsorbed && (now - p.transitStart) < DEFAULTS.transitWindowMs && (now - p.transitStart) >= 0;
      const transitAge = inTransit ? (now - p.transitStart) : -1;

      let burstMul = 1;
      if (inTransit && transitAge < DEFAULTS.burstWindowMs) {
        const phase = transitAge / DEFAULTS.burstWindowMs;
        burstMul = 1 + (tuning.preBurst - 1) * bell(phase, 0.5, 0.3);
      }

      let k, d;
      if (inTransit) {
        const fade = Math.max(0, Math.min(1, transitAge / DEFAULTS.transitWindowMs));
        const blend = easeInOutCubic(fade);
        k = (current.springTx + (current.springBase - current.springTx) * blend) * burstMul * p.springJ;
        d = (effDragTx + (current.dragBase - effDragTx) * blend) * p.dragJ;
        if (d > 0.995) d = 0.995;
      } else {
        k = current.springBase * p.springJ;
        d = current.dragBase * p.dragJ;
        if (d > 0.995) d = 0.995;
      }

      // Breath-scaled target
      const breathAmp = reducedMotion ? current.breathAmp * 0.5 : current.breathAmp;
      const breath = breathScale(now, breathAmp, current.breathFreq);
      const bTx = p.tx * breath, bTy = p.ty * breath, bTz = p.tz * breath;

      p.vx += (bTx - p.x) * k;
      p.vy += (bTy - p.y) * k;
      p.vz += (bTz - p.z) * k;

      // Continuous curl during transit
      if (inTransit && tuning.continuous > 0) {
        const dx = p.tx - p.x, dy = p.ty - p.y, dz = p.tz - p.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 4) {
          const dir = [dx/dist, dy/dist, dz/dist];
          const cc = [
            dir[1]*p.curlAz - dir[2]*p.curlAy,
            dir[2]*p.curlAx - dir[0]*p.curlAz,
            dir[0]*p.curlAy - dir[1]*p.curlAx,
          ];
          const ccLen = Math.hypot(cc[0], cc[1], cc[2]) || 1;
          const fade = 1 - easeInOutCubic(Math.min(1, transitAge / DEFAULTS.transitWindowMs));
          const strength = tuning.continuous * dist * p.curlSign * fade;
          p.vx += (cc[0] / ccLen) * strength;
          p.vy += (cc[1] / ccLen) * strength;
          p.vz += (cc[2] / ccLen) * strength;
        }
      }

      // Flow (responding horizontal drift)
      p.vx += current.flow * Math.sin(now / 900) * 1.4 * 0.1;

      // State-transition gesture force
      if (stx && txForce > 0.001) {
        if (stx.to === 'thinking') {
          const len = Math.hypot(p.x, p.y, p.z) || 1; const g = 0.3 * txForce;
          p.vx += (p.x/len)*g; p.vy += (p.y/len)*g; p.vz += (p.z/len)*g;
        } else if (stx.to === 'responding') {
          p.vx += 0.4 * txForce;
          p.vy -= p.y * 0.005 * txForce;
          p.vz -= p.z * 0.005 * txForce;
        } else if (stx.to === 'idle') {
          p.vx -= p.x * 0.003 * txForce;
          p.vy -= p.y * 0.003 * txForce;
          p.vz -= p.z * 0.003 * txForce;
        }
      }

      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx; p.y += p.vy; p.z += p.vz;

      // Apply intrinsic shape + state rotations to produce rendered position
      let v = rotateAxis([p.x, p.y, p.z], spinAxis, spinAngle);
      v = rotateX(v, stateRotAngleX);
      v = rotateY(v, stateRotAngleY);
      v = rotateZ(v, stateRotAngleZ);
      p.rx = v[0]; p.ry = v[1]; p.rz = v[2];

      // Record trail at rendered position
      p.trail[p.trailIdx] = [p.rx, p.ry, p.rz];
      p.trailIdx = (p.trailIdx + 1) % trailLen;
    }

    updatePoints(renderCtx, pts, current);
    updateLinks(renderCtx, pts, current);
    if (reducedMotion) renderCtx.trailGeom.setDrawRange(0, 0);
    else updateTrails(renderCtx, pts, current);
    drawFrame(renderCtx);

    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  return {
    setState,
    setShape,
    getState: () => state,
    getShape: () => currentShape,
    destroy() {
      destroyed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (io) io.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      renderCtx.dispose();
    },
  };
}
