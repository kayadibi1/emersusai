import React, { useEffect, useRef } from "https://esm.sh/react@18.2.0";

/**
 * EmersusRubiksCube — cyberpunk Rubik's cube thinking indicator.
 *
 * Self-contained ES module: imports React from esm.sh, renders to a single
 * canvas, runs its own rAF loop. Drop into a chat-rail or message stream as a
 * "model is working" placeholder.
 *
 * Props:
 *   - state: 'idle' | 'thinking' | 'complete' (default 'thinking')
 *   - size: pixel size of the square canvas (default 96)
 *   - color: brand hex used for ambient halo + edge accents (default lime)
 */

const h = React.createElement;

// ── 3D primitives ──────────────────────────────────────────────────────────

const FACE_VERTS = [
  // +X right
  [[0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]],
  // -X left
  [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5]],
  // +Y top
  [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
  // -Y bottom
  [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]],
  // +Z front
  [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
  // -Z back
  [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]],
];

// Sticker quads — slightly inset on the perpendicular axes and slightly
// popped out on the face's own axis so each colored sticker sits visibly
// above the dark cubelet body.
const STICKER_VERTS = [
  [[0.54, -0.4, -0.4], [0.54, -0.4, 0.4], [0.54, 0.4, 0.4], [0.54, 0.4, -0.4]],
  [[-0.54, -0.4, 0.4], [-0.54, -0.4, -0.4], [-0.54, 0.4, -0.4], [-0.54, 0.4, 0.4]],
  [[-0.4, 0.54, -0.4], [0.4, 0.54, -0.4], [0.4, 0.54, 0.4], [-0.4, 0.54, 0.4]],
  [[-0.4, -0.54, 0.4], [0.4, -0.54, 0.4], [0.4, -0.54, -0.4], [-0.4, -0.54, -0.4]],
  [[-0.4, -0.4, 0.54], [0.4, -0.4, 0.54], [0.4, 0.4, 0.54], [-0.4, 0.4, 0.54]],
  [[0.4, -0.4, -0.54], [-0.4, -0.4, -0.54], [-0.4, 0.4, -0.54], [0.4, 0.4, -0.54]],
];

const FACE_NORMALS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// Cyberpunk neon palette — one [r,g,b] per face direction.
const PALETTE = [
  [255, 42, 109], // +X — hot pink
  [5, 217, 232],  // -X — cyan
  [255, 214, 10], // +Y — electric yellow
  [249, 0, 191],  // -Y — magenta
  [0, 255, 159],  // +Z — neon green
  [176, 38, 255], // -Z — violet
];

function matVec(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function matMul(a, b) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[i][k] * b[k][j];
      out[i][j] = s;
    }
  }
  return out;
}

const identity = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function rotXMat(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}
function rotYMat(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}
function rotZMat(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

// Frame-rate independent decay toward a target.
const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

// Deterministic PRNG for stable scramble sequences.
function seedRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hexToRgb(hex) {
  let h2 = String(hex || "").replace("#", "");
  if (h2.length === 3) h2 = h2.split("").map((c) => c + c).join("");
  const r = parseInt(h2.slice(0, 2), 16);
  const g = parseInt(h2.slice(2, 4), 16);
  const b = parseInt(h2.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [159, 251, 0];
  return [r, g, b];
}

// ── React component ────────────────────────────────────────────────────────

export default function EmersusRubiksCube({
  state = "thinking",
  size = 96,
  color = "#9ffb00",
  className,
  ariaLabel,
}) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  const colorRef = useRef(color);
  const burstStartRef = useRef(null);
  const lastStateRef = useRef(state);

  // Keep the rAF loop reading the latest props without re-init.
  useEffect(() => {
    stateRef.current = state;
    if (state === "complete" && lastStateRef.current !== "complete") {
      burstStartRef.current = performance.now();
    }
    lastStateRef.current = state;
  }, [state]);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = size / 2;
    const cy = size / 2;
    const cubeScale = size * 0.16;

    const rand = seedRandom(0xc0ffee);

    // 27 cubelets — solved configuration.
    const cubelets = [];
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          cubelets.push({
            pos: [x, y, z],
            ori: identity(),
            faceColors: [
              x === 1 ? PALETTE[0] : null,
              x === -1 ? PALETTE[1] : null,
              y === 1 ? PALETTE[2] : null,
              y === -1 ? PALETTE[3] : null,
              z === 1 ? PALETTE[4] : null,
              z === -1 ? PALETTE[5] : null,
            ],
          });
        }
      }
    }

    const resetCube = () => {
      let i = 0;
      for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
          for (let z = -1; z <= 1; z++) {
            const c = cubelets[i++];
            c.pos = [x, y, z];
            c.ori = identity();
          }
        }
      }
    };

    // Smoothed activations per state, plus burst envelope on entering complete.
    const anim = {
      idle: stateRef.current === "idle" ? 1 : 0,
      thinking: stateRef.current === "thinking" ? 1 : 0,
      complete: stateRef.current === "complete" ? 1 : 0,
      burst: 0,
      intensity: stateRef.current === "idle" ? 0 : 1,
    };

    // Twist state machine.
    let twistAxis = 0;
    let twistLayer = 1;
    let twistAngle = 0;
    let twistTarget = 0;
    let twistActive = false;
    let twistDelay = 0;
    let didCompleteReset = false;

    let yawAngle = 0.6;
    const basePitch = -0.5;

    const startTwist = () => {
      twistAxis = Math.floor(rand() * 3);
      twistLayer = rand() < 0.5 ? -1 : 1;
      const dir = rand() < 0.5 ? -1 : 1;
      twistAngle = 0;
      twistTarget = (Math.PI / 2) * dir;
      twistActive = true;
    };

    const commitTwist = () => {
      let rotM;
      if (twistAxis === 0) rotM = rotXMat(twistTarget);
      else if (twistAxis === 1) rotM = rotYMat(twistTarget);
      else rotM = rotZMat(twistTarget);
      for (const c of cubelets) {
        if (Math.round(c.pos[twistAxis]) !== twistLayer) continue;
        const np = matVec(rotM, c.pos);
        c.pos = [Math.round(np[0]), Math.round(np[1]), Math.round(np[2])];
        c.ori = matMul(rotM, c.ori);
      }
      twistActive = false;
      twistAngle = 0;
      twistTarget = 0;
    };

    const BURST_DURATION = 0.5;
    let raf = 0;
    let stopped = false;
    let last = performance.now();
    let t = 0;

    const tick = (now) => {
      if (stopped) return;
      const dt = Math.min(0.064, (now - last) / 1000);
      last = now;
      t += dt;

      // Lerp activations toward state targets.
      const cur = stateRef.current;
      const target = {
        idle: cur === "idle" ? 1 : 0,
        thinking: cur === "thinking" ? 1 : 0,
        complete: cur === "complete" ? 1 : 0,
      };
      anim.idle = damp(anim.idle, target.idle, 6, dt);
      anim.thinking = damp(anim.thinking, target.thinking, 6, dt);
      anim.complete = damp(anim.complete, target.complete, 6, dt);
      anim.intensity = Math.max(anim.thinking, anim.complete * 0.6);

      // Burst envelope on entering complete.
      if (burstStartRef.current !== null) {
        const age = (now - burstStartRef.current) / 1000;
        if (age >= BURST_DURATION) {
          anim.burst = 0;
          burstStartRef.current = null;
        } else {
          anim.burst = Math.sin((age / BURST_DURATION) * Math.PI);
        }
      } else {
        anim.burst = 0;
      }

      // On entering complete, snap-reset the cube once.
      if (anim.complete > 0.6 && !didCompleteReset) {
        resetCube();
        twistActive = false;
        twistAngle = 0;
        twistTarget = 0;
        twistDelay = 0;
        didCompleteReset = true;
      }
      if (anim.complete < 0.3) didCompleteReset = false;

      // Slow camera drift — keeps the cube alive even in idle.
      yawAngle += dt * (0.22 + anim.intensity * 0.18);
      const pitchAngle = basePitch + Math.sin(t * 0.45) * 0.07;

      // Twist scheduling — only while thinking.
      const twistMode = anim.thinking > 0.55 && anim.complete < 0.4;
      if (twistActive) {
        const speed = (Math.PI / 2) / 0.32 * (0.6 + anim.intensity * 0.6);
        const dir = twistTarget > 0 ? 1 : -1;
        twistAngle += dir * speed * dt;
        if ((dir > 0 && twistAngle >= twistTarget) || (dir < 0 && twistAngle <= twistTarget)) {
          twistAngle = twistTarget;
          commitTwist();
          twistDelay = 0.05;
        }
      } else if (twistDelay > 0) {
        twistDelay -= dt;
      } else if (twistMode) {
        startTwist();
      }

      // Camera matrix.
      const globalRot = matMul(rotXMat(pitchAngle), rotYMat(yawAngle));

      // Twist matrix at the current animated angle.
      let twistM = null;
      if (twistActive) {
        if (twistAxis === 0) twistM = rotXMat(twistAngle);
        else if (twistAxis === 1) twistM = rotYMat(twistAngle);
        else twistM = rotZMat(twistAngle);
      }

      // Color set for ambient halo.
      const [br, bg, bb] = hexToRgb(colorRef.current || "#9ffb00");
      const halo = (a) => `rgba(${br},${bg},${bb},${a})`;

      const transformVert = (v, c, inLayer) => {
        let r = matVec(c.ori, v);
        r = [r[0] + c.pos[0], r[1] + c.pos[1], r[2] + c.pos[2]];
        if (inLayer && twistM) r = matVec(twistM, r);
        r = matVec(globalRot, r);
        return r;
      };
      const transformNormal = (n, c, inLayer) => {
        let r = matVec(c.ori, n);
        if (inLayer && twistM) r = matVec(twistM, r);
        r = matVec(globalRot, r);
        return r;
      };

      // Build the draw list (body + sticker per visible cubelet face).
      const faces = [];
      const BODY = [14, 10, 30];

      for (const c of cubelets) {
        const inLayer = twistActive && Math.round(c.pos[twistAxis]) === twistLayer;
        for (let f = 0; f < 6; f++) {
          const bv = FACE_VERTS[f];
          const wv0 = transformVert(bv[0], c, inLayer);
          const wv1 = transformVert(bv[1], c, inLayer);
          const wv2 = transformVert(bv[2], c, inLayer);
          const wv3 = transformVert(bv[3], c, inLayer);
          const normal = transformNormal(FACE_NORMALS[f], c, inLayer);
          if (normal[2] < -0.02) continue;

          const proj = (v) => [cx + v[0] * cubeScale, cy - v[1] * cubeScale];
          const projBody = [proj(wv0), proj(wv1), proj(wv2), proj(wv3)];
          const avgZBody = (wv0[2] + wv1[2] + wv2[2] + wv3[2]) * 0.25;
          faces.push({
            verts2D: projBody,
            avgZ: avgZBody,
            rgb: BODY,
            normalZ: normal[2],
            kind: "body",
          });

          const sc = c.faceColors[f];
          if (!sc) continue;
          const sv = STICKER_VERTS[f];
          const sw0 = transformVert(sv[0], c, inLayer);
          const sw1 = transformVert(sv[1], c, inLayer);
          const sw2 = transformVert(sv[2], c, inLayer);
          const sw3 = transformVert(sv[3], c, inLayer);
          faces.push({
            verts2D: [proj(sw0), proj(sw1), proj(sw2), proj(sw3)],
            avgZ: (sw0[2] + sw1[2] + sw2[2] + sw3[2]) * 0.25 + 0.001,
            rgb: sc,
            normalZ: normal[2],
            kind: "sticker",
          });
        }
      }

      faces.sort((a, b) => a.avgZ - b.avgZ);

      // ── DRAW ──
      ctx.clearRect(0, 0, size, size);

      // Cyberpunk ambient halo.
      const breathe = 0.5 + 0.5 * Math.sin(t * 1.4);
      const ambient =
        0.12 + anim.intensity * 0.18 + anim.idle * breathe * 0.08 + anim.burst * 0.4;
      const haloGrad = ctx.createRadialGradient(cx, cy, size * 0.04, cx, cy, size * 0.55);
      haloGrad.addColorStop(0, halo(ambient));
      haloGrad.addColorStop(0.55, halo(ambient * 0.35));
      haloGrad.addColorStop(1, halo(0));
      ctx.fillStyle = haloGrad;
      ctx.fillRect(0, 0, size, size);

      // Faint horizon line.
      ctx.strokeStyle = halo(0.08);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(size * 0.08, cy + size * 0.32);
      ctx.lineTo(size * 0.92, cy + size * 0.32);
      ctx.stroke();

      const dim =
        0.55 + anim.intensity * 0.35 + anim.idle * breathe * 0.12 + anim.burst * 0.4;

      for (const face of faces) {
        const { verts2D, rgb, normalZ, kind } = face;
        ctx.beginPath();
        ctx.moveTo(verts2D[0][0], verts2D[0][1]);
        for (let i = 1; i < verts2D.length; i++) {
          ctx.lineTo(verts2D[i][0], verts2D[i][1]);
        }
        ctx.closePath();

        if (kind === "body") {
          const b = 0.45 + Math.max(0, normalZ) * 0.45;
          ctx.fillStyle = `rgba(${Math.round(rgb[0] * b)},${Math.round(rgb[1] * b)},${Math.round(rgb[2] * b)},0.96)`;
          ctx.fill();
          ctx.strokeStyle = halo(0.45 + 0.3 * Math.max(0, normalZ));
          ctx.lineWidth = 0.85;
          ctx.lineJoin = "round";
          ctx.stroke();
        } else {
          const facing = 0.55 + Math.max(0, normalZ) * 0.45;
          const k = facing * dim;
          ctx.fillStyle = `rgba(${Math.round(rgb[0] * k)},${Math.round(rgb[1] * k)},${Math.round(rgb[2] * k)},0.94)`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.88 * dim})`;
          ctx.lineWidth = 1.1;
          ctx.lineJoin = "round";
          ctx.stroke();
          ctx.strokeStyle = `rgba(255,255,255,${0.18 * dim})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }

      // Burst flash on entering complete.
      if (anim.burst > 0.05) {
        const ringR = size * (0.34 + (1 - anim.burst) * 0.22);
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = halo(0.85 * anim.burst);
        ctx.lineWidth = 2.2 * anim.burst;
        ctx.stroke();

        const burstGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.6);
        burstGlow.addColorStop(0, `rgba(255,255,255,${0.28 * anim.burst})`);
        burstGlow.addColorStop(0.4, halo(0.32 * anim.burst));
        burstGlow.addColorStop(1, halo(0));
        ctx.fillStyle = burstGlow;
        ctx.fillRect(0, 0, size, size);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [size]);

  return h("canvas", {
    ref: canvasRef,
    role: "status",
    "aria-live": "polite",
    "aria-label": ariaLabel || "Emersus is thinking",
    className,
    style: { display: "block", width: size, height: size, background: "transparent" },
  });
}
