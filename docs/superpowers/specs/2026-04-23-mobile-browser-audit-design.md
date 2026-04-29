# Mobile + cross-browser audit — design

**Date:** 2026-04-23
**Status:** approved, executing
**Author:** Claude (Opus 4.7), approved by Sidar

## Problem

Landing page just got performance work but hasn't been systematically tested across mobile viewports or non-Chromium browsers. Rest of the site (auth, app, domain pages) has never been audited for cross-browser + mobile correctness. Known pain points: iOS `100vh` bug used in 8 files, inconsistent breakpoints (10+ distinct values), incomplete `-webkit-` prefix coverage, no `@supports` fallbacks for modern CSS.

## Decomposition — 4 sub-projects, executed in order

| # | Sub-project | Surfaces | Est |
|---|---|---|---|
| 1 | Landing + static | `/`, `/privacy`, `/terms`, `/contact`, `/consumer-health-data`, `/demo` | ~5 hr |
| 2 | Auth funnel | `/auth/login`, `/auth/signup`, `/auth/forgot-password`, `/auth/callback`, `/auth/reset-password` | ~3 hr |
| 3 | Core app | `/app/`, `/app/library`, chat via `shared/react-chat-app.js` | ~2 days |
| 4 | App domain | `/app/train`, `/app/nutrition`, `/app/profile`, `/app/progress` | ~1 day |

Each sub-project runs the same audit checklist, ships as its own commit, re-runs `scripts/perf/landing-perf.mjs` if relevant.

## Browser matrix

- **Chrome** last 2 — baseline, ~65% of users
- **Safari iOS 16+ / macOS Safari 16+** — iOS 15 is <2% share, dropping it unlocks container queries / `:has()` / `dvh`
- **Firefox** last 2 — low share but a11y-friendly
- **Samsung Internet** latest — often forgotten on Galaxy devices
- **Edge** — Chromium, covered by Chrome

Dropped: IE, Opera Mini, UC Browser, iOS Safari <16.

## Device / viewport matrix

| Viewport | Device | Rationale |
|---|---|---|
| 320×568 | iPhone SE 1st gen | worst-case mobile; ~1% share |
| 375×812 | iPhone SE 2/3 | small modern iPhone |
| 390×844 | iPhone 14 | most common iPhone today |
| 360×740 | Pixel 5 / Samsung | mid-range Android |
| 768×1024 | iPad portrait | "is it mobile or desktop?" trap |
| 1024×768 | iPad landscape | often mis-handled as mobile |
| 1440×900 | Desktop | baseline |

## Audit checklist (applied every surface, every browser)

1. **Layout breakage** — overflow, horizontal scroll, overlapping elements, text truncation
2. **iOS viewport bugs** — `100vh` → `100dvh` + safe-area-insets where needed
3. **Touch-target sizing** — WCAG 2.5.5: 44×44 CSS px min for CTAs, nav, form controls
4. **Keyboard + viewport interaction** — iOS keyboard pushes content; `interactive-widget=resizes-content` where relevant
5. **Input behavior** — `inputmode`, `autocomplete`, `autocapitalize`; iOS auto-zoom on `input` with `font-size < 16px`
6. **Vendor-prefix coverage** — `-webkit-backdrop-filter`, `-webkit-text-size-adjust`, `-webkit-tap-highlight-color`, `-webkit-overflow-scrolling`
7. **CSS feature fallbacks** — `@supports` for `:has`, container queries, `dvh`, `color-mix`, `text-wrap: balance`
8. **Mobile perf** — bundle size on 3G, image sizing (srcset/sizes), font-loading
9. **Motion + battery** — `prefers-reduced-motion` respected, heavy animations gated on coarse-pointer small screens
10. **Accessibility quick wins** — focus states visible, alt text, aria-label on icon buttons, color contrast (axe-core)

## Test tooling

- `scripts/perf/landing-audit.mjs` — multi-browser (Chromium + WebKit + Firefox) × multi-viewport screenshot + console + layout-overflow + touch-target audit, emits JSON report + screenshot gallery under `scripts/perf/audits/<date>/`.
- Existing `scripts/perf/landing-perf.mjs` re-runs after fixes to confirm no perf regression.

## Success criteria (per sub-project)

- Every surface × every viewport in matrix renders without broken layout or horizontal scroll
- Zero uncaught JS errors in console on any tested browser
- Lighthouse mobile ≥ 90 on landing, ≥ 80 on auth/app
- Zero WCAG 2.5.5 touch-target failures
- axe-core: 0 critical, 0 serious issues per surface

## Deliverables per sub-project

1. Commit to `main` (auto-deploy)
2. Brief audit report in terminal — found, fixed, deferred
3. `scripts/perf/landing-perf.mjs` before/after when relevant
4. One-line memory entry if the sub-project taught us something durable

## Non-goals

- Rewriting the React chat component
- Replacing the landing page layout
- Adding new features
- Mobile-only features (native app is a separate parked project)
