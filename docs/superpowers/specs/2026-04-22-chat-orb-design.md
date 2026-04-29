# Emersus chat orb — design spec

**Date:** 2026-04-22
**Status:** Design approved; ready for implementation planning
**Replaces:** `shared/thinking-glyph.js` + `app/thinking-glyph-mockup.html` (old purple/cyan/magenta canvas glyph — off-brand since the redesign to Graphite·Jade / Paper·Royal)

## Problem

The chat app's current streaming indicator is the seven-shape morphing glyph in `shared/thinking-glyph.js`. It was tuned for an earlier brand (purple `#534AB7` + cyan/magenta chromatic aberration). Post-redesign the brand is jade `#34d399` / royal-blue `#3b82f6` with Space Grotesk + JetBrains Mono, and the old glyph reads as a legacy artifact. We need a new presence that carries the new brand and becomes a real identity moment, not just a state indicator.

## Decision summary

Inline 3D particle cloud rendered below the last assistant message. ~260 particles morph between ~30 3D target shapes via greedy nearest-neighbour reassignment + underdamped spring physics with curved trajectories. Three states (idle / thinking / responding) with distinct rotation signatures, breath pulses, colour tints, and shape-cycling behaviour. Implemented in vanilla three.js loaded via `esm.sh`, CPU-side physics, GPU-side render.

Picked **over:** r3f (reconciliation overhead), pixi v8 (2D-first), babylon (overkill), tsparticles (can't fit custom physics), Lottie/Rive (pre-baked), direct WebGL no-lib (reinvents three.js).

## Goals

- **Brand presence.** Each chat turn feels like it lives on a piece of the brand, not next to a spinner.
- **State legibility.** idle / thinking / responding all read differently at a glance, including from peripheral vision.
- **Continuity.** The orb persists across thread switches — same cloud, new context.
- **Coexist with SSE stream.** Must not interfere with React 18 render timing during token streaming.
- **Respect reduced-motion.** Honour `prefers-reduced-motion` without becoming a static dot.

## Non-goals

- Not a full-viewport background treatment (ruled out during brainstorm — brand presence but not takeover).
- Not a mouse/touch-interactive artifact (decorative, `aria-hidden`).
- Not a per-message indicator (one orb, tail-of-conversation).
- Not a design-authored Lottie/Rive asset (all parameters live in code).
- Not a replacement for the chat status line ("Thinking…", "Responding…"). The orb is visual accompaniment; the live-region text is the authoritative signal for screen readers.

## Integration point

- **DOM location.** Inline below the last assistant message in the chat scroll. Anchored to the conversation tail: it moves down as new messages arrive and stays inside the scroll area.
- **Component boundary.** New `EmersusOrb` React component wraps the orb engine. Internally it owns a single `<canvas>` ref, instantiates `createEmersusOrb()` once, and propagates the existing `glyphState` prop into `.setState()`.
- **No change to chat state model.** `react-chat-app.js` keeps its current `glyphState` useState (`'idle' | 'thinking' | 'responding'`). Only the component that *consumes* it changes.
- **One instance per chat viewport.** On thread switch the orb persists; only its state and (optionally) its target shape change. Particle positions and rotation angles carry forward.

## Sizing

| viewport | canvas size | DPR cap |
|---|---|---|
| ≥ 560 px | 160 × 160 px | min(window.devicePixelRatio, 2) |
| < 560 px | 128 × 128 px | min(window.devicePixelRatio, 2) |

Resizes handled by a `ResizeObserver` on the container. On change, the renderer's drawing buffer updates but the particle count and physics remain constant.

## State machine

### States

| state | shape | breath | state rotation (rad/s) | tint | links | flow |
|---|---|---|---|---|---|---|
| **idle** | frozen | 0 Hz, 0% amp | X 0.06 · Y 0 · Z 0.04 | cool blue (90, 110, 160) | 0.08 | 0 |
| **thinking** | frozen | 0.75 Hz, 8% amp | X 0.18 · Y 0.22 · Z 0.12 | bright cream (191, 246, 228) | 0.22 | 0 |
| **responding** | cycles every 2000 ms (random, no consecutive repeats) | 0.50 Hz, 2% amp | X 0.08 · Y 0.55 · Z 0 | royal blue (80, 145, 242) | 0.22 | 0.8 |

Tint amount (blend toward tint): idle 0.06, thinking 0.12, responding 0.14.

### Transitions

- **State parameter interpolation** — all scalar params (spring, drag, jitter, tint RGB, rotation speeds, breath) ease via `easeInOutCubic` over 2200 ms.
- **Transition gesture force field** — during state changes, a bell-curve-shaped extra force (peak at 45% through transition) adds state-specific motion: radial expansion into thinking, directional +X nudge into responding, centripetal damping into idle.
- **Shape-cycle gating:**
  - `idle` and `thinking` freeze on current shape (no auto-cycle).
  - `responding` triggers a new shape every 2000 ms. Selection: random from the 29 non-current shapes — guarantees no back-to-back repeats.
- **Stream-pause debouncing.** Logic lives in `react-chat-app.js` (where SSE chunks arrive), not inside the orb. When a chunk gap exceeds 400 ms, the chat code calls `orb.setState('thinking')`; the next chunk calls `orb.setState('responding')` again. The orb itself is stateless about SSE; it only reacts to `.setState()` calls.
- **Freeze-on-finish.** When `responding → idle`, any in-flight shape transition completes naturally (particles finish arriving at their current target). After that, the orb stays on that shape until state changes again. No final snap to a "rest" shape, no shape teleport on state change.

## Shape bank (30 shapes)

Precomputed once at module load. Each shape returns exactly 260 target positions.

| category | shapes |
|---|---|
| polyhedra | sphere, icosa, dodeca, octa, tetra, cube, pyramid, bucky |
| topology | torus, trefoil, torusKnot (3,2), möbius, klein, linked, supertoroid, catenoid, helicoid |
| chaos | lorenz, rössler, thomas, halvorsen |
| bio / nature | dna, molecule, seashell, heart, sunflower |
| cosmic | galaxy, saturn |
| curves | viviani, lissajous, infinity |

Each shape has an associated intrinsic rotation axis + speed (see `SHAPE_SPIN` in the PoC).

## Physics + rendering

### CPU-side (per frame, per particle)

1. Greedy nearest-neighbour reassignment on shape change (O(N²) = 67 k ops ≈ 4 ms, runs once per shape change).
2. Per-particle stagger delay (0–750 ms) before new target takes effect.
3. At target adoption: initial tangential velocity (curl kick) perpendicular to path-to-target. Sign and axis randomised per particle.
4. Each frame:
   - Underdamped spring toward target (k = 0.026–0.060 per state, d = 0.84–0.935).
   - Pre-burst multiplier (1.0× default) amplifies spring for first 350 ms of a transit.
   - Continuous curl force (0 by default) perpendicular to current direction.
   - Breath scales target position: `target × (1 + breathAmp · sin(t · 2π · breathFreq))`.
   - Velocity drag, position integration.
5. Wiggle / random jitter: **0** (removed per user tuning).

### GPU-side (three.js)

- **`THREE.Points`** with a `ShaderMaterial` — per-vertex attributes: `position`, `color`, `size`. Vertex shader scales size by depth; fragment shader renders soft circular disc with glow.
- **`THREE.LineSegments`** for near-neighbour links — rebuilt every frame with a pair-distance check (capped at 14 neighbour pairs per particle, distance² < 650 in shape space).
- **Trails** — 40-frame ring buffer of past positions per particle. Drawn as additional `LineSegments` with fading alpha across the ring. **On by default.**
- **Post-processing** — none in v1 (bloom would be tempting but adds cost + visual noise at 160 px).

### Tuned physics parameters (locked from brainstorm session)

```
curve:      0.04   // initial tangent kick on target change
continuous: 0      // ongoing curl force through transit
overshoot:  0      // extra drag removed during transit (0 = no overshoot)
pre-burst:  1.0    // spring stiffness multiplier in first 350 ms
stagger:    750    // max per-particle launch delay (ms)
spin:       1.0    // global multiplier on per-shape rotation
```

Exposed via `?tune=1` URL flag for in-browser live tuning during dev.

## Accessibility + performance + lifecycle

- **`prefers-reduced-motion: reduce`** — state + shape rotations → 0. Responding cycling disabled (frozen shape). Breath amp halved (4%). Trails replaced with static dots.
- **`aria-hidden="true"`** on canvas. Screen readers use the existing live-region status line.
- **`IntersectionObserver`** pauses RAF when the canvas scrolls out of view; resumes on re-entry.
- **`visibilitychange`** cancels RAF when tab is hidden, resumes when visible.
- **Thread switch.** Particle positions + velocities + shape rotation angles persist. Only the state and (optionally) current shape target update.
- **Cold start.** First mount lands on `sphere` + `idle` in one frame. No loading flash.
- **WebGL2 fallback.** If unavailable, simpler shader (flat points, no soft disc). If WebGL fails entirely, static SVG jade→royal gradient orb — the live-region status line still carries the state.
- **Perf budget:** < 4 ms/frame on a mid-M-series Mac, < 8 ms on a 2021 Android mid-tier. Budget headroom supports ~1000 particles if later designs want more density.

## File structure

```
shared/
  emersus-orb/
    index.js           // createEmersusOrb(canvas, opts) — public API
    shapes.js          // 30 target generators + SHAPE_SPIN table
    physics.js         // spring + curl + stagger + nearest-neighbour
    state.js           // state machine, param lerping, breath, transition gesture
    render.js          // three.js scene, Points + LineSegments + trails
    config.js          // all tunable constants, reads ?tune=1 URL flag
  react-chat-app.js    // imports createEmersusOrb, replaces ThinkingGlyph

app/
  emersus-orb-mockup.html  // same live-tuning panel used during brainstorm, preserved for future design tuning
```

## Public API

```js
import { createEmersusOrb } from "/shared/emersus-orb/index.js";

const orb = createEmersusOrb(canvasElement, {
  size: 160,           // CSS px (number or "responsive" for auto 128/160)
  palette: "mint",     // "mint" | "paper" — matches emersus theme tokens
  initialState: "idle",
  initialShape: "sphere", // optional; otherwise sphere
});

orb.setState("idle" | "thinking" | "responding");
orb.setShape(shapeName);   // optional manual override; auto-unselects in responding
orb.destroy();              // cancels RAF, disposes GL context + buffers
```

## Deprecations

- `shared/thinking-glyph.js` — replaced entirely. Delete on ship.
- `ThinkingGlyph` React wrapper in `react-chat-app.js` — replaced with `EmersusOrb`.
- `app/thinking-glyph-mockup.html` — archived (kept in repo for reference; no active use).

## Open questions

- **Palette in `paper` theme.** The brainstorm was dark-mode (Graphite·Jade). Paper mode uses royal blue as accent; the implementation ships a mirrored tint table keyed on `document.documentElement.dataset.theme` with derived values (jade → paper's accent-blue, cream → paper's warm-ink, royal → paper's `--accent`). Fine-tuning paper values against live backgrounds is a follow-up once we see it in place; the shipped v1 uses auto-derived values without visual review.
- **Onboarding / first-run behaviour.** When a user has zero messages, should the orb sit below the welcome card? Likely yes, but needs a confirming look at the live onboarding flow.
- **Stream-pause 400 ms threshold.** Needs validation against real SSE cadences. Will be a config constant, easy to tune after first production observation.

## Out of scope (explicit punt list)

- Mouse or touch interaction
- Per-message mini-orbs
- Orb-to-message annotations (e.g., changing shape based on query topic)
- Multi-orb compositions
- Designer-editable shape bank (all shapes are code-defined)
- Theme palettes beyond mint + paper
