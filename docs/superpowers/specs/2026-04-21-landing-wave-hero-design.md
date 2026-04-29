# Landing hero wave — design

**Date:** 2026-04-21
**Status:** v2 SHIPPED (2026-04-21 PM). Live on the landing. Engine modules at `shared/landing-wave.js` + `shared/wave/*`. Dev mockup with live control panel at `app/wave-v2-mockup.html`. v1 (two-bundle approximation) preserved as `app/wave-fallbackv1.html`. v2 model: one wireframe of a 2D wave-surface (sea-wave), perspective-camera + slight pitch — apparent X-crossing is the projection of the ripple surface, not a twist.
**Inspired by:** the flowing-ribbon visual under Stripe's "Scale with confidence." section (stripe.com)

## Goal

Introduce a flowing, meditative ribbon animation as a **full-bleed background behind the landing hero headline** (index.html). Same family of effect as the Stripe homepage ribbon — a bundle of thin parallel filaments drifting through a slow sinusoidal S-curve — but grounded in Emersus brand palettes. Both the dark (Mint) and light (Paper) themes get their own preset.

## What already exists

A working prototype lives at `app/emersus-three-wave-replica.html` (373 lines, one-file Three.js + inline shaders). It already solves the hardest part:

- 2 ribbon "bundles" × 62 strands × 260 segments, rendered as triangle strips
- Custom vertex shader: each ribbon is a sum of two low-freq sines + per-strand phase offset + drift; ribbon B tilts upward (the S-curve)
- Custom fragment shader: 3-stop gradient per ribbon with edge fade + strand-center bias
- `AdditiveBlending`, `depthTest: false` → soft glow from overlap
- Reduced-motion respected (frozen frame at t=14s)
- Warm palette: `#ffb3bb → #fb6fa8 → #c084fc` (ribbon A), `#a855f7 → #7c3aed → #5b63f6` (ribbon B)

The productionization gap is *wrapping* (palette picker, theme coupling, IntersectionObserver, capability check, mobile fallback, hero integration), not *shader authoring*.

## Decisions (user-approved)

1. **Approach:** technique recreation using the existing shader skeleton.
2. **Palettes:** ship both —
   - **Emersus** (default): mint/jade/cyan/royal-blue ribbons on the theme's native bg. Reads as native brand.
   - **Warm** (alternate): a pink/violet/indigo variant close to the prototype's current colors. Toggleable for A/B comparison; user picks the keeper after seeing both in-browser.
3. **Placement:** full-bleed hero background spanning behind the headline. The existing `.demo-wrap` / `.demo-frame` below the hero **stays** — the wave sits above it, not instead of it. (Flag: confirm in §Open questions.)
4. **Theme coverage:** both Paper (light) and Mint (dark).

## Non-goals

- Not porting Stripe's full Three.js engine (post-FX target pipeline, palette textures, multi-breakpoint configs, blur/grain fullscreen pass). The result is subjectively 80–90% of the feel at 15% of the code.
- No mouse-follow interactivity in v1 (can add later — it's one uniform + listener).
- No per-scroll motion (scroll-independent loop).

## Architecture

```
shared/landing-wave.js       ← public entry: initLandingWave({ canvas, palette?, theme? })
                               • capability check (WebGL + powerPreference)
                               • reduced-motion gate
                               • IntersectionObserver pause/resume
                               • ResizeObserver + devicePixelRatio capping
                               • returns { pause, resume, dispose, setPalette, setTheme }
shared/wave/geometry.js      ← makeRibbonStrand(strand, bundle, POINTS, WIDTH) — buffer builder
shared/wave/shaders.js       ← vertex + fragment GLSL strings (lifted from the app/ prototype, generalized for palette uniforms)
shared/wave/palettes.js      ← palette presets:
                                 { emersus: {paper,mint}, warm: {paper,mint} }
                               each is { a0,a1,a2, b0,b1,b2 } color triplets + base alpha
shared/landing.css           ← .landing-wave positioning + reduced-motion fallback
```

Three.js comes from `https://esm.sh/three@0.161.0` (same URL the prototype and other mockups already pin — see `app/area-mesh-mockup.html`).

## Module API

```js
// in /index.html bottom-of-body
import { initLandingWave } from '/shared/landing-wave.js';
initLandingWave({
  canvas: document.getElementById('landing-wave'),
  palette: (new URLSearchParams(location.search).get('wave')) || 'emersus', // 'emersus' | 'warm'
  // theme auto-detected from document.documentElement.dataset.theme
});
```

The URL knob (`?wave=warm` vs `?wave=emersus`) lets us A/B side-by-side during review. Once you pick, we strip the query-string handling and hard-code the winner.

## Palette strategy

Six THREE.Color uniforms per render (`uA0,uA1,uA2,uB0,uB1,uB2`) drive the two ribbon ramps. Presets:

| preset            | theme | bg hook                          | ribbon A (warm)                      | ribbon B (cool)                      |
| ----------------- | ----- | -------------------------------- | ------------------------------------ | ------------------------------------ |
| `emersus.mint`    | Mint  | `var(--bg)` (≈ `#0a0a0b`)        | `#bff6e4 → #34d399 → #0ea5b7`        | `#93c5fd → #3b82f6 → #4f46e5`        |
| `emersus.paper`   | Paper | `var(--bg)` (≈ `#f4efe5`)        | softer, alpha halved, desaturated    | same, lower opacity, additive dims   |
| `warm.mint`       | Mint  | `#080d25` (prototype bg tint)    | `#ffb3bb → #fb6fa8 → #c084fc`        | `#a855f7 → #7c3aed → #5b63f6`        |
| `warm.paper`      | Paper | paper bg with a soft rose vignette | same hues, alpha halved              | same hues, alpha halved              |

Paper (light) uses reduced opacity + reduced `displaceAmount` so ribbons read as a faint watermark, not a garish overlay. This mirrors Stripe's own light-vs-dark config split.

## Hero integration

`index.html`:
```html
<section class="hero">
  <div class="hero-bg" aria-hidden="true">
    <canvas id="landing-wave"></canvas>
    <div class="hero-bg-fallback"></div> <!-- CSS-only gradient, shows when JS/WebGL unavailable -->
  </div>
  <div class="eyebrow">…</div>
  <h1 class="headline">…</h1>
  …
</section>
```

`landing.css`:
- `.hero` gets `position: relative; overflow: hidden` (watch for existing padding — currently `96px 32px 40px` with `max-width: 1040px; margin: 0 auto`).
- `.hero-bg` is `position: absolute; inset: 0; pointer-events: none; z-index: 0; overflow: hidden;` and expands beyond the 1040px hero container using negative `margin-inline: calc((100vw - 100%) / -2)` to achieve true full-bleed.
- `.headline`, `.eyebrow`, `.subhead`, `.hero-actions`, `.hero-meta` all get `position: relative; z-index: 1` so they sit on top.
- Top + bottom 18% of the canvas area fades to `var(--bg)` via a `::after` gradient mask (prototype already does this) so text contrast survives.
- `@media (prefers-reduced-motion: reduce)` or `@media (max-width: 640px)` → canvas is hidden, fallback div shows a static radial-gradient that evokes the same palette.

## Fallbacks & gates

- **No WebGL / perf caveat** (`failIfMajorPerformanceCaveat: true`) → canvas stays blank, fallback gradient shows.
- **`prefers-reduced-motion: reduce`** → canvas renders ONE frame at `t=14s` then stops rAF (same pattern as the prototype).
- **`saveData` (data-saver) / deviceMemory < 4 / hardwareConcurrency < 6 / `(pointer: coarse)`** → skip canvas entirely, show fallback. These checks already live in the deleted `script.js` — we'll lift the `shouldUseRichLandingEffects()` heuristic into `landing-wave.js`.
- **Not intersecting (IntersectionObserver threshold 0.05)** → pause rAF to spare battery on scroll.

## Performance budget

- One draw call per strand × 124 strands = 124 draw calls per frame — same as the prototype, which already runs smoothly. Can batch to one InstancedMesh later if we need the headroom.
- rAF throttled to every other frame (~30 fps) — matches Stripe's `frameInterval: 2`. The motion is slow enough that 60 fps buys nothing.
- `setPixelRatio(min(devicePixelRatio, 2))` to cap the fragment-shader cost on retina.
- Inline module (`<script type=module>`) so we don't block first paint; wave canvas is transparent until first draw, and the fallback gradient sits underneath until WebGL confirms it can render.

## Testing checklist

- [ ] `npm start` → open `/` in Chrome desktop → wave visible, drifts slowly, no obvious seams
- [ ] Toggle Profile → Appearance (Paper/Mint) → wave re-tints cleanly, no flash-of-wrong-palette
- [ ] Append `?wave=warm` → palette swaps to the pink/violet preset
- [ ] DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce" → wave freezes
- [ ] DevTools → Application → "Save-data" header ON → fallback gradient shows instead of canvas
- [ ] Resize from 1440 → 320 width — wave re-fits, no layout shift in `.hero`
- [ ] Lighthouse mobile: LCP unaffected vs current landing
- [ ] Safari 17 + Firefox 127 smoke

## Risks

- **Hero content contrast.** The ribbon passes through the middle vertically; `.headline` is the largest contrast risk. The top/bottom gradient mask in the prototype solves this for the middle 64% band; we may need a stronger ink-backed shadow on the headline on Mint theme. Verify in §Testing.
- **Paper theme legibility.** Light bg + additive blending collapses contrast. The "alpha halved" setting in the palette table is my best guess — may need a dedicated `blending: THREE.NormalBlending` branch for Paper. Decide at review time.
- **Canvas vs `demo-frame` visual clash.** The existing `.demo-frame` mockup directly below the hero is already content-heavy. A loud wave above it risks a "too much" hero. Mitigation: paper preset is subtle; Mint preset's bottom fade hands off into the demo-frame cleanly. Will judge on-screen.

## Open questions (please confirm before I implement)

1. **Demo-frame.** Keep the existing `.demo-wrap` / `.demo-frame` chat mockup below the hero? (I'm assuming **yes** — the wave goes behind the hero text only, not replacing the demo.)
2. **Stats overlay.** The prototype sits a `.stats` grid on top of the wave (1.04M papers / 302 topics / 100% cited). The live hero already has a `.hero-meta` line. Do we want those three stats inside the hero on top of the wave, or just the existing single-line meta? (I'd leave the existing single line — the stats are already present in the page's "What's indexed right now" section.)
3. **Ship both palettes long-term or cull one after review?** Default plan is to ship both behind the `?wave=` knob *during review only*, then hard-code whichever you keep.

## Rollout

1. Land `shared/landing-wave.js` + `shared/wave/*` + `shared/landing.css` edits + `/index.html` hero markup in one PR.
2. Local verify per §Testing.
3. Review both palettes via `?wave=warm` / `?wave=emersus`.
4. Pick a palette, remove the loser + the `?wave=` knob.
5. Push to main → auto-deploys via webhook (~30–60s after push).

## Out of scope (future)

- Mouse-reactive ribbon deformation
- Scroll-linked S-curve breathing amplitude
- True post-processing stack (blur + grain via render target) — can bolt on if the minimalist version feels too flat
