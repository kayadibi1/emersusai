# Frontend Redesign · Phase 8 · Public / Static (`/`, `/contact`, `/privacy`, `/terms`, `/consumer-health-data`, `/demo`) Implementation Plan — Outline

> **Status:** Outline. Expand before executing.

**Goal:** Full landing page redesign (hero · autoplay chat demo · bento · five-things spotlights · marquee · how-it-works · evidence grading · corpus stats · testimonials · comparison · coming-soon · FAQ · final CTA · rich footer). Plus static/legal shell with sub-tabs and sticky TOC.

**Spec:** `2026-04-15-frontend-redesign-design.md` § "1. Landing", "8. Static" + "Behaviors · 7. Static".
**Mockup:** `.superpowers/brainstorm/linear-landing/mockup-themes.html` (landing) and `static.html` (legal).
**Feature flag:** `public_v2`.

**Note:** `consumer-health-data/index.html` was added in WIP 2026-04-15; it uses the current static shell. This phase rebuilds the static shell so the CHD page will auto-inherit it.

## File structure (proposed)

- **New:** `shared/public-chrome.css` — marketing-specific styles (sticky blur nav, bento grid, spotlights, marquee, FAQ expanders, footer)
- **New:** `shared/public-demo.js` — autoplay chat demo (macOS frame, loops every 16s)
- **Modify:** `index.html` — rebuild landing using the new chrome
- **Modify:** `script.js` — keep the 3D neuron background but make it an opt-in module as before (already done 2026-04-13)
- **New:** `contact/contact.js` — subject pills + form + success state
- **Modify:** `contact/index.html` — use the shared static shell
- **New:** `shared/static-shell.js` — TOC + sub-tabs + numbered sections + Download PDF link
- **New:** `api/contact.js` — already exists; add subject routing + HCaptcha/Turnstile
- **Modify:** `privacy/index.html`, `terms/index.html`, `consumer-health-data/index.html` — wrap existing legal copy in the new static shell
- **Build:** `/privacy.pdf`, `/terms.pdf`, `/consumer-health-data.pdf` generated at build time

## Task outline (~20 tasks)

### Landing

1. `public_v2` flag + route guard
2. Sticky top nav with backdrop-blur
3. Hero — eyebrow pill + gradient-fade headline + subhead + 2 CTAs + papers-indexed mono meta
4. Autoplay chat demo module (macOS frame, loops, mocked streaming)
5. "What you get" bento (6 cards asymmetric grid)
6. "Five things" spotlights (5 alternating rows)
7. Counter-directional marquee (sample questions)
8. How-it-works (4 numbered steps)
9. Evidence grading (4-tier deep-dive)
10. Corpus stats (3 big numbers — dynamic from API)
11. Testimonials (3 cards)
12. Comparison table (Emersus vs Generic AI vs Influencer)
13. Coming soon (4 roadmap cards)
14. FAQ (5 expandable questions)
15. Final CTA
16. Rich footer (4-column)

### Static / legal

17. Static shell — sticky top nav + sub-tabs (Contact / Privacy / Terms / Consumer Health Data)
18. Contact — subject pills + form + aside card + success state + Turnstile integration
19. Privacy / Terms / CHD — sticky TOC on the left + numbered sections on the right + Download PDF link
20. PDF build step — generate `/privacy.pdf`, `/terms.pdf`, `/consumer-health-data.pdf`

### Wrap-up

21. Flip flag default + tag

## Acceptance criteria

- Landing scrolls cleanly on low-end hardware (no jank).
- Autoplay demo doesn't stall (preload assets, use CSS for animation where possible).
- Marquee is counter-directional and pauses on hover.
- Legal pages render both themes correctly.
- `Download PDF` works for all 3 legal pages.
- Contact form validates client-side + inline server errors.

## Open questions

- 3D neuron background — keep opt-in only (default off per 2026-04-13 perf pass)? → Yes.
- PDF generation step — add to deploy pipeline or on-demand server render? → Build-time is simplest; server-side render if we want "live" updates.
- Marketing-copy cadence — who owns landing copy when it changes? → Spec is source; changes go through Design sign-off.
