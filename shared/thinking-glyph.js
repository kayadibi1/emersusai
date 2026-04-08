/**
 * Emersus Thinking Glyph
 * ----------------------------------------------------------
 * A canvas-rendered, continuously morphing abstract glyph used as
 * a streaming chat loading indicator. Vanilla ES module — no React.
 *
 * Usage:
 *   import { createThinkingGlyph } from "/shared/thinking-glyph.js";
 *   const glyph = createThinkingGlyph(canvasEl, { size: 64, color: "#534AB7" });
 *   glyph.setState("thinking");   // 'idle' | 'thinking' | 'responding'
 *   glyph.destroy();              // cancels RAF, releases listeners
 *
 * The glyph cycles through 7 recognizable shapes:
 *   ekg → transistor → circuit → brain → heart → neuron → E → (loop)
 *
 * State transitions are smoothed by lerping all parameters toward their
 * targets — never snaps.
 */

// ---------------------------------------------------------------------------
// Shape generators
// ---------------------------------------------------------------------------
const N_POINTS = 48;
const NEON_GREEN = { r: 57, g: 255, b: 20 }; // #39FF14

function normalizeShape(pts, target = 0.88) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const halfW = (maxX - minX) / 2;
  const halfH = (maxY - minY) / 2;
  const scale = target / Math.max(halfW, halfH);
  return pts.map((p) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale }));
}

function ekgShape() {
  const pts = [];
  const topN = 32;
  const botN = N_POINTS - topN;
  for (let i = 0; i < topN; i++) {
    let u = i / (topN - 1);
    const d = u - 0.5;
    u = 0.5 + Math.sign(d) * Math.pow(Math.abs(d * 2), 1.7) * 0.5;
    const x = -0.95 + u * 1.9;
    const base = 0.12;
    const y =
      base
      - 0.10 * Math.exp(-Math.pow((u - 0.24) * 10, 2))
      + 0.05 * Math.exp(-Math.pow((u - 0.44) * 30, 2))
      - 0.92 * Math.exp(-Math.pow((u - 0.50) * 32, 2))
      + 0.32 * Math.exp(-Math.pow((u - 0.56) * 30, 2))
      - 0.18 * Math.exp(-Math.pow((u - 0.76) * 9, 2));
    pts.push({ x, y });
  }
  for (let i = 0; i < botN; i++) {
    const u = i / (botN - 1);
    pts.push({ x: 0.95 - u * 1.9, y: 0.55 });
  }
  return pts;
}

function transistorShape() {
  const pts = [];
  const domeN = 28;
  const legsN = N_POINTS - domeN;
  for (let i = 0; i < domeN; i++) {
    const t = i / (domeN - 1);
    pts.push({
      x: 0.6 * Math.cos(Math.PI * t),
      y: -0.55 * Math.sin(Math.PI * t),
    });
  }
  for (let i = 0; i < legsN; i++) {
    const t = (i + 1) / (legsN + 1);
    const x = -0.6 + t * 1.2;
    let y = 0;
    for (const legX of [-0.35, 0, 0.35]) {
      y += 0.78 * Math.exp(-Math.pow((x - legX) * 13, 2));
    }
    pts.push({ x, y });
  }
  return pts;
}

function circuitShape() {
  const pts = [];
  const w = 0.65;
  const h = 0.45;
  for (let i = 0; i < N_POINTS; i++) {
    const t = i / N_POINTS;
    let x, y;
    if (t < 0.25) {
      const u = t / 0.25;
      x = w + 0.16 * Math.max(0, Math.sin(u * Math.PI * 3));
      y = -h + 2 * h * u;
    } else if (t < 0.5) {
      const u = (t - 0.25) / 0.25;
      x = w - 2 * w * u;
      y = h;
    } else if (t < 0.75) {
      const u = (t - 0.5) / 0.25;
      x = -w - 0.16 * Math.max(0, Math.sin(u * Math.PI * 3));
      y = h - 2 * h * u;
    } else {
      const u = (t - 0.75) / 0.25;
      x = -w + 2 * w * u;
      y = -h;
    }
    pts.push({ x, y });
  }
  return pts;
}

function brainShape() {
  const pts = [];
  for (let i = 0; i < N_POINTS; i++) {
    const t = (i / N_POINTS) * Math.PI * 2;
    let r = 0.62;
    r += 0.045 * Math.cos(10 * t + 0.3);
    r += 0.030 * Math.cos(16 * t + 1.1);
    r += 0.025 * Math.cos(6 * t);
    r -= 0.18 * Math.pow(Math.max(0, -Math.sin(t)), 8);
    r -= 0.05 * Math.pow(Math.max(0, Math.sin(t)), 6);
    pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) * 0.85 });
  }
  return pts;
}

function heartShape() {
  const pts = [];
  for (let i = 0; i < N_POINTS; i++) {
    const t = (i / N_POINTS) * Math.PI * 2 + Math.PI / 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push({ x, y });
  }
  return pts;
}

function resampleClosedPolygon(verts, n) {
  const m = verts.length;
  const cum = [0];
  for (let i = 0; i < m; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % m];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[m];
  const out = [];
  for (let i = 0; i < n; i++) {
    const target = (i / n) * total;
    let edge = 0;
    while (edge < m - 1 && cum[edge + 1] < target) edge++;
    const segLen = cum[edge + 1] - cum[edge];
    const t = segLen > 0 ? (target - cum[edge]) / segLen : 0;
    const a = verts[edge];
    const b = verts[(edge + 1) % m];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function neuronShape() {
  const pts = [];
  const dendrites = [
    { angle: 0.2, length: 0.42, width: 0.24 },
    { angle: 1.0, length: 0.50, width: 0.21 },
    { angle: 1.9, length: 0.40, width: 0.27 },
    { angle: 2.8, length: 0.55, width: 0.20 },
    { angle: 3.9, length: 0.40, width: 0.25 },
    { angle: 5.2, length: 0.68, width: 0.18 },
  ];
  for (let i = 0; i < N_POINTS; i++) {
    const t = (i / N_POINTS) * Math.PI * 2;
    let r = 0.32;
    for (const d of dendrites) {
      let dist = Math.abs(t - d.angle);
      if (dist > Math.PI) dist = 2 * Math.PI - dist;
      r += d.length * Math.exp(-Math.pow(dist / d.width, 2));
    }
    pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return pts;
}

function letterEShape() {
  const verts = [
    { x: -0.70, y: -0.90 },
    { x:  0.70, y: -0.90 },
    { x:  0.70, y: -0.55 },
    { x: -0.38, y: -0.55 },
    { x: -0.38, y: -0.18 },
    { x:  0.45, y: -0.18 },
    { x:  0.45, y:  0.18 },
    { x: -0.38, y:  0.18 },
    { x: -0.38, y:  0.55 },
    { x:  0.70, y:  0.55 },
    { x:  0.70, y:  0.90 },
    { x: -0.70, y:  0.90 },
  ];
  return resampleClosedPolygon(verts, N_POINTS);
}

const KEYFRAMES = [
  normalizeShape(ekgShape()),
  normalizeShape(transistorShape()),
  normalizeShape(circuitShape()),
  normalizeShape(brainShape()),
  normalizeShape(heartShape()),
  normalizeShape(neuronShape()),
  normalizeShape(letterEShape()),
];

// ---------------------------------------------------------------------------
// Idle "weak heartbeat" EKG — procedurally animated each frame so the line
// physically spikes up with the beat instead of cycling pre-baked keyframes.
// ---------------------------------------------------------------------------
function idleEkgShapeRaw(beatT) {
  // Period = 1s (~60 BPM). Sharp lub at 0.10s, softer dub at 0.26s.
  const lub = Math.exp(-Math.pow((beatT - 0.10) * 14, 2));
  const dub = 0.55 * Math.exp(-Math.pow((beatT - 0.26) * 16, 2));

  const pts = [];
  const topN = 32;
  const botN = N_POINTS - topN;
  const spikePos = 0.50;

  for (let i = 0; i < topN; i++) {
    let u = i / (topN - 1);
    // Cluster points near the center so the spike has resolution
    const d0 = u - 0.5;
    u = 0.5 + Math.sign(d0) * Math.pow(Math.abs(d0 * 2), 1.6) * 0.5;
    const x = -0.95 + u * 1.9;
    const dx = u - spikePos;

    let y = 0.12;
    // P (small bump before)
    y -= 0.10 * lub * Math.exp(-Math.pow((dx + 0.10) * 18, 2));
    // Q (small dip)
    y += 0.06 * lub * Math.exp(-Math.pow((dx + 0.03) * 35, 2));
    // R (big spike up)
    y -= 0.95 * lub * Math.exp(-Math.pow(dx * 32, 2));
    // S (small dip after)
    y += 0.32 * lub * Math.exp(-Math.pow((dx - 0.04) * 30, 2));
    // T (dub bump)
    y -= 0.30 * dub * Math.exp(-Math.pow((dx - 0.20) * 10, 2));

    pts.push({ x, y });
  }

  for (let i = 0; i < botN; i++) {
    const u = i / (botN - 1);
    pts.push({ x: 0.95 - u * 1.9, y: 0.55 });
  }

  return pts;
}

// Precompute normalization against the peak-spike frame so the geometry
// stays at a constant overall scale; only the spike itself moves.
const IDLE_EKG_NORM = (() => {
  const maxShape = idleEkgShapeRaw(0.10);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of maxShape) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const halfW = (maxX - minX) / 2;
  const halfH = (maxY - minY) / 2;
  return { cx, cy, scale: 0.88 / Math.max(halfW, halfH) };
})();

function idleEkgShapeAt(beatT) {
  const raw = idleEkgShapeRaw(beatT);
  const { cx, cy, scale } = IDLE_EKG_NORM;
  return raw.map((p) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function rgba({ r, g, b }, alpha) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getTargets(state) {
  if (state === "thinking") {
    return {
      morphDuration: 550,
      chromaticOffset: 3.0,
      jitterAmplitude: 2.5,
      glowIntensity: 1.0,
      scanlineOpacity: 0.08,
      glitchRate: 3.0,
      drawOn: 0,
      thinkingness: 1,
      shimmerSpeed: 1.0,
      idleness: 0,
    };
  }
  if (state === "responding") {
    return {
      morphDuration: 1400,
      chromaticOffset: 2.0,
      jitterAmplitude: 0,
      glowIntensity: 0.85,
      scanlineOpacity: 0.05,
      glitchRate: 0,
      drawOn: 1,
      thinkingness: 0,
      shimmerSpeed: 0.6,
      idleness: 0,
    };
  }
  return {
    morphDuration: 2800,
    chromaticOffset: 0,
    jitterAmplitude: 0,
    glowIntensity: 0,
    scanlineOpacity: 0,
    glitchRate: 0,
    drawOn: 0,
    thinkingness: 0,
    shimmerSpeed: 0,
    idleness: 1,
  };
}

// ---------------------------------------------------------------------------
// createThinkingGlyph
// ---------------------------------------------------------------------------
export function createThinkingGlyph(canvas, options = {}) {
  if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error("createThinkingGlyph: first argument must be a <canvas> element");
  }

  const size = Number(options.size) || 64;
  const color = options.color || "#534AB7";
  const initialState = options.state || "idle";

  const ctx = canvas.getContext("2d");
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  if (!canvas.style.background) canvas.style.background = "transparent";
  if (!canvas.hasAttribute("aria-hidden")) canvas.setAttribute("aria-hidden", "true");

  const primary = hexToRgb(color);
  const cyan = hexToRgb("#00F0FF");
  const magenta = hexToRgb("#FF2D7C");

  let currentState = initialState;
  const params = { ...getTargets(currentState) };
  const morph = { from: 0, to: 1, progress: 0 };
  const jitter = Array.from({ length: N_POINTS }, () => ({ x: 0, y: 0 }));
  const jitterTarget = Array.from({ length: N_POINTS }, () => ({ x: 0, y: 0 }));
  let activeGlitches = [];
  let frame = 0;
  let lastTime = performance.now();
  const startTime = lastTime;
  let shimmerPhase = 0;
  let rafId = 0;
  let destroyed = false;

  function drawShape(shape, opts) {
    const {
      strokeStyle,
      strokeWidth,
      fillStyle,
      offsetX = 0,
      offsetY = 0,
      scale = 1,
      dashPattern = null,
      dashOffset = 0,
    } = opts;

    const cx = size / 2 + offsetX;
    const cy = size / 2 + offsetY;
    const r = size * 0.36 * scale;

    const pts = shape.map((p, i) => ({
      x: cx + p.x * r + jitter[i].x,
      y: cy + p.y * r + jitter[i].y,
    }));

    const n = pts.length;
    const get = (i) => pts[(i + n) % n];

    ctx.beginPath();
    const start = get(0);
    ctx.moveTo(start.x, start.y);
    for (let i = 0; i < n; i++) {
      const p0 = get(i - 1);
      const p1 = get(i);
      const p2 = get(i + 1);
      const p3 = get(i + 2);
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
    }
    ctx.closePath();

    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = strokeWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (dashPattern) {
        ctx.setLineDash(dashPattern);
        ctx.lineDashOffset = dashOffset;
      } else {
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
      ctx.stroke();
    }
  }

  function tick(now) {
    if (destroyed) return;
    const dt = Math.min(64, now - lastTime);
    lastTime = now;
    frame++;

    const target = getTargets(currentState);
    const lerpFactor = 1 - Math.exp(-dt / 160);
    for (const key of Object.keys(target)) {
      params[key] = lerp(params[key], target[key], lerpFactor);
    }

    if (frame % 8 === 0) {
      for (let i = 0; i < N_POINTS; i++) {
        jitterTarget[i].x = (Math.random() * 2 - 1) * params.jitterAmplitude;
        jitterTarget[i].y = (Math.random() * 2 - 1) * params.jitterAmplitude;
      }
    }
    for (let i = 0; i < N_POINTS; i++) {
      jitter[i].x = lerp(jitter[i].x, jitterTarget[i].x, 0.15);
      jitter[i].y = lerp(jitter[i].y, jitterTarget[i].y, 0.15);
    }

    if (params.idleness < 0.99) {
      morph.progress += dt / params.morphDuration;
      while (morph.progress >= 1) {
        morph.progress -= 1;
        morph.from = morph.to;
        morph.to = (morph.to + 1) % KEYFRAMES.length;
      }
    }
    const t = easeInOutCubic(morph.progress);
    const fromShape = KEYFRAMES[morph.from];
    const toShape = KEYFRAMES[morph.to];
    const beatT = ((now - startTime) / 1000) % 1;
    const idleShape = idleEkgShapeAt(beatT);
    const shape = fromShape.map((p, i) => {
      const morphX = lerp(p.x, toShape[i].x, t);
      const morphY = lerp(p.y, toShape[i].y, t);
      return {
        x: lerp(morphX, idleShape[i].x, params.idleness),
        y: lerp(morphY, idleShape[i].y, params.idleness),
      };
    });

    if (params.glitchRate > 0.05) {
      let prob = params.glitchRate * (dt / 1000);
      while (prob > 0) {
        if (Math.random() < Math.min(prob, 1)) {
          activeGlitches.push({
            y: Math.random() * size,
            height: 4 + Math.random() * 4,
            shift: (Math.random() * 2 - 1) * (3 + Math.random() * 3),
            life: 2,
          });
        }
        prob -= 1;
      }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.save();
    ctx.scale(dpr, dpr);

    const oscill = Math.sin(now / 75) * 0.5 * params.thinkingness;
    const chromX = params.chromaticOffset + oscill;
    const chromY = params.chromaticOffset * 0.66 + oscill * 0.66;

    const pulse = 0.55 + 0.45 * Math.sin(morph.progress * Math.PI * 2);
    const glow = params.glowIntensity * lerp(1, pulse, params.thinkingness);
    const activeness = 1 - params.idleness;

    drawShape(shape, {
      strokeStyle: rgba(primary, 0.05 * glow * activeness),
      strokeWidth: Math.max(6, size * 0.14),
      scale: 1.5,
    });
    drawShape(shape, {
      strokeStyle: rgba(primary, 0.08 * glow * activeness),
      strokeWidth: Math.max(4, size * 0.09),
      scale: 1.32,
    });

    drawShape(shape, {
      strokeStyle: rgba(cyan, 0.30 * activeness),
      strokeWidth: Math.max(1.25, size * 0.025),
      offsetX: -chromX,
      offsetY: -chromY,
    });

    drawShape(shape, {
      strokeStyle: rgba(magenta, 0.25 * activeness),
      strokeWidth: Math.max(1.25, size * 0.025),
      offsetX: chromX,
      offsetY: chromY,
    });

    drawShape(shape, {
      fillStyle: rgba(primary, 0.12 * activeness),
      strokeStyle: rgba(primary, 0.9 * (1 - params.drawOn) * activeness),
      strokeWidth: Math.max(1.5, size * 0.028),
    });

    if (params.idleness > 0.01) {
      // Heartbeat: ~60 BPM, sharp lub at 0.10s with a softer dub trailing it.
      const lub = Math.exp(-Math.pow((beatT - 0.10) * 16, 2));
      const dub = 0.55 * Math.exp(-Math.pow((beatT - 0.26) * 18, 2));
      const heartbeat = Math.min(1, lub + dub);
      const baseAlpha = 0.32;
      const peakAlpha = 0.80;
      const alpha = (baseAlpha + (peakAlpha - baseAlpha) * heartbeat) * params.idleness;
      // Faint outer glow that pulses with the beat
      drawShape(shape, {
        strokeStyle: rgba(primary, 0.20 * heartbeat * params.idleness),
        strokeWidth: Math.max(3, size * 0.07),
        scale: 1.15,
      });
      // Main faint EKG trace
      drawShape(shape, {
        strokeStyle: rgba(primary, alpha),
        strokeWidth: Math.max(1.25, size * 0.022),
      });
    }

    if (params.drawOn > 0.01) {
      const perimeter = size * 2.6;
      const dashLen = perimeter * 0.42;
      const gapLen = perimeter * 0.58;
      const sweepOffset = -((now / 18) % (dashLen + gapLen));
      drawShape(shape, {
        strokeStyle: rgba(primary, 0.9 * params.drawOn),
        strokeWidth: Math.max(1.5, size * 0.028),
        dashPattern: [dashLen, gapLen],
        dashOffset: sweepOffset,
      });
    }

    shimmerPhase += (dt / 1200) * params.shimmerSpeed;
    shimmerPhase = shimmerPhase % 1;
    if (activeness > 0.01) {
      const bandWidth = 0.18;
      const range = 1 + bandWidth * 2;
      const pos = -bandWidth + shimmerPhase * range;
      const stop0 = Math.max(0, Math.min(1, pos - bandWidth));
      const stop1 = Math.max(0, Math.min(1, pos));
      const stop2 = Math.max(0, Math.min(1, pos + bandWidth));

      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(stop0, rgba(NEON_GREEN, 0));
      grad.addColorStop(stop1, rgba(NEON_GREEN, 0.95 * activeness));
      grad.addColorStop(stop2, rgba(NEON_GREEN, 0));

      const gradBloom = ctx.createLinearGradient(0, 0, size, size);
      gradBloom.addColorStop(stop0, rgba(NEON_GREEN, 0));
      gradBloom.addColorStop(stop1, rgba(NEON_GREEN, 0.35 * activeness));
      gradBloom.addColorStop(stop2, rgba(NEON_GREEN, 0));

      const prevComp = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = "lighter";
      drawShape(shape, {
        strokeStyle: gradBloom,
        strokeWidth: Math.max(4, size * 0.085),
      });
      drawShape(shape, {
        strokeStyle: grad,
        strokeWidth: Math.max(1.75, size * 0.034),
      });
      ctx.globalCompositeOperation = prevComp;
    }

    ctx.restore();

    if (activeGlitches.length > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const g of activeGlitches) {
        const sliceY = Math.max(0, Math.floor(g.y * dpr));
        const sliceH = Math.min(
          canvas.height - sliceY,
          Math.max(1, Math.ceil(g.height * dpr))
        );
        if (sliceH <= 0) continue;
        try {
          const data = ctx.getImageData(0, sliceY, canvas.width, sliceH);
          ctx.clearRect(0, sliceY, canvas.width, sliceH);
          ctx.putImageData(data, Math.round(g.shift * dpr), sliceY);
        } catch {
          /* noop */
        }
      }
      ctx.restore();
      activeGlitches = activeGlitches
        .map((g) => ({ ...g, life: g.life - 1 }))
        .filter((g) => g.life > 0);
    }

    if (params.scanlineOpacity > 0.001) {
      ctx.save();
      ctx.scale(dpr, dpr);
      const scanT = ((now - startTime) / 3000) % 1;
      const lines = 3;
      for (let i = 0; i < lines; i++) {
        const y = ((scanT + i / lines) % 1) * size;
        ctx.fillStyle = `rgba(0, 0, 0, ${params.scanlineOpacity})`;
        ctx.fillRect(0, y, size, 1.25);
        ctx.fillStyle = `rgba(0, 0, 0, ${params.scanlineOpacity * 0.5})`;
        ctx.fillRect(0, y + 1.25, size, 0.75);
      }
      ctx.restore();
    }

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return {
    setState(next) {
      if (next === "idle" || next === "thinking" || next === "responding") {
        currentState = next;
      }
    },
    getState() {
      return currentState;
    },
    destroy() {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } catch {
        /* noop */
      }
    },
  };
}
