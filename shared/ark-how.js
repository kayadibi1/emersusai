/* shared/ark-how.js — Ask·Read·Connect feature cards for landing.
 *
 * Three IIFEs, each self-guarded: they no-op if their DOM anchor isn't
 * present, so it's safe to ship regardless of whether the .ark-how
 * section is rendered on the current page.
 *   · cloud    → card 1 (noise-drift dot cloud + cursor "thinking" pull)
 *   · read-grid→ card 2 (tilted reading field + ticking counter)
 *   · globe    → card 3 (true 3D dot sphere with corona bursts)
 *
 * Extracted from app/emersus-cards-mockup.html — keep in sync.
 */
(function () {
  // Outer IIFE isolates our declarations from the global scope.
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function getMotionProfile() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    const saveData = Boolean(conn && conn.saveData);
    const lowMemory = (navigator.deviceMemory || 8) < 4;
    const lowCores = (navigator.hardwareConcurrency || 8) < 4;
    const coarseSmall = matchMedia('(pointer: coarse)').matches && window.innerWidth < 760;
    const slowDisplay = matchMedia('(update: slow)').matches;
    const lite = reducedMotion || saveData || lowMemory || lowCores || coarseSmall || slowDisplay;

    return {
      lite,
      dotCount: lite ? 140 : 220,
      readCols: lite ? 16 : 22,
      readRows: lite ? 9 : 12,
      globePoints: lite ? 320 : 520,
      canvasDpr: lite ? 1 : Math.min(window.devicePixelRatio || 1, 1.5),
      domFps: lite ? 18 : 30,
      canvasFps: lite ? 22 : 30,
    };
  }

  const profile = getMotionProfile();
  if (profile.lite) document.documentElement.classList.add('motion-lite');

  function bindActive(target, onChange, threshold = 0.04) {
    let inView = !('IntersectionObserver' in window);
    let visible = document.visibilityState === 'visible';

    function emit() {
      onChange(inView && visible);
    }

    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === target) inView = entry.isIntersecting;
        }
        emit();
      }, { rootMargin: '160px 0px', threshold });
      io.observe(target);
    }

    function onVisibilityChange() {
      visible = document.visibilityState === 'visible';
      emit();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    emit();

    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }

  function shouldPaint(now, clock, fps) {
    const minFrame = 1000 / fps;
    if (clock.last && now - clock.last < minFrame) return false;
    clock.last = now;
    return true;
  }

  /* ---------- Card 1 · paper-dot cloud (static layout) ---------- */
  (function () {
    const host = document.getElementById('cloud');
    if (!host) return;
    const DOTS = profile.dotCount;
    const palette = ['#bff6e4', '#34d399', '#5091f2', '#4338ca'];

    // Seedable PRNG so the layout is stable between reloads.
    let seed = 1337;
    const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

    for (let i = 0; i < DOTS; i++) {
      // Bias toward a torus around a central oval, mirroring Stripe card 1.
      const t = rand() * Math.PI * 2;
      const band = 0.58 + rand() * 0.42;         // annulus thickness
      const rx = 44 + band * 8;                  // oval radius X %
      const ry = 38 + band * 6;                  // oval radius Y %
      const jitter = () => (rand() - 0.5) * 22;

      const x = 50 + Math.cos(t) * rx + jitter();
      const y = 50 + Math.sin(t) * ry + jitter() * 0.6;

      const el = document.createElement('span');
      el.className = 'dot';
      el.style.left = x.toFixed(2) + '%';
      el.style.top  = y.toFixed(2) + '%';
      // size + colour stop based on band (outer ring is paler/smaller)
      const stop = Math.floor(band * palette.length * 0.999);
      el.style.background = palette[Math.min(stop, palette.length - 1)];
      const sz = 1.4 + rand() * 3.2;
      el.style.width = el.style.height = sz.toFixed(1) + 'px';
      el.style.opacity = (0.35 + band * 0.45).toFixed(2);
      host.appendChild(el);
    }
  })();

  /* Card 3 now builds its 3D sphere inside its animation IIFE (see below). */

  /* =================================================================
     ANIMATIONS
     Three cards, three motion archetypes:
       1. Ask    · dot orbit + cursor repulsion
       2. Read   · cloned sharp paper-wall revealed by a cursor spotlight
       3. Connect · hemisphere tilts toward cursor; tickets bob (CSS)
     Single shared rAF loop would be micro-optimal; separate IIFEs are
     fine for ~260 dots and a few mask updates and keep concerns local.
     ================================================================= */

  /* ---------- Card 1 · noise-drift + thinking pull ----------
     Port of Stripe's agentic-graphic vertex shader:
       pos += dir * noiseInner * SCATTER * pow(rand, scatter + scatter*align)
       pos += dir * noiseInner * 0.2*SCATTER * align
       pos = mix(pos, base, mouseDist)          // near cursor → snap back
     Where:
       dir   = unit vector from cloud-centre to the dot's base position
       align = max(0, dot(thinkingVec, dir))^3  · hoverStrength
       thinkingVec = unit vector centre → cursor (0 when not hovered)
     Everything in pixels so it's actually visible (the old %-translate
     produced 0.03 px on 3 px dots — invisible). */
  (function () {
    const host = document.getElementById('cloud');
    if (!host) return;
    const card = host.closest('.card');
    const dots = Array.from(host.querySelectorAll('.dot'));
    if (!dots.length) return;

    // Read host rect once — we re-read on resize.
    let rect = host.getBoundingClientRect();
    let cx = rect.width / 2, cy = rect.height / 2;
    new ResizeObserver(() => {
      rect = host.getBoundingClientRect();
      cx = rect.width / 2; cy = rect.height / 2;
    }).observe(host);

    // Freeze each dot's base pixel position + radial direction from centre.
    const state = dots.map(el => {
      const bxPct = parseFloat(el.style.left);
      const byPct = parseFloat(el.style.top);
      const bxPx = (bxPct / 100) * rect.width;
      const byPx = (byPct / 100) * rect.height;
      const rx = bxPx - cx, ry = byPx - cy;
      const rl = Math.hypot(rx, ry) || 1;
      return {
        el,
        bxPct, byPct,                  // for distance-to-cursor in % space
        dirX: rx / rl, dirY: ry / rl,  // outward radial
        rand:   Math.random(),         // per-dot scatter coefficient
        phase1: Math.random() * 6.283, // noise offsets
        phase2: Math.random() * 6.283,
        speed1: 0.55 + Math.random() * 0.35,
        speed2: 0.18 + Math.random() * 0.15,
      };
    });

    // Cursor + hover strength (both ease toward target each frame).
    let cxPct = 50, cyPct = 50;
    let hover = 0, targetHover = 0;
    let tvX = 0, tvY = 0;   // thinking vector (from centre toward cursor, ±1)

    card.addEventListener('mouseenter', () => { targetHover = 1; });
    card.addEventListener('mouseleave', () => { targetHover = 0; });
    card.addEventListener('mousemove', (e) => {
      const r = host.getBoundingClientRect();
      cxPct = ((e.clientX - r.left) / r.width)  * 100;
      cyPct = ((e.clientY - r.top)  / r.height) * 100;
      // Thinking vector in unit space (half-width = 50%)
      const nx = (cxPct - 50) / 50;
      const ny = (cyPct - 50) / 50;
      const nl = Math.hypot(nx, ny) || 1;
      tvX = nx / nl; tvY = ny / nl;
    });

    if (reducedMotion) return;

    const SCATTER = 14;   // outward drift amplitude in px
    const THINK_BOOST = 22; // extra push when aligned with cursor

    const t0 = performance.now();
    const clock = { last: 0 };
    let active = false;
    let rafId = 0;

    function frame(now) {
      rafId = 0;
      if (!active) return;
      if (!shouldPaint(now, clock, profile.domFps)) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      const t = (now - t0) / 1000;
      hover += (targetHover - hover) * 0.08;

      for (let i = 0; i < state.length; i++) {
        const s = state[i];

        // Two noise layers (sin/cos approximation of simplex)
        const n1 = Math.sin(t * s.speed1 + s.phase1 + s.bxPct * 0.03);
        const n2 = Math.sin(t * s.speed2 + s.phase2 + s.byPct * 0.02);

        // Alignment with cursor direction — only positive side contributes
        const align = Math.max(0, tvX * s.dirX + tvY * s.dirY);
        const alignCubed = align * align * align * hover;

        // Base outward drift, amplified by alignment (cursor-aligned dots "reach")
        const scatter = SCATTER * Math.pow(s.rand, 1.2 - 0.8 * alignCubed);
        let dx = s.dirX * n1 * scatter + s.dirY * n2 * scatter * 0.4;
        let dy = s.dirY * n1 * scatter - s.dirX * n2 * scatter * 0.4;
        dx += s.dirX * n1 * THINK_BOOST * alignCubed;
        dy += s.dirY * n1 * THINK_BOOST * alignCubed;

        // Calm zone: dots inside ~16% of cursor return to rest.
        if (hover > 0.02) {
          const vx = s.bxPct - cxPct;
          const vy = s.byPct - cyPct;
          const d  = Math.hypot(vx, vy);
          if (d < 16) {
            const calm = (1 - d / 16) * hover;
            dx *= 1 - calm;
            dy *= 1 - calm;
          }
        }

        s.el.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`;
      }
      rafId = requestAnimationFrame(frame);
    }
    bindActive(card, (next) => {
      active = next;
      if (active && !rafId) rafId = requestAnimationFrame(frame);
      if (!active && rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    });
  })();

  /* ---------- Card 2 · reading field ----------
     A tilted grid of cells (each cell = one paper). A "reading wave"
     sweeps across the columns over WAVE_DURATION seconds. Each cell's
     state depends on its distance from the wave front:
         |diff| ≈ 0          → live  (mint glow, lifted Z)
         |diff| < 0.075      → warm  (azure, mild glow)
         diff ∈ (−0.42, −0.04)→ read  (pale mint, flat)
     A prominent counter ticks up continuously (in sync with the wave)
     showing how many papers of the total corpus have been read.
     Hover tilts the whole field plane toward the cursor. */
  (function () {
    const host = document.getElementById('read-grid');
    if (!host) return;
    const scene = host.closest('.scene-read');
    const card  = scene.closest('.card');
    const numEl = document.getElementById('read-num');
    const barEl = document.getElementById('read-bar');

    // --- Build grid -----------------------------------------------------
    const COLS = profile.readCols, ROWS = profile.readRows;
    const cellW = profile.lite ? 28 : 22;
    const cellH = profile.lite ? 34 : 28;
    const cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const el = document.createElement('div');
        el.className = 'cell';
        el.style.left = (c * cellW) + 'px';
        el.style.top  = (r * cellH) + 'px';
        host.appendChild(el);
        cells.push({ el, c, r, state: '', jitter: Math.random() * 0.06 });
      }
    }

    // --- Hover tilt (smoothed) -----------------------------------------
    let tgtX = 0, tgtY = 0, tiltX = 0, tiltY = 0;
    card.addEventListener('mousemove', (e) => {
      const rect = scene.getBoundingClientRect();
      tgtX = ((e.clientX - rect.left) / rect.width  - 0.5) * 2;
      tgtY = ((e.clientY - rect.top)  / rect.height - 0.5) * 2;
    });
    card.addEventListener('mouseleave', () => { tgtX = 0; tgtY = 0; });

    // --- Counter: ticks up continuously at ~RATE papers/sec -------------
    //   The displayed count advances every frame; the progress bar mirrors.
    //   The rate is high enough that the number visibly ticks (cf. 238/s
    //   in the older draft — we want a busier, more confident pace here).
    const TOTAL = 2_000_000;
    const RATE  = 640;                        // papers/sec
    let count   = 1_284_679;                  // seed value

    // --- rAF --------------------------------------------------------------
    const WAVE_DURATION = 7.5;
    const t0 = performance.now();
    let prev = t0;
    const clock = { last: 0 };
    let active = false;
    let rafId = 0;

    function frame(now) {
      rafId = 0;
      if (!active && !reducedMotion) return;
      if (!reducedMotion && !shouldPaint(now, clock, profile.domFps)) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      const dt = (now - prev) / 1000;
      prev = now;
      const t  = (now - t0) / 1000;

      // Tilt ease
      tiltX += (tgtX - tiltX) * 0.08;
      tiltY += (tgtY - tiltY) * 0.08;
      host.style.setProperty('--tilt-x', (tiltX * 6).toFixed(2) + 'deg');
      host.style.setProperty('--tilt-y', (-tiltY * 10).toFixed(2) + 'deg');

      // Wave sweeps 0..1 across columns
      const wave = (t / WAVE_DURATION) % 1;

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const colNorm = cell.c / (COLS - 1);
        let diff = colNorm - wave;
        if (diff < -0.5) diff += 1;
        if (diff >  0.5) diff -= 1;

        let next = '';
        const liveBand = 0.025 + cell.jitter * 0.35;
        if (Math.abs(diff) < liveBand)        next = 'live';
        else if (Math.abs(diff) < 0.075)       next = 'warm';
        else if (diff < -0.04 && diff > -0.42) next = 'read';

        if (next !== cell.state) {
          if (cell.state) cell.el.classList.remove(cell.state);
          if (next)       cell.el.classList.add(next);
          cell.state = next;
        }
      }

      // Counter ticks in sync with the wave: each second → RATE papers,
      // with a burst multiplier peaking near the wave front for extra life.
      const waveBoost = 1 + 0.9 * Math.max(0, Math.sin(wave * Math.PI * 2));
      count = Math.min(TOTAL, count + dt * RATE * waveBoost);
      const intC = Math.floor(count);
      numEl.textContent = intC.toLocaleString('en-US');
      barEl.style.width = ((intC / TOTAL) * 100).toFixed(3) + '%';

      if (!reducedMotion) rafId = requestAnimationFrame(frame);
    }
    if (reducedMotion) {
      frame(t0);
      return;
    }
    bindActive(card, (next) => {
      active = next;
      if (active && !rafId) {
        prev = performance.now();
        rafId = requestAnimationFrame(frame);
      }
      if (!active && rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    });
  })();

  /* ---------- Card 3 · true 3D dot-sphere (canvas) ----------
     Stripe's money-movement graphic renders ~30k dots through Three.js +
     a custom vertex shader. We don't need 30k — ~520 reads as a globe —
     but each point must live in 3D, rotate around Y every frame, and
     project to screen with perspective + depth fade so the front of the
     sphere is bright/large and the back fades out. That is what makes
     the thing feel like a ball of points rather than a flat sticker.

     Pipeline per frame:
       1. For each point: apply continuous Y-rotation + cursor tilt on X/Y
       2. Apply per-point corona burst: scale radius outward while ease > 0
       3. Project with a cheap perspective divide (cam distance = 2.4)
       4. Depth-fade alpha and scale by projected depth
       5. Back-to-front sort, then draw filled arcs
  */
  (function () {
    const scene = document.querySelector('.scene-globe');
    if (!scene) return;
    const canvas = document.getElementById('globe');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const card = scene.closest('.card');

    const palette = ['#bff6e4', '#34d399', '#5091f2', '#4338ca'];

    // --- Fibonacci lattice: evenly-spaced points on the unit sphere -------
    const N = profile.globePoints;
    const pts = [];
    const PHI = Math.PI * (Math.sqrt(5) - 1);   // golden angle
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const rad = Math.sqrt(1 - y * y);
      const theta = PHI * i;
      const x = Math.cos(theta) * rad;
      const z = Math.sin(theta) * rad;
      pts.push({
        x, y, z,
        // colour stable per-point (by longitude) — gives the foil gradient
        colour: palette[Math.min(3, Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * 4))],
        baseR: 0.9 + Math.random() * 1.1,     // dot radius in px @ depth=1
        baseOp: 0.35 + Math.random() * 0.55,
        twinkPhase: Math.random() * Math.PI * 2,
        twinkRate:  2.2 + Math.random() * 2.8,
        // Corona burst schedule: each dot bursts on its own clock
        burstOffset: Math.random() * 14,       // stagger in seconds
        burstEvery:  9 + Math.random() * 9,    // 9-18 s between bursts
        burstDur:    1.1 + Math.random() * 0.9,
        burstAmt:    0.10 + Math.random() * 0.12,  // up to +22% outward
      });
    }

    // --- Canvas sizing: DPR-aware -----------------------------------------
    let W = 0, H = 0, R = 0, CX = 0, CY = 0;
    function resize() {
      const rect = scene.getBoundingClientRect();
      const dpr = profile.canvasDpr;
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      R  = Math.min(W, H) * 0.38;
      CX = W / 2;
      CY = H * 0.56;
    }
    resize();
    new ResizeObserver(resize).observe(scene);

    // --- Cursor tilt (smoothed) -------------------------------------------
    let tiltX = 0, tiltY = 0, tgtX = 0, tgtY = 0;
    card.addEventListener('mousemove', (e) => {
      const r = scene.getBoundingClientRect();
      tgtX = ((e.clientX - r.left) / r.width  - 0.5) * 2;
      tgtY = ((e.clientY - r.top)  / r.height - 0.5) * 2;
    });
    card.addEventListener('mouseleave', () => { tgtX = 0; tgtY = 0; });

    // --- Reference labels: parallax with hover tilt -----------------------
    // Each label is attached to a virtual 3D point on the front of the
    // sphere. We don't let them drift with continuous spin (that would
    // cycle them onto the back), but we DO reproject them per-frame using
    // the same rotX/rotY so they move with the globe on hover.
    const labels = [
      { el: scene.querySelector('.ticket.t1'), nx: -0.74, ny: -0.42, nz: 0.53 },
      { el: scene.querySelector('.ticket.t2'), nx:  0.82, ny:  0.10, nz: 0.56 },
      { el: scene.querySelector('.ticket.t3'), nx:  0.18, ny:  0.62, nz: 0.77 },
    ];
    // Cache a "home" screen position per label so JS transform = home + parallax.
    // Base stays rooted to the label's current CSS rect; we only DRIVE the delta.
    labels.forEach(l => {
      if (!l.el) return;
      l.el.style.animation = 'none';           // disable the CSS bob — JS drives now
      l.el.style.willChange = 'transform';
    });

    const CAM = 2.4;             // camera distance (ortho-ish perspective)
    const ROT_SPEED = 0.085;     // rad/sec continuous spin
    // Scratch array avoids per-frame allocation of 520 objects.
    const scratch = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) scratch[i] = { sx: 0, sy: 0, size: 0, alpha: 0, colour: '', z: 0 };

    function renderFrame(t) {
      // Ease tilt toward target
      tiltX += (tgtX - tiltX) * 0.08;
      tiltY += (tgtY - tiltY) * 0.08;

      // Full rotation = continuous spin + a nudge from cursor X,
      // so hover subtly steers the globe instead of only flattening it.
      const rotY = t * ROT_SPEED + tiltX * 0.35;
      const rotX = tiltY * 0.28;
      const cY = Math.cos(rotY), sY = Math.sin(rotY);
      const cX = Math.cos(rotX), sX = Math.sin(rotX);

      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];

        // Corona burst: per-point phase in its own cycle.
        const local = (t + p.burstOffset) % p.burstEvery;
        let ease = 0;
        if (local < p.burstDur) {
          // Half-sine envelope: 0 → 1 → 0 over burstDur
          ease = Math.sin((local / p.burstDur) * Math.PI);
        }
        const rScale = 1 + ease * p.burstAmt;

        // Rotate Y then X
        const x0 = p.x * rScale, y0 = p.y * rScale, z0 = p.z * rScale;
        const x1 =  x0 * cY + z0 * sY;
        const z1 = -x0 * sY + z0 * cY;
        const y1 =  y0 * cX - z1 * sX;
        const z2 =  y0 * sX + z1 * cX;
        const x2 =  x1;  // unchanged by rotX

        // Perspective divide (z2 ∈ [−1, 1])
        const persp = CAM / (CAM - z2);
        const sx = CX + x2 * R * persp;
        const sy = CY + y1 * R * persp;

        // Depth fade: z2 = +1 → near/bright, z2 = −1 → far/dim.
        // Keep back dots visible but muted — we want a sphere, not a bowl.
        const depth  = (z2 + 1) * 0.5;                 // 0..1 (far..near)
        const depthA = 0.28 + Math.pow(depth, 1.3) * 0.72;
        const twink  = 0.82 + Math.sin(t * p.twinkRate + p.twinkPhase) * 0.14;
        const alpha  = p.baseOp * depthA * twink + ease * 0.45 * depthA;
        const size   = Math.max(0.35, p.baseR * persp * (1 + ease * 0.35));

        const s = scratch[i];
        s.sx = sx; s.sy = sy; s.size = size; s.alpha = alpha;
        s.colour = p.colour; s.z = z2;
      }

      // Back-to-front so front dots overlap the back ones.
      scratch.sort((a, b) => a.z - b.z);

      for (let i = 0; i < scratch.length; i++) {
        const s = scratch[i];
        if (s.alpha < 0.03) continue;
        ctx.globalAlpha = Math.min(1, s.alpha);
        ctx.fillStyle = s.colour;
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // --- Move reference labels with hover tilt --------------------------
      // Project each anchor using ONLY the tilt rotation (not the
      // continuous spin). That way labels follow the cursor-driven
      // motion of the globe without orbiting out of view.
      const lcX = Math.cos(rotX), lsX = Math.sin(rotX);
      const ltY = tiltX * 0.35, lcY = Math.cos(ltY), lsY = Math.sin(ltY);
      for (let i = 0; i < labels.length; i++) {
        const L = labels[i];
        if (!L.el) continue;
        // Rotate the anchor by the hover-only deltas
        const x0 = L.nx, y0 = L.ny, z0 = L.nz;
        const x1 =  x0 * lcY + z0 * lsY;
        const z1 = -x0 * lsY + z0 * lcY;
        const y1 =  y0 * lcX - z1 * lsX;
        // Compare to the rest-pose projection (tilt = 0) to get a pure delta.
        // Rest-pose = (x0, y0, z0) unrotated, so dx = x1 - x0, dy = y1 - y0.
        const dx = (x1 - x0) * R;
        const dy = (y1 - y0) * R;
        L.el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
      }
    }

    if (reducedMotion) {
      // Draw one still frame at default rotation and stop.
      renderFrame(0);
      return;
    }

    const t0 = performance.now();
    const clock = { last: 0 };
    let active = false;
    let rafId = 0;

    function frame(now) {
      rafId = 0;
      if (!active) return;
      if (!shouldPaint(now, clock, profile.canvasFps)) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      renderFrame((now - t0) / 1000);
      rafId = requestAnimationFrame(frame);
    }
    renderFrame(0);
    bindActive(card, (next) => {
      active = next;
      if (active && !rafId) rafId = requestAnimationFrame(frame);
      if (!active && rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    });
  })();
})();
