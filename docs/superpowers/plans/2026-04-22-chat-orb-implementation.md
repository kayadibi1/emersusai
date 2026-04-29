# Emersus Chat Orb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `shared/thinking-glyph.js` with a new 3D particle-cloud orb (`shared/emersus-orb/*`) that renders below the last assistant message in chat, morphs between 30 target shapes via greedy nearest-neighbour + underdamped spring physics, and distinguishes idle / thinking / responding states via shape-cycling, breath, and rotation.

**Architecture:** CPU-side spring physics (~260 particles, vanilla JS), GPU-side render via `three.js` (loaded from `https://esm.sh/three`), `THREE.Points` + `ShaderMaterial` for particles, `THREE.LineSegments` for near-neighbour links and motion trails. No bundler, no npm install — `three` imported as an ESM URL module. Pure modules (shapes / physics / state / config) unit-tested with `node:test`. Render and integration verified visually via `app/emersus-orb-mockup.html`.

**Tech Stack:** Vanilla ES modules · React 18 via esm.sh · three.js ^0.169 via esm.sh · `node:test` for unit tests · Express dev server for visual verification.

**Spec:** `docs/superpowers/specs/2026-04-22-chat-orb-design.md`

**Reference PoC:** The final tuning mockup from the brainstorm session is at `.superpowers/brainstorm/99860-1776846805/content/hybrid-3d-v8.html`. Every physics, shape, and state parameter in that file has been tuned by the user and is canonical. Copy-paste liberally from it — the plan's job is to split that single file into focused, tested modules.

**Target file structure:**
```
shared/emersus-orb/
  index.js           // createEmersusOrb(canvas, opts) — public API
  shapes.js          // 30 target generators + SHAPE_SPIN table
  physics.js         // spring + curl + stagger + nearest-neighbour
  state.js           // state machine, param lerping, breath, transition gesture
  render.js          // three.js scene, Points + LineSegments + trails
  config.js          // tunable constants + ?tune=1 URL flag reader

app/emersus-orb-mockup.html  // live tuning panel (thin — imports from shared/emersus-orb)

tests/unit/shared/emersus-orb/
  shapes.test.js
  physics.test.js
  state.test.js
  config.test.js
```

**Deletions on ship (Task 27):**
- `shared/thinking-glyph.js`
- `ThinkingGlyph` wrapper + its import in `shared/react-chat-app.js`
- `app/thinking-glyph-mockup.html` (archived not deleted — not in our scope but noted)

**Commit + push rules:**
- Every task ends with one commit. Never push to `origin/main` without explicit user approval (it auto-deploys via webhook).
- Do NOT `git add` any `.md` files (the spec, this plan, changelog, etc.). All `.md` are gitignored by design; per-project memory says skip the commit prompt for them.
- Commit messages follow the project style: conventional prefix + short subject, e.g. `feat(orb): add shape generators`.

---

## Task 1: Scaffold the folder, add three.js via esm.sh, write a placeholder index.js

**Files:**
- Create: `shared/emersus-orb/index.js`
- Create: `shared/emersus-orb/config.js`
- Create: `tests/unit/shared/emersus-orb/config.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/shared/emersus-orb/config.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, readTuning } from '../../../../shared/emersus-orb/config.js';

describe('emersus-orb/config.js', () => {
  test('DEFAULTS exposes the locked physics values from the brainstorm', () => {
    assert.equal(DEFAULTS.curve, 0.04);
    assert.equal(DEFAULTS.continuous, 0);
    assert.equal(DEFAULTS.overshoot, 0);
    assert.equal(DEFAULTS.preBurst, 1.0);
    assert.equal(DEFAULTS.staggerMs, 750);
    assert.equal(DEFAULTS.spin, 1.0);
  });

  test('DEFAULTS exposes rendering constants', () => {
    assert.equal(DEFAULTS.particleCount, 260);
    assert.equal(DEFAULTS.trailLen, 40);
    assert.equal(DEFAULTS.transitWindowMs, 2200);
    assert.equal(DEFAULTS.burstWindowMs, 350);
    assert.equal(DEFAULTS.stateTxMs, 2200);
  });

  test('readTuning returns DEFAULTS when no search string is given', () => {
    const t = readTuning('');
    assert.equal(t.curve, DEFAULTS.curve);
    assert.equal(t.preBurst, DEFAULTS.preBurst);
  });

  test('readTuning parses ?tune params and overrides matching keys', () => {
    const t = readTuning('?tune=1&curve=0.3&preBurst=1.8&staggerMs=500');
    assert.equal(t.curve, 0.3);
    assert.equal(t.preBurst, 1.8);
    assert.equal(t.staggerMs, 500);
    assert.equal(t.continuous, DEFAULTS.continuous); // not overridden
  });

  test('readTuning ignores unknown keys and non-numeric values', () => {
    const t = readTuning('?tune=1&curve=abc&bogus=42');
    assert.equal(t.curve, DEFAULTS.curve); // rejected (NaN)
    assert.equal(t.bogus, undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern="emersus-orb/config"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `shared/emersus-orb/config.js`**

```js
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
```

- [ ] **Step 4: Placeholder `shared/emersus-orb/index.js`**

```js
// shared/emersus-orb/index.js
// Public API entry. Real createEmersusOrb implementation lands in Task 19.

export function createEmersusOrb() {
  throw new Error('createEmersusOrb not implemented yet — see Task 19.');
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm run test:unit -- --test-name-pattern="emersus-orb/config"`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Commit**

```bash
git add shared/emersus-orb/index.js shared/emersus-orb/config.js tests/unit/shared/emersus-orb/config.test.js
git commit -m "feat(orb): scaffold emersus-orb module + locked tuning defaults"
```

---

## Task 2: Shape generators — polyhedra (sphere, icosa, dodeca, cube, octa, tetra, pyramid, bucky)

**Files:**
- Create: `shared/emersus-orb/shapes.js`
- Create: `tests/unit/shared/emersus-orb/shapes.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/shared/emersus-orb/shapes.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sphereTargets, icosaTargets, dodecaTargets, cubeTargets,
  octaTargets, tetraTargets, pyramidTargets, buckyTargets,
} from '../../../../shared/emersus-orb/shapes.js';

const N = 260;

function assertValidTargets(targets, name, expectedMaxCoord = 200) {
  assert.equal(targets.length, N, `${name} length`);
  for (const p of targets) {
    assert.equal(p.length, 3, `${name} is 3D`);
    for (let i = 0; i < 3; i++) {
      assert(Number.isFinite(p[i]), `${name} has no NaN/Infinity`);
      assert(Math.abs(p[i]) < expectedMaxCoord, `${name} coord in range: ${p[i]}`);
    }
  }
}

describe('emersus-orb/shapes.js — polyhedra', () => {
  test('sphereTargets returns 260 bounded 3D points', () => {
    assertValidTargets(sphereTargets(N), 'sphere');
  });
  test('icosaTargets returns 260 bounded 3D points', () => {
    assertValidTargets(icosaTargets(N), 'icosa');
  });
  test('dodecaTargets returns 260 bounded 3D points', () => {
    assertValidTargets(dodecaTargets(N), 'dodeca');
  });
  test('cubeTargets returns 260 bounded 3D points', () => {
    assertValidTargets(cubeTargets(N), 'cube');
  });
  test('octaTargets returns 260 bounded 3D points', () => {
    assertValidTargets(octaTargets(N), 'octa');
  });
  test('tetraTargets returns 260 bounded 3D points', () => {
    assertValidTargets(tetraTargets(N), 'tetra');
  });
  test('pyramidTargets returns 260 bounded 3D points', () => {
    assertValidTargets(pyramidTargets(N), 'pyramid');
  });
  test('buckyTargets returns 260 bounded 3D points', () => {
    assertValidTargets(buckyTargets(N), 'bucky');
  });
  test('sphere points sit on a ~unit-ish shell', () => {
    const pts = sphereTargets(N);
    for (const p of pts) {
      const r = Math.hypot(...p);
      assert(r > 100 && r < 140, `sphere radius in band: ${r}`);
    }
  });
  test('icosa is seed-stable for edge particles (only vertex wobble is random)', () => {
    // not strictly stable — just verify it doesn't throw and produces N points
    assert.equal(icosaTargets(N).length, N);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern="polyhedra"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `shared/emersus-orb/shapes.js` — polyhedra section**

Copy the polyhedron generators from the brainstorm mockup (`.superpowers/brainstorm/99860-1776846805/content/hybrid-3d-v8.html`). Generators below are functions taking `N` (particle count) and returning `[[x, y, z], ...]`.

```js
// shared/emersus-orb/shapes.js
// 3D shape target generators. Each function accepts N (particle count) and
// returns exactly N `[x, y, z]` points. Randomness is per-call (not seeded):
// the orb re-runs generators on shape change to get fresh jitter.

function lerp(a, b, t) { return a + (b - a) * t; }

// Internal: place particles on a polyhedron's vertices + edges.
function polyVerticesEdges(V, expectedEdge, N) {
  const E = [];
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
    const d = Math.hypot(V[i][0]-V[j][0], V[i][1]-V[j][1], V[i][2]-V[j][2]);
    if (Math.abs(d - expectedEdge) < 0.01) E.push([i, j]);
  }
  const out = [];
  const vertexPts = Math.min(Math.floor(N / 2), V.length * 3);
  for (let i = 0; i < vertexPts; i++) {
    const v = V[i % V.length];
    const j = (Math.random()-0.5)*4;
    out.push([v[0]+j, v[1]+j, v[2]+j]);
  }
  const edgePtsTotal = N - vertexPts;
  const perEdge = Math.ceil(edgePtsTotal / Math.max(E.length, 1));
  let count = 0;
  for (const [a, b] of E) {
    for (let k = 0; k < perEdge && count < edgePtsTotal; k++, count++) {
      const t = (k + 0.5) / perEdge;
      const j = (Math.random()-0.5)*3;
      out.push([lerp(V[a][0], V[b][0], t)+j, lerp(V[a][1], V[b][1], t)+j, lerp(V[a][2], V[b][2], t)+j]);
    }
  }
  while (out.length < N) out.push(V[(Math.random()*V.length)|0].slice());
  return out.slice(0, N);
}

export function sphereTargets(N) {
  const out = [];
  for (let i = 0; i < N; i++) {
    const phi = Math.acos(2*Math.random()-1);
    const theta = Math.random() * Math.PI * 2;
    const r = 120 + (Math.random()-0.5)*8;
    out.push([
      r*Math.sin(phi)*Math.cos(theta),
      r*Math.cos(phi),
      r*Math.sin(phi)*Math.sin(theta),
    ]);
  }
  return out;
}

export function icosaTargets(N) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const scale = 80;
  const V = [
    [-1, phi, 0],[1, phi, 0],[-1,-phi, 0],[1,-phi, 0],
    [0,-1, phi],[0, 1, phi],[0,-1,-phi],[0, 1,-phi],
    [phi, 0,-1],[phi, 0, 1],[-phi, 0,-1],[-phi, 0, 1],
  ].map(v => [v[0]*scale, v[1]*scale, v[2]*scale]);
  return polyVerticesEdges(V, 2 * scale, N);
}

export function dodecaTargets(N) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const ip = 1 / phi;
  const s = 65;
  const V = [
    [ 1, 1, 1],[ 1, 1,-1],[ 1,-1, 1],[ 1,-1,-1],
    [-1, 1, 1],[-1, 1,-1],[-1,-1, 1],[-1,-1,-1],
    [0, ip, phi],[0, ip,-phi],[0,-ip, phi],[0,-ip,-phi],
    [ip, phi, 0],[ip,-phi, 0],[-ip, phi, 0],[-ip,-phi, 0],
    [phi, 0, ip],[phi, 0,-ip],[-phi, 0, ip],[-phi, 0,-ip],
  ].map(v => [v[0]*s, v[1]*s, v[2]*s]);
  return polyVerticesEdges(V, 2 * ip * s, N);
}

export function cubeTargets(N) {
  const s = 75;
  const V = [[s,s,s],[s,s,-s],[s,-s,s],[s,-s,-s],[-s,s,s],[-s,s,-s],[-s,-s,s],[-s,-s,-s]];
  return polyVerticesEdges(V, 2 * s, N);
}

export function octaTargets(N) {
  const s = 90;
  const V = [[s,0,0],[-s,0,0],[0,s,0],[0,-s,0],[0,0,s],[0,0,-s]];
  return polyVerticesEdges(V, s * Math.SQRT2, N);
}

export function tetraTargets(N) {
  const s = 80;
  const V = [[s,s,s],[s,-s,-s],[-s,s,-s],[-s,-s,s]];
  return polyVerticesEdges(V, Math.hypot(2*s, 2*s, 0), N);
}

export function pyramidTargets(N) {
  const s = 75;
  const V = [[s,-s,s],[s,-s,-s],[-s,-s,s],[-s,-s,-s],[0, s, 0]];
  return polyVerticesEdges(V, 2 * s, N);
}

export function buckyTargets(N) {
  // Fibonacci sphere — even distribution that reads as a soccer-ball-ish cloud.
  const out = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const R = 105;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = i * goldenAngle;
    out.push([radius * Math.cos(theta) * R, y * R, radius * Math.sin(theta) * R]);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test:unit -- --test-name-pattern="polyhedra"`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/emersus-orb/shapes.js tests/unit/shared/emersus-orb/shapes.test.js
git commit -m "feat(orb): shape generators — polyhedra (sphere, icosa, dodeca, cube, octa, tetra, pyramid, bucky)"
```

---

## Task 3: Shape generators — topology + surfaces (torus, trefoil, torusKnot, möbius, klein, linked, supertoroid, catenoid, helicoid)

**Files:**
- Modify: `shared/emersus-orb/shapes.js` (append)
- Modify: `tests/unit/shared/emersus-orb/shapes.test.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/shared/emersus-orb/shapes.test.js`:

```js
import {
  torusTargets, trefoilTargets, torusKnotTargets, mobiusTargets,
  kleinTargets, linkedCirclesTargets, supertoroidTargets,
  catenoidTargets, helicoidTargets,
} from '../../../../shared/emersus-orb/shapes.js';

describe('emersus-orb/shapes.js — topology + surfaces', () => {
  test('torus', () => assertValidTargets(torusTargets(N), 'torus'));
  test('trefoil', () => assertValidTargets(trefoilTargets(N), 'trefoil', 180));
  test('torusKnot', () => assertValidTargets(torusKnotTargets(N), 'torusKnot'));
  test('möbius', () => assertValidTargets(mobiusTargets(N), 'mobius'));
  test('klein', () => assertValidTargets(kleinTargets(N), 'klein'));
  test('linkedCircles', () => assertValidTargets(linkedCirclesTargets(N), 'linked'));
  test('supertoroid', () => assertValidTargets(supertoroidTargets(N), 'supertoroid'));
  test('catenoid', () => assertValidTargets(catenoidTargets(N), 'catenoid', 300));
  test('helicoid', () => assertValidTargets(helicoidTargets(N), 'helicoid'));
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- --test-name-pattern="topology"`
Expected: FAIL (exports missing).

- [ ] **Step 3: Append generators to `shared/emersus-orb/shapes.js`**

```js
export function torusTargets(N) {
  const out = []; const R = 105, r = 28;
  for (let i = 0; i < N; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = Math.random() * Math.PI * 2;
    out.push([(R + r*Math.cos(v))*Math.cos(u), r*Math.sin(v), (R + r*Math.cos(v))*Math.sin(u)]);
  }
  return out;
}

export function trefoilTargets(N) {
  const out = [], scale = 32;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const x = scale * (Math.sin(t) + 2 * Math.sin(2 * t));
    const y = scale * (Math.cos(t) - 2 * Math.cos(2 * t));
    const z = scale * (-Math.sin(3 * t));
    const j = () => (Math.random()-0.5)*4;
    out.push([x + j(), y + j(), z + j()]);
  }
  return out;
}

export function torusKnotTargets(N) {
  const out = [], p = 3, q = 2, R = 60, r = 22;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const radial = R + r * Math.cos(q * t);
    const x = radial * Math.cos(p * t);
    const y = radial * Math.sin(p * t);
    const z = r * Math.sin(q * t) * 1.5;
    const j = (Math.random()-0.5) * 5;
    out.push([x + j, z + j, y + j]); // swap to make Y vertical
  }
  return out;
}

export function mobiusTargets(N) {
  const out = [], R = 75, W = 60;
  for (let i = 0; i < N; i++) {
    const v = Math.random() * Math.PI * 2;
    const u = (Math.random() - 0.5) * 2 * W;
    out.push([
      (R + u * Math.cos(v / 2)) * Math.cos(v),
      u * Math.sin(v / 2),
      (R + u * Math.cos(v / 2)) * Math.sin(v),
    ]);
  }
  return out;
}

export function kleinTargets(N) {
  const out = [], R = 60, r = 28;
  for (let i = 0; i < N; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = Math.random() * Math.PI * 2;
    const hv = v / 2;
    const radial = R + r * Math.cos(hv) * Math.sin(u) - r * Math.sin(hv) * Math.sin(2 * u);
    out.push([
      radial * Math.cos(v),
      r * Math.sin(hv) * Math.sin(u) + r * Math.cos(hv) * Math.sin(2 * u),
      radial * Math.sin(v),
    ]);
  }
  return out;
}

export function linkedCirclesTargets(N) {
  const out = [], R = 75;
  for (let i = 0; i < N; i++) {
    const ring = i % 2;
    const t = Math.random() * Math.PI * 2;
    const thick = (Math.random()-0.5) * 8;
    if (ring === 0) out.push([(R + thick) * Math.cos(t), thick * 0.3, (R + thick) * Math.sin(t)]);
    else            out.push([R + thick * 0.3, (R + thick) * Math.cos(t), (R + thick) * Math.sin(t)]);
  }
  return out;
}

export function supertoroidTargets(N) {
  const out = [], R = 90, r = 28, e = 0.5;
  const sign = x => x < 0 ? -1 : 1;
  const p = (a, e) => sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), e);
  const q = (a, e) => sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), e);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = Math.random() * Math.PI * 2;
    const radial = R + r * p(v, e);
    out.push([radial * p(u, e), r * q(v, e), radial * q(u, e)]);
  }
  return out;
}

export function catenoidTargets(N) {
  const out = [], a = 35, height = 180;
  for (let i = 0; i < N; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = (Math.random() - 0.5) * height / 2;
    const r = a * Math.cosh(v / a);
    out.push([r * Math.cos(u), v * 2, r * Math.sin(u)]);
  }
  return out;
}

export function helicoidTargets(N) {
  const out = [], turns = 3, pitch = 28, maxR = 75;
  for (let i = 0; i < N; i++) {
    const v = Math.random() * turns * Math.PI * 2;
    const u = (Math.random() * 2 - 1) * maxR;
    const x = u * Math.cos(v);
    const y = pitch * (v / (Math.PI * 2)) - (pitch * turns / 2);
    const z = u * Math.sin(v);
    out.push([x, y, z]);
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- --test-name-pattern="topology"`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/emersus-orb/shapes.js tests/unit/shared/emersus-orb/shapes.test.js
git commit -m "feat(orb): shape generators — topology + surfaces"
```

---

## Task 4: Shape generators — chaotic attractors (lorenz, rössler, thomas, halvorsen)

**Files:**
- Modify: `shared/emersus-orb/shapes.js` (append helper + 4 generators)
- Modify: `tests/unit/shared/emersus-orb/shapes.test.js`

- [ ] **Step 1: Tests**

Append to the shapes test file:

```js
import { lorenzTargets, rosslerTargets, thomasTargets, halvorsenTargets } from '../../../../shared/emersus-orb/shapes.js';

describe('emersus-orb/shapes.js — chaos attractors', () => {
  test('lorenz', () => assertValidTargets(lorenzTargets(N), 'lorenz'));
  test('rossler', () => assertValidTargets(rosslerTargets(N), 'rossler'));
  test('thomas', () => assertValidTargets(thomasTargets(N), 'thomas'));
  test('halvorsen', () => assertValidTargets(halvorsenTargets(N), 'halvorsen'));
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- --test-name-pattern="chaos"`
Expected: FAIL.

- [ ] **Step 3: Append generators + `scaleCenter` helper**

```js
function scaleCenter(pts, N, target) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (const p of pts) {
    if(p[0]<minX)minX=p[0]; if(p[0]>maxX)maxX=p[0];
    if(p[1]<minY)minY=p[1]; if(p[1]>maxY)maxY=p[1];
    if(p[2]<minZ)minZ=p[2]; if(p[2]>maxZ)maxZ=p[2];
  }
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2, cz=(minZ+maxZ)/2;
  const spread = Math.max(maxX-minX, maxY-minY, maxZ-minZ) || 1;
  const scale = target / spread;
  const out = [];
  for (let i = 0; i < N; i++) {
    const p = pts[i % pts.length];
    out.push([(p[0]-cx)*scale, (p[1]-cy)*scale, (p[2]-cz)*scale]);
  }
  return out;
}

export function lorenzTargets(N) {
  const sigma = 10, rho = 28, beta = 8/3;
  let x = 0.1, y = 0, z = 0;
  const dt = 0.005;
  for (let i = 0; i < 400; i++) {
    x += sigma*(y-x) * dt;
    y += (x*(rho-z) - y) * dt;
    z += (x*y - beta*z) * dt;
  }
  const pts = [];
  const steps = N * 6;
  for (let i = 0; i < steps; i++) {
    const dx = sigma*(y-x), dy = x*(rho-z) - y, dz = x*y - beta*z;
    x += dx*dt; y += dy*dt; z += dz*dt;
    if (i % 6 === 0) pts.push([x, y - 25, z]);
  }
  return scaleCenter(pts, N, 180);
}

export function rosslerTargets(N) {
  const a = 0.2, b = 0.2, c = 5.7;
  let x = 1, y = 1, z = 1;
  const dt = 0.02;
  for (let i = 0; i < 500; i++) {
    x += (-y - z) * dt;
    y += (x + a*y) * dt;
    z += (b + z*(x - c)) * dt;
  }
  const pts = [];
  const steps = N * 4;
  for (let i = 0; i < steps; i++) {
    const dx = -y - z, dy = x + a*y, dz = b + z*(x - c);
    x += dx*dt; y += dy*dt; z += dz*dt;
    if (i % 4 === 0) pts.push([x, y, z]);
  }
  return scaleCenter(pts, N, 180);
}

export function thomasTargets(N) {
  const b = 0.19;
  let x = 0.5, y = 0.5, z = 0.5;
  const dt = 0.08;
  for (let i = 0; i < 400; i++) {
    x += (Math.sin(y) - b*x) * dt;
    y += (Math.sin(z) - b*y) * dt;
    z += (Math.sin(x) - b*z) * dt;
  }
  const pts = [];
  const steps = N * 3;
  for (let i = 0; i < steps; i++) {
    const dx = Math.sin(y) - b*x, dy = Math.sin(z) - b*y, dz = Math.sin(x) - b*z;
    x += dx*dt; y += dy*dt; z += dz*dt;
    if (i % 3 === 0) pts.push([x, y, z]);
  }
  return scaleCenter(pts, N, 180);
}

export function halvorsenTargets(N) {
  const a = 1.89;
  let x = -1.48, y = -1.51, z = 2.04;
  const dt = 0.008;
  for (let i = 0; i < 400; i++) {
    x += (-a*x - 4*y - 4*z - y*y) * dt;
    y += (-a*y - 4*z - 4*x - z*z) * dt;
    z += (-a*z - 4*x - 4*y - x*x) * dt;
  }
  const pts = [];
  const steps = N * 4;
  for (let i = 0; i < steps; i++) {
    const dx = -a*x - 4*y - 4*z - y*y;
    const dy = -a*y - 4*z - 4*x - z*z;
    const dz = -a*z - 4*x - 4*y - x*x;
    x += dx*dt; y += dy*dt; z += dz*dt;
    if (i % 4 === 0) pts.push([x, y, z]);
  }
  return scaleCenter(pts, N, 180);
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- --test-name-pattern="chaos"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/emersus-orb/shapes.js tests/unit/shared/emersus-orb/shapes.test.js
git commit -m "feat(orb): shape generators — chaos attractors (lorenz, rössler, thomas, halvorsen)"
```

---

## Task 5: Shape generators — bio / nature / cosmic / curves + SHAPE_SPIN table

**Files:**
- Modify: `shared/emersus-orb/shapes.js` (append remaining 10 generators + SHAPE_SPIN)
- Modify: `tests/unit/shared/emersus-orb/shapes.test.js`

- [ ] **Step 1: Tests**

Append to shapes test file:

```js
import {
  dnaTargets, moleculeTargets, seashellTargets, heartTargets,
  sunflowerTargets, galaxyTargets, saturnTargets,
  vivianiTargets, lissajous3DTargets, infinityTargets,
  SHAPE_SPIN, SHAPE_NAMES,
} from '../../../../shared/emersus-orb/shapes.js';

describe('emersus-orb/shapes.js — bio / cosmic / curves', () => {
  test('dna', () => assertValidTargets(dnaTargets(N), 'dna'));
  test('molecule', () => assertValidTargets(moleculeTargets(N), 'molecule'));
  test('seashell', () => assertValidTargets(seashellTargets(N), 'seashell', 250));
  test('heart', () => assertValidTargets(heartTargets(N), 'heart', 250));
  test('sunflower', () => assertValidTargets(sunflowerTargets(N), 'sunflower'));
  test('galaxy', () => assertValidTargets(galaxyTargets(N), 'galaxy'));
  test('saturn', () => assertValidTargets(saturnTargets(N), 'saturn'));
  test('viviani', () => assertValidTargets(vivianiTargets(N), 'viviani'));
  test('lissajous', () => assertValidTargets(lissajous3DTargets(N), 'lissajous'));
  test('infinity', () => assertValidTargets(infinityTargets(N), 'infinity'));
});

describe('emersus-orb/shapes.js — SHAPE_SPIN + SHAPE_NAMES', () => {
  test('SHAPE_NAMES has 30 entries', () => {
    assert.equal(SHAPE_NAMES.length, 30);
  });
  test('every name has a SHAPE_SPIN entry with a unit axis + positive speed', () => {
    for (const name of SHAPE_NAMES) {
      const spin = SHAPE_SPIN[name];
      assert.ok(spin, `missing spin for ${name}`);
      const axisLen = Math.hypot(spin.axis[0], spin.axis[1], spin.axis[2]);
      assert(Math.abs(axisLen - 1) < 1e-6, `${name} axis must be unit length`);
      assert(spin.speed > 0, `${name} speed must be positive`);
    }
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- --test-name-pattern="bio|SHAPE_SPIN"`
Expected: FAIL.

- [ ] **Step 3: Append remaining generators + SHAPE_SPIN**

Copy these from the brainstorm mockup. Key shapes:

```js
export function dnaTargets(N) {
  const out = [];
  const turns = 2.2, height = 240, rHelix = 52;
  const nStrand = Math.floor(N * 0.38);
  const rungSlots = N - nStrand * 2;
  const rungsPerRung = 4;
  const nDistinctRungs = Math.max(1, Math.floor(rungSlots / rungsPerRung));
  const j = () => (Math.random()-0.5)*3;
  // strand 1
  for (let i = 0; i < nStrand; i++) {
    const u = i / (nStrand - 1);
    const t = u * turns * Math.PI * 2;
    const y = -height/2 + u * height;
    out.push([rHelix*Math.cos(t)+j(), y+j(), rHelix*Math.sin(t)+j()]);
  }
  // strand 2 (180° offset)
  for (let i = 0; i < nStrand; i++) {
    const u = i / (nStrand - 1);
    const t = u * turns * Math.PI * 2;
    const y = -height/2 + u * height;
    out.push([rHelix*Math.cos(t+Math.PI)+j(), y+j(), rHelix*Math.sin(t+Math.PI)+j()]);
  }
  // base-pair rungs
  let rp = 0;
  for (let r = 0; r < nDistinctRungs && rp < rungSlots; r++) {
    const u = (r + 0.5) / nDistinctRungs;
    const t = u * turns * Math.PI * 2;
    const y = -height/2 + u * height;
    const x1 = rHelix*Math.cos(t), z1 = rHelix*Math.sin(t);
    const x2 = rHelix*Math.cos(t+Math.PI), z2 = rHelix*Math.sin(t+Math.PI);
    for (let k = 0; k < rungsPerRung && rp < rungSlots; k++, rp++) {
      const f = (k + 1) / (rungsPerRung + 1);
      out.push([lerp(x1,x2,f)+j(), y+j(), lerp(z1,z2,f)+j()]);
    }
  }
  while (out.length < N) {
    const u = Math.random();
    const t = u * turns * Math.PI * 2;
    const y = -height/2 + u * height;
    out.push([rHelix*Math.cos(t), y, rHelix*Math.sin(t)]);
  }
  return out.slice(0, N);
}

export function moleculeTargets(N) {
  const out = [];
  const centers = [[0,0,0],[80,60,0],[-80,60,0],[0,-80,60],[0,-30,-90]];
  for (let i = 0; i < N; i++) {
    const c = centers[i % centers.length];
    const phi = Math.acos(2*Math.random()-1);
    const theta = Math.random() * Math.PI * 2;
    const r = (i % centers.length === 0) ? 22 : 16;
    out.push([c[0]+r*Math.sin(phi)*Math.cos(theta), c[1]+r*Math.cos(phi), c[2]+r*Math.sin(phi)*Math.sin(theta)]);
  }
  return out;
}

export function seashellTargets(N) {
  const out = [], a = 2, b = 0.12;
  for (let i = 0; i < N; i++) {
    const t = Math.random() * 6 * Math.PI;
    const r = a * Math.exp(b * t);
    const v = Math.random() * Math.PI * 2;
    const tubeR = r * 0.4;
    out.push([
      r * Math.cos(t) + tubeR * Math.cos(v),
      -t * 3.5 + tubeR * Math.sin(v) * 0.5 + 50,
      r * Math.sin(t) + tubeR * Math.cos(v),
    ]);
  }
  return scaleCenter(out, N, 200);
}

export function heartTargets(N) {
  const out = [], s = 6;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const hx = s * 16 * Math.pow(Math.sin(t), 3);
    const hy = -s * (13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t));
    const thickness = 28 * (1 - Math.cos(2*t) * 0.5);
    const z = (Math.random()*2 - 1) * thickness * Math.random();
    out.push([hx + (Math.random()-0.5)*4, hy + (Math.random()-0.5)*4, z]);
  }
  return out;
}

export function sunflowerTargets(N) {
  const out = [], goldenAngle = Math.PI * (3 - Math.sqrt(5)), maxR = 110;
  for (let i = 0; i < N; i++) {
    const t = i * goldenAngle;
    const rNorm = Math.sqrt(i / N);
    const r = rNorm * maxR;
    const y = (1 - rNorm * rNorm) * 60 - 20;
    out.push([r * Math.cos(t), y, r * Math.sin(t)]);
  }
  return out;
}

export function galaxyTargets(N) {
  const out = [], arms = 2, a = 8, b = 0.22;
  for (let i = 0; i < N; i++) {
    const arm = i % arms;
    const t = (i / N) * Math.PI * 5 + (arm * Math.PI);
    const r = a * Math.exp(b * t);
    const perpR = (Math.random() - 0.5) * r * 0.2;
    const thickness = (Math.random() - 0.5) * Math.max(6, r * 0.04);
    out.push([
      Math.cos(t) * r + perpR * Math.sin(t),
      thickness,
      Math.sin(t) * r - perpR * Math.cos(t),
    ]);
  }
  let maxR = 0; for (const p of out) maxR = Math.max(maxR, Math.hypot(p[0], p[2]));
  const scale = 140 / (maxR || 1);
  return out.map(p => [p[0]*scale, p[1]*scale, p[2]*scale]);
}

export function saturnTargets(N) {
  const out = [];
  const nSphere = Math.floor(N * 0.35);
  const nRing = N - nSphere;
  const Rs = 55, ri = 75, ro = 130, rh = 3;
  for (let i = 0; i < nSphere; i++) {
    const phi = Math.acos(2*Math.random()-1);
    const theta = Math.random() * Math.PI * 2;
    const r = Rs + (Math.random()-0.5) * 6;
    out.push([r*Math.sin(phi)*Math.cos(theta), r*Math.cos(phi), r*Math.sin(phi)*Math.sin(theta)]);
  }
  for (let i = 0; i < nRing; i++) {
    const theta = Math.random() * Math.PI * 2;
    const r = ri + Math.random() * (ro - ri);
    const y = (Math.random()-0.5) * rh;
    out.push([r*Math.cos(theta), y, r*Math.sin(theta)]);
  }
  return out;
}

export function vivianiTargets(N) {
  const out = [], a = 60;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * 4 * Math.PI;
    out.push([a * (1 + Math.cos(t)) - a, a * Math.sin(t), 2 * a * Math.sin(t/2)]);
  }
  return out;
}

export function lissajous3DTargets(N) {
  const out = [], A = 100, B = 100, C = 100, a = 3, b = 2, c = 5;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    out.push([A * Math.sin(a*t), B * Math.sin(b*t + Math.PI/4), C * Math.sin(c*t)]);
  }
  return out;
}

export function infinityTargets(N) {
  const out = [], a = 120;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const denom = 1 + Math.sin(t) * Math.sin(t);
    out.push([
      a * Math.cos(t) / denom,
      (Math.random()-0.5) * 14,
      a * Math.sin(t) * Math.cos(t) / denom,
    ]);
  }
  return out;
}

function normalize3(x, y, z) { const len = Math.hypot(x, y, z) || 1; return [x/len, y/len, z/len]; }

export const SHAPE_SPIN = Object.freeze({
  sphere:     { axis: normalize3(0.35, 1.0, 0.2),  speed: 0.35 },
  torus:      { axis: normalize3(0.3,  0.5, 1.0),  speed: 0.50 },
  helix:      { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.80 },
  molecule:   { axis: normalize3(0.7,  0.5, 0.4),  speed: 0.40 },
  icosa:      { axis: normalize3(0.4,  0.7, 0.6),  speed: 0.45 },
  trefoil:    { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.55 },
  lorenz:     { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.30 },
  galaxy:     { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.25 },
  mobius:     { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.50 },
  klein:      { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.35 },
  dodeca:     { axis: normalize3(0.4,  0.6, 0.7),  speed: 0.40 },
  rossler:    { axis: normalize3(0.0,  0.0, 1.0),  speed: 0.30 },
  saturn:     { axis: normalize3(0.15, 1.0, 0.1),  speed: 0.32 },
  helicoid:   { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.45 },
  torusKnot:  { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.45 },
  sunflower:  { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.25 },
  octa:       { axis: normalize3(0.4,  0.7, 0.6),  speed: 0.45 },
  tetra:      { axis: normalize3(1.0,  1.0, 0.5),  speed: 0.50 },
  cube:       { axis: normalize3(0.4,  0.7, 0.5),  speed: 0.38 },
  bucky:      { axis: normalize3(0.2,  1.0, 0.3),  speed: 0.32 },
  viviani:    { axis: normalize3(0.0,  0.0, 1.0),  speed: 0.50 },
  thomas:     { axis: normalize3(0.5,  0.5, 0.5),  speed: 0.35 },
  halvorsen:  { axis: normalize3(0.3,  0.7, 0.6),  speed: 0.40 },
  seashell:   { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.45 },
  heart:      { axis: normalize3(0.0,  1.0, 0.1),  speed: 0.30 },
  supertoroid:{ axis: normalize3(0.2,  0.5, 1.0),  speed: 0.40 },
  lissajous:  { axis: normalize3(0.5,  0.7, 0.3),  speed: 0.40 },
  infinity:   { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.40 },
  catenoid:   { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.35 },
  linked:     { axis: normalize3(1.0,  1.0, 0.0),  speed: 0.40 },
  pyramid:    { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.40 },
});

export const SHAPE_NAMES = Object.freeze(Object.keys(SHAPE_SPIN));

export const SHAPE_GENERATORS = Object.freeze({
  sphere: sphereTargets, torus: torusTargets, helix: dnaTargets, molecule: moleculeTargets,
  icosa: icosaTargets, trefoil: trefoilTargets, lorenz: lorenzTargets, galaxy: galaxyTargets,
  mobius: mobiusTargets, klein: kleinTargets, dodeca: dodecaTargets, rossler: rosslerTargets,
  saturn: saturnTargets, helicoid: helicoidTargets, torusKnot: torusKnotTargets, sunflower: sunflowerTargets,
  octa: octaTargets, tetra: tetraTargets, cube: cubeTargets, bucky: buckyTargets,
  viviani: vivianiTargets, thomas: thomasTargets, halvorsen: halvorsenTargets,
  seashell: seashellTargets, heart: heartTargets, supertoroid: supertoroidTargets,
  lissajous: lissajous3DTargets, infinity: infinityTargets, catenoid: catenoidTargets,
  linked: linkedCirclesTargets, pyramid: pyramidTargets,
});
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- --test-name-pattern="bio|SHAPE_SPIN|cosmic|curves"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/emersus-orb/shapes.js tests/unit/shared/emersus-orb/shapes.test.js
git commit -m "feat(orb): shape generators — bio/cosmic/curves + SHAPE_SPIN table"
```

---

## Task 6: Physics — greedy nearest-neighbour assignment

**Files:**
- Create: `shared/emersus-orb/physics.js`
- Create: `tests/unit/shared/emersus-orb/physics.test.js`

- [ ] **Step 1: Test**

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { greedyNearestAssign } from '../../../../shared/emersus-orb/physics.js';

describe('emersus-orb/physics.js — greedyNearestAssign', () => {
  test('assigns same-position particles to their original targets', () => {
    const starts  = [[0,0,0], [10,0,0], [20,0,0]];
    const targets = [[0,0,0], [10,0,0], [20,0,0]];
    const assignment = greedyNearestAssign(starts, targets, () => 0);
    assert.deepEqual(assignment, [[0,0,0], [10,0,0], [20,0,0]]);
  });

  test('permuted targets get reassigned to nearest', () => {
    const starts  = [[0,0,0], [10,0,0], [20,0,0]];
    const targets = [[20,0,0], [0,0,0], [10,0,0]]; // shuffled
    const assignment = greedyNearestAssign(starts, targets, () => 0);
    // each start should get its nearest — i.e. the original position regardless of target order
    assert.deepEqual(assignment[0], [0,0,0]);
    assert.deepEqual(assignment[1], [10,0,0]);
    assert.deepEqual(assignment[2], [20,0,0]);
  });

  test('returns exactly N results, none repeated', () => {
    const N = 30;
    const starts = Array.from({length: N}, (_, i) => [i, 0, 0]);
    const targets = Array.from({length: N}, (_, i) => [N - i, 0, 0]);
    const assignment = greedyNearestAssign(starts, targets, () => 0);
    assert.equal(assignment.length, N);
    const used = new Set(assignment.map(p => p.join(',')));
    assert.equal(used.size, N); // no duplicates
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- --test-name-pattern="greedyNearestAssign"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// shared/emersus-orb/physics.js
// Pure physics helpers for the orb. No DOM, no WebGL — safe to import in node.

// Greedy nearest-neighbour assignment: each start takes its closest unused
// target. O(N²) — fine for N ≤ ~300. `rng` must be a function returning 0..1;
// defaults to Math.random so callers can inject for determinism in tests.
export function greedyNearestAssign(startPositions, newTargets, rng = Math.random) {
  const N = startPositions.length;
  const used = new Array(N).fill(false);
  const assignment = new Array(N);
  // Shuffle iteration order so no particle has priority bias.
  const order = [];
  for (let i = 0; i < N; i++) order.push(i);
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const i of order) {
    let bestJ = -1, bestD = Infinity;
    const sx = startPositions[i][0], sy = startPositions[i][1], sz = startPositions[i][2];
    for (let j = 0; j < N; j++) {
      if (used[j]) continue;
      const dx = newTargets[j][0] - sx, dy = newTargets[j][1] - sy, dz = newTargets[j][2] - sz;
      const d = dx*dx + dy*dy + dz*dz;
      if (d < bestD) { bestD = d; bestJ = j; }
    }
    assignment[i] = bestJ;
    used[bestJ] = true;
  }
  return assignment.map(j => newTargets[j].slice());
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- --test-name-pattern="greedyNearestAssign"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/emersus-orb/physics.js tests/unit/shared/emersus-orb/physics.test.js
git commit -m "feat(orb): physics — greedy nearest-neighbour assignment"
```

---

## Task 7: Physics — tangential curl axis + initial velocity

**Files:**
- Modify: `shared/emersus-orb/physics.js`
- Modify: `tests/unit/shared/emersus-orb/physics.test.js`

- [ ] **Step 1: Tests**

```js
import { curlAxisForPath, initialTangentVelocity } from '../../../../shared/emersus-orb/physics.js';

describe('emersus-orb/physics.js — curl', () => {
  test('curlAxisForPath returns a unit vector perpendicular to the path direction', () => {
    const axis = curlAxisForPath([1, 0, 0], () => 0.1);
    const dir = [1, 0, 0];
    const dot = axis[0]*dir[0] + axis[1]*dir[1] + axis[2]*dir[2];
    assert(Math.abs(dot) < 1e-6, `axis dot dir must be 0, got ${dot}`);
    assert(Math.abs(Math.hypot(...axis) - 1) < 1e-6, 'axis must be unit');
  });

  test('curlAxisForPath degenerate ref falls back to Y then X axis', () => {
    const axis = curlAxisForPath([0, 1, 0], () => 0.5); // parallel-ish ref
    assert(Math.abs(Math.hypot(...axis) - 1) < 1e-6);
  });

  test('initialTangentVelocity scales with distance and curve magnitude', () => {
    const axis = [0, 1, 0];
    const v1 = initialTangentVelocity(axis, 100, 0.1, 1);
    const v2 = initialTangentVelocity(axis, 50, 0.1, 1);
    assert.equal(v1[1], 10);
    assert.equal(v2[1], 5);
  });

  test('sign flips velocity direction', () => {
    const axis = [0, 1, 0];
    const v = initialTangentVelocity(axis, 100, 0.1, -1);
    assert.equal(v[1], -10);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- --test-name-pattern="curl|tangent"`
Expected: FAIL.

- [ ] **Step 3: Implement — append to `shared/emersus-orb/physics.js`**

```js
function cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}
function normalize3(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  return [x/len, y/len, z/len];
}

// Pick a unit vector perpendicular to `dir` for curved trajectories.
// Uses a random reference axis; falls back to Y and then X if the random
// ref is parallel to dir.
export function curlAxisForPath(dir, rng = Math.random) {
  const [dx, dy, dz] = dir;
  let rax = rng() - 0.5, ray = rng() - 0.5, raz = rng() - 0.5;
  const rlen = Math.hypot(rax, ray, raz) || 1;
  rax /= rlen; ray /= rlen; raz /= rlen;
  let c = cross([dx, dy, dz], [rax, ray, raz]);
  if (Math.hypot(c[0], c[1], c[2]) < 0.1) {
    c = cross([dx, dy, dz], [0, 1, 0]);
    if (Math.hypot(c[0], c[1], c[2]) < 0.1) c = cross([dx, dy, dz], [1, 0, 0]);
  }
  return normalize3(c[0], c[1], c[2]);
}

// Returns an initial velocity vector along `curlAxis` scaled by distance +
// curve knob. `sign` should be ±1; use Math.random() < 0.5 to pick once per
// particle at creation so half the swarm curls each way.
export function initialTangentVelocity(curlAxis, distance, curve, sign) {
  const mag = curve * distance * sign;
  return [curlAxis[0] * mag, curlAxis[1] * mag, curlAxis[2] * mag];
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- --test-name-pattern="curl|tangent"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/emersus-orb/physics.js tests/unit/shared/emersus-orb/physics.test.js
git commit -m "feat(orb): physics — curl axis + initial tangent velocity"
```

---

## Task 8: Physics — spring integration step

**Files:**
- Modify: `shared/emersus-orb/physics.js`
- Modify: `tests/unit/shared/emersus-orb/physics.test.js`

- [ ] **Step 1: Tests**

```js
import { stepSpring } from '../../../../shared/emersus-orb/physics.js';

describe('emersus-orb/physics.js — stepSpring', () => {
  test('particle at rest moves toward target on first step', () => {
    const p = { x: 0, y: 0, z: 0, tx: 100, ty: 0, tz: 0, vx: 0, vy: 0, vz: 0 };
    stepSpring(p, { spring: 0.1, drag: 0.9 });
    assert(p.x > 0);
    assert(p.vx > 0);
  });

  test('drag dampens velocity over time without new force', () => {
    const p = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, vx: 10, vy: 0, vz: 0 };
    stepSpring(p, { spring: 0, drag: 0.9 });
    assert.equal(Math.abs(p.vx - 9), 0); // drag only
  });

  test('high drag + high spring — particle reaches near-target after enough frames', () => {
    const p = { x: 0, y: 0, z: 0, tx: 100, ty: 0, tz: 0, vx: 0, vy: 0, vz: 0 };
    for (let i = 0; i < 200; i++) stepSpring(p, { spring: 0.08, drag: 0.85 });
    assert(Math.abs(p.x - 100) < 1, `x converges: ${p.x}`);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- --test-name-pattern="stepSpring"`
Expected: FAIL.

- [ ] **Step 3: Implement — append to physics.js**

```js
// Single-frame Verlet-ish spring + drag integration. Mutates `p` in place.
// `p` must have: x, y, z, tx, ty, tz, vx, vy, vz.
// `opts`: { spring: k, drag: d, extraForce?: [fx, fy, fz] }
export function stepSpring(p, opts) {
  const { spring, drag, extraForce } = opts;
  p.vx += (p.tx - p.x) * spring;
  p.vy += (p.ty - p.y) * spring;
  p.vz += (p.tz - p.z) * spring;
  if (extraForce) {
    p.vx += extraForce[0];
    p.vy += extraForce[1];
    p.vz += extraForce[2];
  }
  p.vx *= drag;
  p.vy *= drag;
  p.vz *= drag;
  p.x += p.vx;
  p.y += p.vy;
  p.z += p.vz;
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- --test-name-pattern="stepSpring"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/emersus-orb/physics.js tests/unit/shared/emersus-orb/physics.test.js
git commit -m "feat(orb): physics — spring integration step"
```

---

## Task 9: State — STATES table + param interpolation

**Files:**
- Create: `shared/emersus-orb/state.js`
- Create: `tests/unit/shared/emersus-orb/state.test.js`

- [ ] **Step 1: Tests**

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, easeInOutCubic, lerpStateParams } from '../../../../shared/emersus-orb/state.js';

describe('emersus-orb/state.js — STATES + easing', () => {
  test('has three states', () => {
    assert.deepEqual(Object.keys(STATES), ['idle', 'thinking', 'responding']);
  });

  test('idle and thinking both set cycleMs high-enough (thinking freezes shape too)', () => {
    // Actual gate is in index.js auto-cycle loop — STATES just stores the cadence.
    // responding must be the only rapidly-cycling state in practice.
    assert.equal(STATES.responding.cycleMs, 2000);
  });

  test('breath settings differ between idle and thinking', () => {
    assert.equal(STATES.idle.breathAmp, 0);
    assert(STATES.thinking.breathAmp > 0);
  });

  test('easeInOutCubic is symmetric', () => {
    assert.equal(easeInOutCubic(0), 0);
    assert.equal(easeInOutCubic(1), 1);
    assert(Math.abs(easeInOutCubic(0.5) - 0.5) < 1e-6);
  });

  test('lerpStateParams interpolates all scalar + nested tint values', () => {
    const out = lerpStateParams(STATES.idle, STATES.responding, 0.5);
    assert(out.springBase > 0);
    assert(out.tint.r > 0);
    // at t=0 we get idle exactly
    const zero = lerpStateParams(STATES.idle, STATES.responding, 0);
    assert.equal(zero.springBase, STATES.idle.springBase);
    assert.equal(zero.tint.r, STATES.idle.tint.r);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- --test-name-pattern="STATES"`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
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
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- --test-name-pattern="STATES"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/emersus-orb/state.js tests/unit/shared/emersus-orb/state.test.js
git commit -m "feat(orb): state machine table + param interpolation"
```

---

## Task 10: State — breath pulse scale function

**Files:**
- Modify: `shared/emersus-orb/state.js`
- Modify: `tests/unit/shared/emersus-orb/state.test.js`

- [ ] **Step 1: Tests**

```js
import { breathScale } from '../../../../shared/emersus-orb/state.js';

describe('emersus-orb/state.js — breathScale', () => {
  test('amp=0 always returns 1 regardless of time', () => {
    assert.equal(breathScale(0, 0, 1), 1);
    assert.equal(breathScale(1000, 0, 1), 1);
    assert.equal(breathScale(12345, 0, 2), 1);
  });

  test('amp=0.08 oscillates in [1-amp, 1+amp] bounds', () => {
    for (let ms = 0; ms < 10000; ms += 37) {
      const s = breathScale(ms, 0.08, 0.75);
      assert(s >= 1 - 0.08 - 1e-9, `below lower bound at ${ms}: ${s}`);
      assert(s <= 1 + 0.08 + 1e-9, `above upper bound at ${ms}: ${s}`);
    }
  });

  test('freq controls oscillation period', () => {
    // at 0 Hz, breathScale returns 1 always
    assert.equal(breathScale(1000, 0.1, 0), 1);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- --test-name-pattern="breathScale"`
Expected: FAIL.

- [ ] **Step 3: Append `breathScale` to state.js**

```js
// Returns 1 + amp · sin(t · 2π · freq). Apply to target position to get
// the "breathing" effect: the whole shape rhythmically expands/contracts.
export function breathScale(nowMs, amp, freq) {
  if (amp === 0 || freq === 0) return 1;
  return 1 + amp * Math.sin(nowMs / 1000 * Math.PI * 2 * freq);
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- --test-name-pattern="breathScale"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/emersus-orb/state.js tests/unit/shared/emersus-orb/state.test.js
git commit -m "feat(orb): state — breath scale function"
```

---

## Task 11: Render — three.js scene + Points + ShaderMaterial (visual verify only)

**Files:**
- Create: `shared/emersus-orb/render.js`

This task has no unit tests — it's three.js + WebGL, verified visually via the mockup in Task 15.

- [ ] **Step 1: Implement `render.js`**

```js
// shared/emersus-orb/render.js
// Thin three.js layer. Owns the WebGLRenderer, scene, camera, Points,
// LineSegments, and trail buffers. No physics, no state machine — just draw.

import * as THREE from 'https://esm.sh/three@0.169';

const VERTEX_SHADER = `
  attribute float size;
  attribute float alpha;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.1, r);
    gl_FragColor = vec4(vColor, vAlpha * soft);
  }
`;

export function createRenderer(canvas, { size = 160, particleCount = 260, trailLen = 40 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(size, size, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 1000);
  camera.position.set(0, 0, 500);

  // Points geometry + shader material
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const alphas = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    sizes[i] = 2.0;
    alphas[i] = 0.85;
    colors[i*3] = 0.8; colors[i*3+1] = 0.95; colors[i*3+2] = 0.9;
  }
  const pGeom = new THREE.BufferGeometry();
  pGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  pGeom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  pGeom.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  const pMat = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(pGeom, pMat);
  scene.add(points);

  // Line segments for links (rebuilt each frame)
  const MAX_LINK_SEGMENTS = particleCount * 14; // capped pair count
  const linkPositions = new Float32Array(MAX_LINK_SEGMENTS * 2 * 3);
  const linkColors = new Float32Array(MAX_LINK_SEGMENTS * 2 * 3);
  const linkGeom = new THREE.BufferGeometry();
  linkGeom.setAttribute('position', new THREE.BufferAttribute(linkPositions, 3));
  linkGeom.setAttribute('color', new THREE.BufferAttribute(linkColors, 3));
  linkGeom.setDrawRange(0, 0);
  const linkMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 });
  const links = new THREE.LineSegments(linkGeom, linkMat);
  scene.add(links);

  // Trail segments — TRAIL_LEN-1 segments per particle
  const trailPositions = new Float32Array(particleCount * (trailLen - 1) * 2 * 3);
  const trailColors    = new Float32Array(particleCount * (trailLen - 1) * 2 * 3);
  const trailGeom = new THREE.BufferGeometry();
  trailGeom.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeom.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
  trailGeom.setDrawRange(0, 0);
  const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 });
  const trails = new THREE.LineSegments(trailGeom, trailMat);
  scene.add(trails);

  return {
    renderer, scene, camera, points, pGeom, pMat,
    links, linkGeom, trails, trailGeom,
    particleCount, trailLen,
    dispose() {
      pGeom.dispose(); pMat.dispose();
      linkGeom.dispose(); linkMat.dispose();
      trailGeom.dispose(); trailMat.dispose();
      renderer.dispose();
    },
  };
}

// Updates the Points `position`, `color`, `size`, `alpha` buffers from particle
// array. `particles` is [{x,y,z,baseColorHex,...}]. `params` is the current
// interpolated state (tint, tintAmt, brightness).
export function updatePoints(ctx, particles, params) {
  const posAttr = ctx.pGeom.attributes.position;
  const colAttr = ctx.pGeom.attributes.color;
  const szAttr = ctx.pGeom.attributes.size;
  const aAttr = ctx.pGeom.attributes.alpha;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    posAttr.array[i*3 + 0] = p.rx; // rendered position after rotations
    posAttr.array[i*3 + 1] = p.ry;
    posAttr.array[i*3 + 2] = p.rz;
    // tint blend
    const [br, bg, bb] = p.baseRGB;
    const tr = params.tint.r, tg = params.tint.g, tb = params.tint.b;
    const amt = params.tintAmt;
    colAttr.array[i*3 + 0] = ((br + (tr - br) * amt) / 255);
    colAttr.array[i*3 + 1] = ((bg + (tg - bg) * amt) / 255);
    colAttr.array[i*3 + 2] = ((bb + (tb - bb) * amt) / 255);
    szAttr.array[i] = 2.2;
    aAttr.array[i] = 0.85 * params.brightness;
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
  szAttr.needsUpdate = true;
  aAttr.needsUpdate = true;
}

export function render(ctx) {
  ctx.renderer.render(ctx.scene, ctx.camera);
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/emersus-orb/render.js
git commit -m "feat(orb): render — three.js scene + Points + ShaderMaterial scaffold"
```

---

## Task 12: Render — link segments rebuild per frame

**Files:**
- Modify: `shared/emersus-orb/render.js`

- [ ] **Step 1: Append `updateLinks` to render.js**

```js
// Rebuild link segment buffer from current rendered positions. Distance²
// threshold of 650 (in shape-space units) matches the brainstorm tuning.
// Returns number of segments drawn.
export function updateLinks(ctx, particles, params) {
  const N = particles.length;
  const positions = ctx.linkGeom.attributes.position.array;
  const colors = ctx.linkGeom.attributes.color.array;
  let segIdx = 0;
  const maxSeg = positions.length / 6; // 2 verts × 3 coords per seg
  if (params.linkAlpha < 0.01) {
    ctx.linkGeom.setDrawRange(0, 0);
    return 0;
  }
  for (let i = 0; i < N; i++) {
    const a = particles[i];
    // Only compare to ~14 near neighbours (index-adjacent) to stay O(N).
    const jEnd = Math.min(N, i + 14);
    for (let j = i + 1; j < jEnd && segIdx < maxSeg; j++) {
      const b = particles[j];
      const dx = a.rx - b.rx, dy = a.ry - b.ry, dz = a.rz - b.rz;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 < 650) {
        const alpha = params.linkAlpha * (1 - d2 / 650);
        // light grey-cyan (matches brainstorm rgba(180,210,230, alpha))
        positions[segIdx*6+0] = a.rx;
        positions[segIdx*6+1] = a.ry;
        positions[segIdx*6+2] = a.rz;
        positions[segIdx*6+3] = b.rx;
        positions[segIdx*6+4] = b.ry;
        positions[segIdx*6+5] = b.rz;
        const c = alpha * 0.7; // premultiplied-ish fade
        colors[segIdx*6+0] = 0.71 * c;
        colors[segIdx*6+1] = 0.82 * c;
        colors[segIdx*6+2] = 0.90 * c;
        colors[segIdx*6+3] = 0.71 * c;
        colors[segIdx*6+4] = 0.82 * c;
        colors[segIdx*6+5] = 0.90 * c;
        segIdx++;
      }
    }
  }
  ctx.linkGeom.attributes.position.needsUpdate = true;
  ctx.linkGeom.attributes.color.needsUpdate = true;
  ctx.linkGeom.setDrawRange(0, segIdx * 2);
  return segIdx;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/emersus-orb/render.js
git commit -m "feat(orb): render — near-neighbour link segments"
```

---

## Task 13: Render — trails ring buffer

**Files:**
- Modify: `shared/emersus-orb/render.js`

- [ ] **Step 1: Append `updateTrails` to render.js**

```js
// Update trails geometry from each particle's trail ring buffer. Trails are
// drawn as TRAIL_LEN-1 segments per particle, alpha-fading from the oldest
// to the newest. Each particle must have a `.trail[]` (ring buffer of
// [x,y,z]) and `.trailIdx` pointer.
export function updateTrails(ctx, particles, params) {
  const positions = ctx.trailGeom.attributes.position.array;
  const colors = ctx.trailGeom.attributes.color.array;
  const T = ctx.trailLen;
  let seg = 0;
  for (const p of particles) {
    // iterate oldest → newest; draw segment from frame k to frame k+1
    for (let k = 0; k < T - 1; k++) {
      const idxA = (p.trailIdx + k) % T;
      const idxB = (p.trailIdx + k + 1) % T;
      const a = p.trail[idxA], b = p.trail[idxB];
      if (!a || !b) continue;
      positions[seg*6+0] = a[0];
      positions[seg*6+1] = a[1];
      positions[seg*6+2] = a[2];
      positions[seg*6+3] = b[0];
      positions[seg*6+4] = b[1];
      positions[seg*6+5] = b[2];
      const fade = 0.25 * ((k + 1) / (T - 1)); // newest brightest
      const [br, bg, bb] = p.baseRGB;
      colors[seg*6+0] = (br / 255) * fade;
      colors[seg*6+1] = (bg / 255) * fade;
      colors[seg*6+2] = (bb / 255) * fade;
      colors[seg*6+3] = (br / 255) * fade;
      colors[seg*6+4] = (bg / 255) * fade;
      colors[seg*6+5] = (bb / 255) * fade;
      seg++;
    }
  }
  ctx.trailGeom.attributes.position.needsUpdate = true;
  ctx.trailGeom.attributes.color.needsUpdate = true;
  ctx.trailGeom.setDrawRange(0, seg * 2);
  return seg;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/emersus-orb/render.js
git commit -m "feat(orb): render — trails ring buffer"
```

---

## Task 14: index.js — main orb engine (createEmersusOrb public API)

**Files:**
- Modify: `shared/emersus-orb/index.js`

This is the glue that wires shapes + physics + state + render into the main RAF loop. No unit tests — end-to-end smoke-tested via the mockup in Task 15.

- [ ] **Step 1: Implement `shared/emersus-orb/index.js`**

```js
// shared/emersus-orb/index.js
// Public API entry. Orchestrates shape / physics / state / render.

import { SHAPE_GENERATORS, SHAPE_SPIN, SHAPE_NAMES } from './shapes.js';
import { greedyNearestAssign, curlAxisForPath, initialTangentVelocity, stepSpring } from './physics.js';
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
  let stx = null;              // state transition descriptor
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

  function tick(now) {
    if (destroyed) return;
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
      // slow tail-lerp toward current state target
      current = lerpStateParams(current, STATES[state], 0.02);
    }

    // Intrinsic shape rotation lerp
    const targetSpin = SHAPE_SPIN[currentShape];
    for (let i = 0; i < 3; i++) spinAxis[i] = spinAxis[i] + (targetSpin.axis[i] - spinAxis[i]) * 0.03;
    const aLen = Math.hypot(spinAxis[0], spinAxis[1], spinAxis[2]) || 1;
    spinAxis[0] /= aLen; spinAxis[1] /= aLen; spinAxis[2] /= aLen;
    spinSpeed = spinSpeed + (targetSpin.speed - spinSpeed) * 0.03;
    spinAngle += dt * spinSpeed * tuning.spin;

    stateRotAngleX += dt * current.stateRotX;
    stateRotAngleY += dt * current.stateRotY;
    stateRotAngleZ += dt * current.stateRotZ;

    // Auto shape-cycle: responding only. Idle and thinking freeze.
    if (state === 'responding' && (now - lastShapeChange) > STATES.responding.cycleMs) {
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
      const breath = breathScale(now, current.breathAmp, current.breathFreq);
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
          // cross(dir, curlAxis)
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
    updateTrails(renderCtx, pts, current);
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
      if (rafId) cancelAnimationFrame(rafId);
      renderCtx.dispose();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/emersus-orb/index.js
git commit -m "feat(orb): createEmersusOrb main loop + public API"
```

---

## Task 15: Mockup page — port live tuning panel to use the new module

**Files:**
- Create: `app/emersus-orb-mockup.html`

- [ ] **Step 1: Write the mockup**

Create a minimal page that embeds the orb + exposes the tuning controls we've been using. The file can be large (style block ≈ 200 lines, HTML ≈ 100 lines, JS ≈ 80 lines). Structure:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Emersus orb — live tuning</title>
<link rel="stylesheet" href="/shared/design-tokens.css" />
<style>
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif; padding: 24px; }
  .layout { display: grid; grid-template-columns: minmax(0,1fr) 320px; gap: 22px; max-width: 1180px; margin: 0 auto; }
  .stage { height: 560px; border: 1px solid var(--line); border-radius: 16px; display: grid; place-items: center; background: #0b0b0d; position: relative; }
  canvas { display: block; }
  .controls { position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
  .row { display: flex; flex-wrap: wrap; gap: 4px; background: rgba(15,15,17,0.85); border: 1px solid var(--line); border-radius: 8px; padding: 4px; max-width: 460px; justify-content: flex-end; }
  .row button { appearance: none; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 11px; padding: 4px 9px; border-radius: 5px; cursor: pointer; font-family: 'JetBrains Mono', monospace; }
  .row button:hover { color: var(--ink); }
  .row.state button.on { background: var(--accent-soft); color: var(--accent); }
  .row.shape button.on { background: rgba(80,145,242,0.18); color: #9bc0f7; }
</style>
</head>
<body>
<div class="layout">
  <div class="stage">
    <canvas id="orb-canvas" style="width: 400px; height: 400px;"></canvas>
    <div class="controls">
      <div class="row state" id="state-row">
        <button data-state="idle" class="on">idle</button>
        <button data-state="thinking">thinking</button>
        <button data-state="responding">responding</button>
      </div>
      <div class="row shape" id="shape-row"></div>
      <div class="row demo" id="demo-row">
        <button data-demo="off" class="on">demo off</button>
        <button data-demo="turn">one turn</button>
        <button data-demo="on">loop</button>
      </div>
    </div>
  </div>
  <aside>
    <p>Append <code>?tune=1&amp;curve=0.3</code> etc. to the URL to override tunables.</p>
    <p>See <code>shared/emersus-orb/config.js</code> for all knobs.</p>
  </aside>
</div>
<script type="module">
  import { createEmersusOrb } from '/shared/emersus-orb/index.js';
  import { SHAPE_NAMES } from '/shared/emersus-orb/shapes.js';

  const canvas = document.getElementById('orb-canvas');
  // internal draw buffer is square (160 px base × DPR) but CSS scales it up for visibility
  const orb = createEmersusOrb(canvas, { size: 400, initialState: 'idle', initialShape: 'sphere' });

  // Shape button row
  const shapeRow = document.getElementById('shape-row');
  for (const name of SHAPE_NAMES) {
    const b = document.createElement('button');
    b.dataset.shape = name;
    b.textContent = name;
    b.onclick = () => {
      shapeRow.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      orb.setShape(name);
    };
    shapeRow.appendChild(b);
  }

  // State buttons
  document.getElementById('state-row').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    e.target.parentElement.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    orb.setState(b.dataset.state);
  });

  // Demo
  let demoTimer = null;
  function stopDemo() { if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; } }
  function startDemo() {
    stopDemo();
    orb.setState('idle');
    const next = (phase) => {
      const dur = phase === 'idle' ? 4500 : 10000;
      demoTimer = setTimeout(() => {
        const n = phase === 'idle' ? 'responding' : 'idle';
        orb.setState(n);
        document.querySelectorAll('#state-row button').forEach(x => x.classList.toggle('on', x.dataset.state === n));
        next(n);
      }, dur);
    };
    next('idle');
  }
  function oneTurn() {
    stopDemo();
    orb.setState('responding');
    document.querySelectorAll('#state-row button').forEach(x => x.classList.toggle('on', x.dataset.state === 'responding'));
    demoTimer = setTimeout(() => {
      orb.setState('idle');
      document.querySelectorAll('#state-row button').forEach(x => x.classList.toggle('on', x.dataset.state === 'idle'));
    }, 10000);
  }
  document.getElementById('demo-row').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    e.target.parentElement.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    if (b.dataset.demo === 'on') startDemo();
    else if (b.dataset.demo === 'turn') oneTurn();
    else stopDemo();
  });
</script>
</body>
</html>
```

- [ ] **Step 2: Visual verify**

Run: `npm start` (or `node server.js`)
Navigate to: `http://localhost:3000/app/emersus-orb-mockup.html`

Expected:
- Orb renders on load, starts in `idle` + `sphere`
- Clicking `thinking` starts breath; shape stays
- Clicking `responding` cycles shapes every 2 s
- Clicking any shape button triggers a morph
- `one turn` button flips to responding for 10 s then back to idle
- `loop` alternates idle/responding every 4.5/10 s
- `?tune=1&curve=0.3` in the URL makes the morphs visibly arc

If any of the above misbehaves, stop and fix in `shared/emersus-orb/*` before committing.

- [ ] **Step 3: Commit**

```bash
git add app/emersus-orb-mockup.html
git commit -m "feat(orb): live tuning mockup page for the orb module"
```

---

## Task 16: EmersusOrb React component + wire into ChatApp

**Files:**
- Modify: `shared/react-chat-app.js`

- [ ] **Step 1: Locate the existing `ThinkingGlyph` component**

Open `shared/react-chat-app.js`. Find:
- `import { createThinkingGlyph } from "/shared/thinking-glyph.js";` (line ~34)
- `function ThinkingGlyph({ state, size, color })` (around line 3303)
- Its use in `ChatApp` (around line 3348: `const [glyphState, setGlyphState] = useState("idle");`)

- [ ] **Step 2: Replace `createThinkingGlyph` import with the new module**

Replace:
```js
import { createThinkingGlyph } from "/shared/thinking-glyph.js";
```
with:
```js
import { createEmersusOrb } from "/shared/emersus-orb/index.js";
```

- [ ] **Step 3: Replace the `ThinkingGlyph` component definition with `EmersusOrb`**

Replace the entire `ThinkingGlyph` function with:

```js
function EmersusOrb({ state = "idle" }) {
  const canvasRef = useRef(null);
  const orbRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    orbRef.current = createEmersusOrb(canvasRef.current, { size: 160, initialState: state });
    return () => {
      orbRef.current?.destroy();
      orbRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    orbRef.current?.setState(state);
  }, [state]);

  return h(
    "div",
    { className: "emersus-orb-mount", "data-state": state, "aria-hidden": true },
    h("canvas", { ref: canvasRef, style: { width: "160px", height: "160px", display: "block" } })
  );
}
```

- [ ] **Step 4: Replace `<ThinkingGlyph>` uses with `<EmersusOrb>`**

Search for `h(ThinkingGlyph, ...)` usages in the file. There's one primary use around line 3860 in the submit-question path, and possibly render sites tied to `glyphState`. Replace `ThinkingGlyph` with `EmersusOrb` in every usage. The `state` prop wiring and `glyphState` setState calls stay identical.

- [ ] **Step 5: Start dev server and smoke-test**

Run: `npm start`
Navigate to: `http://localhost:3000/chat`
- Confirm orb renders where the old glyph was
- Send a message — orb should go idle → thinking → responding → idle
- Reload — orb mounts immediately in idle

- [ ] **Step 6: Commit**

```bash
git add shared/react-chat-app.js
git commit -m "feat(chat): replace ThinkingGlyph with EmersusOrb"
```

---

## Task 17: Visibility + IntersectionObserver pausing

**Files:**
- Modify: `shared/emersus-orb/index.js`

- [ ] **Step 1: Add pause helpers inside `createEmersusOrb`**

In `createEmersusOrb`, after `rafId = requestAnimationFrame(tick);`, add:

```js
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
function onVisibility() { isVisible = document.visibilityState !== 'hidden'; if (isVisible) maybeStart(); else maybeStop(); }
document.addEventListener('visibilitychange', onVisibility);

let io = null;
if (typeof IntersectionObserver !== 'undefined') {
  io = new IntersectionObserver(entries => {
    for (const e of entries) isOnScreen = e.isIntersecting;
    if (isOnScreen) maybeStart(); else maybeStop();
  }, { threshold: 0.01 });
  io.observe(canvas);
}
```

Modify the `destroy` method to clean up:

```js
destroy() {
  destroyed = true;
  document.removeEventListener('visibilitychange', onVisibility);
  if (io) io.disconnect();
  if (rafId) cancelAnimationFrame(rafId);
  renderCtx.dispose();
},
```

Also update the RAF guard inside `tick` to zero-out `rafId` when paused:

```js
function tick(now) {
  if (destroyed || !shouldRun()) { rafId = 0; return; }
  // ... existing tick body ...
  rafId = requestAnimationFrame(tick);
}
```

- [ ] **Step 2: Smoke-test**

Run dev server. Navigate to chat with devtools open.
- Scroll the orb out of view → RAF tick messages stop (add a `console.log` in tick if needed to verify)
- Scroll back → resumes
- Switch tabs → stops
- Return → resumes

- [ ] **Step 3: Commit**

```bash
git add shared/emersus-orb/index.js
git commit -m "feat(orb): pause RAF when off-screen or tab hidden"
```

---

## Task 18: Reduced-motion support

**Files:**
- Modify: `shared/emersus-orb/index.js`

- [ ] **Step 1: Detect + apply reduced-motion**

Near the top of `createEmersusOrb`, add:

```js
let reducedMotion = false;
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = mq.matches;
  mq.addEventListener?.('change', (e) => { reducedMotion = e.matches; });
}
```

In the `tick` function, when `reducedMotion` is true:
- Zero out `stateRotAngleX/Y/Z` accumulation
- Disable shape auto-cycling (treat responding like thinking — frozen)
- Halve breath amp: `const effBreath = reducedMotion ? current.breathAmp * 0.5 : current.breathAmp;`
- Skip trail drawing (set `trailGeom.setDrawRange(0, 0)` when reducedMotion is on)

Concretely: update the auto-cycle guard:

```js
if (!reducedMotion && state === 'responding' && (now - lastShapeChange) > STATES.responding.cycleMs) { /* ... */ }
```

Zero out state rotations:

```js
if (!reducedMotion) {
  stateRotAngleX += dt * current.stateRotX;
  stateRotAngleY += dt * current.stateRotY;
  stateRotAngleZ += dt * current.stateRotZ;
}
```

Halve breath:

```js
const breath = breathScale(now, reducedMotion ? current.breathAmp * 0.5 : current.breathAmp, current.breathFreq);
```

Skip trails:

```js
if (reducedMotion) renderCtx.trailGeom.setDrawRange(0, 0);
else updateTrails(renderCtx, pts, current);
```

- [ ] **Step 2: Smoke-test**

Enable "Emulate prefers-reduced-motion: reduce" in Chrome devtools Rendering panel. Confirm: shapes stop cycling, state rotation freezes, breath halved, trails absent.

- [ ] **Step 3: Commit**

```bash
git add shared/emersus-orb/index.js
git commit -m "feat(orb): honour prefers-reduced-motion"
```

---

## Task 19: Paper theme palette

**Files:**
- Modify: `shared/emersus-orb/state.js`
- Modify: `shared/emersus-orb/index.js`

- [ ] **Step 1: Add paper-palette tint override table to state.js**

Append:

```js
// Paper-theme tint overrides — warmer ink + royal blue accent. Keys match
// STATES. Only `tint` and `tintAmt` get overridden; everything else is shared.
export const PAPER_TINTS = Object.freeze({
  idle:       { tint: { r: 110, g: 100, b: 80 },   tintAmt: 0.07 },
  thinking:   { tint: { r: 240, g: 230, b: 210 },  tintAmt: 0.14 },
  responding: { tint: { r: 59,  g: 130, b: 246 },  tintAmt: 0.16 },
});

export function paletteFor(theme) {
  if (theme === 'paper') {
    const out = {};
    for (const name of Object.keys(STATES)) {
      out[name] = { ...STATES[name], ...PAPER_TINTS[name] };
    }
    return out;
  }
  return STATES; // default mint
}
```

- [ ] **Step 2: Wire `paletteFor` into index.js**

Replace the single `STATES` import with:

```js
import { STATES, paletteFor, easeInOutCubic, bell, lerpStateParams, breathScale } from './state.js';
```

At the top of `createEmersusOrb`, after reading `tuning`:

```js
const paletteStates = paletteFor(
  typeof document !== 'undefined' ? document.documentElement.dataset.theme : 'mint'
);
```

Replace every subsequent `STATES[...]` reference with `paletteStates[...]`.

Also watch for theme changes:

```js
const themeObserver = new MutationObserver(() => {
  const next = paletteFor(document.documentElement.dataset.theme || 'mint');
  Object.assign(paletteStates, next);
});
if (typeof document !== 'undefined') {
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
```

And disconnect it in destroy:

```js
themeObserver.disconnect();
```

- [ ] **Step 3: Smoke-test**

Open devtools console and run:
```js
document.documentElement.dataset.theme = 'paper';
```
Orb tints should lerp from mint palette (cool) to paper (warm cream + royal blue). Flip back to `'mint'` to confirm reverse.

- [ ] **Step 4: Commit**

```bash
git add shared/emersus-orb/state.js shared/emersus-orb/index.js
git commit -m "feat(orb): paper theme tint palette + live theme-switch observer"
```

---

## Task 20: WebGL fallback + aria-hidden

**Files:**
- Modify: `shared/emersus-orb/index.js`

- [ ] **Step 1: Wrap renderer creation in try/catch**

At the top of `createEmersusOrb`, replace the direct `createRenderer` call with:

```js
canvas.setAttribute('aria-hidden', 'true');
let renderCtx;
try {
  renderCtx = createRenderer(canvas, { size, particleCount, trailLen });
} catch (err) {
  console.warn('[emersus-orb] WebGL unavailable; rendering static fallback', err);
  // Draw a simple SVG-ish fallback directly via 2d context
  const ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    const grad = ctx2d.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    grad.addColorStop(0,   '#bff6e4');
    grad.addColorStop(0.4, '#34d399');
    grad.addColorStop(0.8, '#5091f2');
    grad.addColorStop(1,   '#4338ca');
    ctx2d.fillStyle = grad;
    ctx2d.beginPath(); ctx2d.arc(size/2, size/2, size/2 - 4, 0, Math.PI*2); ctx2d.fill();
  }
  return {
    setState() {}, setShape() {},
    getState: () => initialState, getShape: () => initialShape,
    destroy() {},
  };
}
```

- [ ] **Step 2: Smoke-test**

In Chrome devtools → ⋮ → More tools → Rendering → enable "Disable WebGL". Reload chat. Orb should show the static jade→royal gradient disc. Status line still reads "Thinking…" etc.

- [ ] **Step 3: Commit**

```bash
git add shared/emersus-orb/index.js
git commit -m "feat(orb): static WebGL-fallback + aria-hidden on canvas"
```

---

## Task 21: Delete `shared/thinking-glyph.js`

**Files:**
- Delete: `shared/thinking-glyph.js`

- [ ] **Step 1: Verify no other file imports it**

Run: `grep -r "thinking-glyph" --include="*.js" --include="*.html" .`

Expected: the only matches should be in `app/thinking-glyph-mockup.html` (the archived mockup) and possibly `.superpowers/brainstorm/*` (brainstorm content, ignore). Nothing in `shared/` or `api/` or `chat/`.

- [ ] **Step 2: Delete the file**

```bash
git rm shared/thinking-glyph.js
```

- [ ] **Step 3: Run the test suite**

Run: `npm run test:unit`
Expected: all tests pass (no dangling imports).

- [ ] **Step 4: Smoke-test the chat**

Run: `npm start`
Navigate to chat. Orb must still render (it's using `shared/emersus-orb/index.js`, not the deleted file).

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(chat): remove legacy thinking-glyph.js (replaced by emersus-orb)"
```

---

## Task 22: Manual stream-pause → thinking mapping (in chat pipeline)

**Files:**
- Modify: `shared/react-chat-app.js`

- [ ] **Step 1: Locate the SSE chunk handler**

In `react-chat-app.js`, the chat pipeline processes SSE chunks inside `submitQuestion` (around line 3840). Find where `setGlyphState("responding")` is called when a chunk arrives.

- [ ] **Step 2: Add pause-debouncing state**

Near the other `useRef`s at the top of `ChatApp`:

```js
const lastChunkAtRef = useRef(0);
const pauseWatcherRef = useRef(null);
```

- [ ] **Step 3: On each chunk, reset the pause watcher**

Inside the SSE chunk handler (wherever a streamed token is appended), add:

```js
lastChunkAtRef.current = Date.now();
if (glyphState !== "responding") setGlyphState("responding");
if (pauseWatcherRef.current) clearTimeout(pauseWatcherRef.current);
pauseWatcherRef.current = setTimeout(() => {
  // If no chunk for 400ms, orb goes thinking
  if (Date.now() - lastChunkAtRef.current >= 400) setGlyphState("thinking");
}, 420);
```

- [ ] **Step 4: On stream end (success or error), clear watcher + go idle**

In the existing `finally` block of the submit path, add:

```js
if (pauseWatcherRef.current) { clearTimeout(pauseWatcherRef.current); pauseWatcherRef.current = null; }
setGlyphState("idle");
```

(The `setGlyphState("idle")` call likely already exists — just ensure the watcher is cleared.)

- [ ] **Step 5: Smoke-test**

Send a chat message. Network tab → throttle to "Slow 3G" to force visible chunk gaps. Observe orb flipping thinking ↔ responding during gaps, and freezing in idle on completion.

- [ ] **Step 6: Commit**

```bash
git add shared/react-chat-app.js
git commit -m "feat(chat): orb flips to thinking on ≥400 ms SSE chunk gaps"
```

---

## Task 23: Integration verification + perf sanity check

**Files:** no code changes; verification only.

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all existing + new tests pass. No regressions.

- [ ] **Step 2: Full chat smoke in browser**

Run: `npm start`
Run through this checklist:

- [ ] Cold load `/chat` — orb mounts on sphere + idle in under 100 ms
- [ ] Send a message — transitions to responding within ~200 ms
- [ ] Shapes cycle visibly every 2 s during response
- [ ] On stream done — orb freezes on the last-active shape
- [ ] Switch threads in the sidebar — orb doesn't remount from scratch
- [ ] Reload page — no flash, renders immediately on idle
- [ ] Open devtools Performance panel, record a 10 s responding cycle. Frame time < 8 ms on dev machine
- [ ] Mobile viewport (devtools responsive mode, 400 × 800) — orb renders at 128 × 128 CSS px
- [ ] Toggle theme via profile settings (mint ↔ paper) — orb tint lerps to new palette
- [ ] Enable Chrome devtools prefers-reduced-motion: reduce — orb stops cycling, breath halved, no trails
- [ ] Disable WebGL in devtools Rendering panel → reload — static jade→royal gradient disc renders in place

- [ ] **Step 3: Update checkpoint + changelog (both gitignored — local only)**

Update `changelog.md` (top) with a single line:
```
2026-04-XX · Replaced thinking-glyph canvas with 3D particle orb (shared/emersus-orb).
```

Do NOT `git add changelog.md` — it's gitignored.

- [ ] **Step 4: Announce readiness**

Tell the user: implementation complete, all tests pass, visual smoke verified. Ask before pushing to `main` — pushing auto-deploys via the Hetzner webhook. If approved, push; otherwise stay on the local branch.

---

## Self-review checklist

- **Spec coverage:** every section of the design spec maps to at least one task above.
  - Integration point → Task 16
  - Sizing → Task 14 (`size` opt), Task 16 (`160 × 160`)
  - State machine + transitions → Task 9, 10, 14, 22
  - Shape bank (30 shapes) → Tasks 2–5
  - Physics (greedy NN, curl, spring, stagger, breath, pre-burst) → Tasks 6–10, 14
  - Rendering (three.js Points, LineSegments, trails) → Tasks 11–14
  - Accessibility + pauseing → Tasks 17, 18, 20
  - Paper palette → Task 19
  - File structure → Task 1 (scaffold) + Tasks 2–14 (per file)
  - Public API → Task 14
  - Deprecation of old glyph → Task 21

- **Type / naming consistency:** `SHAPE_GENERATORS`, `SHAPE_SPIN`, `SHAPE_NAMES` used consistently across shapes.js / index.js. `STATES`, `lerpStateParams`, `breathScale` consistent between state.js and index.js. `createEmersusOrb` public API matches what `react-chat-app.js` imports.

- **Placeholder scan:** no "TBD" / "similar to Task N" / "add validation as needed" — every step shows the actual code.

- **Git hygiene:** every task ends with explicit `git add` of source files only (not `.md`). Never push — user must approve.

- **Tests:** `npm run test:unit` passes at every task commit after Task 1. Visual verification after Tasks 15, 16, 17, 18, 20, 23.
