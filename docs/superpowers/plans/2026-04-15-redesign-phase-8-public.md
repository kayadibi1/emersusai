# Frontend Redesign · Phase 8 · Public / Static Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`.

**Goal:** Full landing page redesign (`/`) + new static shell for `/contact`, `/privacy`, `/terms`, `/consumer-health-data`, `/demo`. This is the **marketing surface** — highest immediate visual impact for visitors who don't have an account.

**Scope rule:** No backend changes. The contact form already POSTs to `/api/contact` and that endpoint stays. Static legal copy lives in HTML; treat it as content-only edits. The neuron animation (`script.js`) stays unless explicitly requested otherwise.

**Spec:** § "1. Landing", § "8. Static" + "Behaviors · 7. Static".
**Mockups:** `.superpowers/brainstorm/linear-landing/mockup-themes.html` (landing) + `static.html` (legal).
**Prerequisite:** Phases 1+2 shipped. Phase 1 already loads design-tokens + chrome.css on these pages.

**Branch strategy:** `public_v2` flag for risk reduction. Old landing stays available via `?public_v2=0`.

---

## File structure

- **Modify:** `index.html` — full landing redesign (hero, autoplay chat demo, bento, five-things spotlights, marquee, how-it-works, evidence grading, corpus stats, testimonials, comparison, coming-soon, FAQ, final CTA, rich footer)
- **Modify:** `contact/index.html` — sub-tab shell + 2-col contact layout
- **Modify:** `privacy/index.html` — sub-tab shell + sticky TOC + numbered sections
- **Modify:** `terms/index.html` — sub-tab shell + sticky TOC + ⚠ medical-advice callout
- **Modify:** `consumer-health-data/index.html` — sub-tab shell (sub-page of legal)
- **Modify:** `demo/index.html` — light reskin matching new landing chrome
- **New:** `shared/landing-v2.css` — landing-specific styles
- **New:** `shared/static-v2.css` — legal/contact shell styles
- **New:** `shared/landing/autoplay-chat-demo.js` — typewriter chat scene that plays in the hero
- **New:** `shared/landing/bento-cards.js` — bento grid component (or pure HTML if no JS needed)
- **New:** `shared/landing/marquee.js` — infinite scroll of source logos / journals
- **New:** `shared/landing/faq.js` — `<details>`-based accordion (no JS framework needed)
- **New:** `shared/landing/cta-button.js` — single source of truth for the accent button used 8x

---

## Task 1: Feature flag + landing shell

- [ ] **Step 1:** `index.html` — wrap in `[data-public-v2="1"]` block when flag on. Inline boot script sets the attribute via `resolveFlag('public_v2')`. Static `<link rel="stylesheet" href="/shared/landing-v2.css">` so Vite bundles it.
- [ ] **Step 2:** Old structure stays inside `[data-public-v2="0"]` blocks (or fallback when attribute is missing).
- [ ] **Step 3: Commit** `feat(public-v2): feature flag + landing shell`

---

## Task 2: Hero section

- [ ] **Step 1:** Hero copy: H1 "Trained on the literature." + subhead. Stat strip ("1M+ papers · 302 topics · 100% verifiable"). Primary CTA `Request access →` (accent) + secondary `See the chat in action ↓` (anchors to demo section).
- [ ] **Step 2:** Background: subtle grid + radial accent glow. Reuse `shared/site.css` layer or refactor into landing-v2.css.
- [ ] **Step 3: Commit** `feat(public-v2): hero section`

---

## Task 3: Autoplay chat demo

**Files:**
- Create: `shared/landing/autoplay-chat-demo.js`
- Create: `tests/unit/shared/landing/autoplay-chat-demo.test.js`

- [ ] **Step 1:** Pure helpers: `nextScript(state)` advances the typewriter state machine (queue of {role, text, delay_ms}). `formatPartial(text, charsShown)` returns the current visible substring.
- [ ] **Step 2:** `<AutoplayChatDemo/>` — replays a curated 3-message conversation (user question → Emersus prose answer → cited source card). Loops every 30s with a `Skip → ` link.
- [ ] **Step 3:** `prefers-reduced-motion` honored — render the final state instead of typing.
- [ ] **Step 4: Commit** `feat(public-v2): autoplay chat demo`

---

## Task 4: Bento grid + Five-things spotlights

- [ ] **Step 1:** Bento grid: 6-card asymmetric layout highlighting features (Chat · Train · Nutrition · Progress · Cited · Themed). Pure HTML (no JS state).
- [ ] **Step 2:** Five-things spotlights: vertical sequence of 5 large feature blocks alternating image + copy. Each has its own short heading + 2-3 sentence body + small CTA.
- [ ] **Step 3: Commit** `feat(public-v2): bento + spotlights`

---

## Task 5: Marquee (source logos)

- [ ] **Step 1:** `<Marquee items/>` — CSS keyframe scroll, infinite via duplicated content. Pause on hover. Items: PubMed · NIH · Cochrane · JISSN · BJSM · Sports Med · etc.
- [ ] **Step 2: Commit** `feat(public-v2): marquee of evidence sources`

---

## Task 6: How-it-works section

- [ ] **Step 1:** 4-step horizontal flow: Ask → Retrieve evidence → Synthesize → Cite. Each step has a glyph + label + 1-line description.
- [ ] **Step 2: Commit** `feat(public-v2): how-it-works section`

---

## Task 7: Evidence grading + corpus stats

- [ ] **Step 1:** Evidence grading section: 4 cards (Strong / Moderate / Limited / Insufficient) explaining the badge taxonomy used in chat answers.
- [ ] **Step 2:** Corpus stats: 4 large numbers (papers / topics / studies indexed last 30d / verifiable %) pulled from `/api/config` (already an endpoint).
- [ ] **Step 3: Commit** `feat(public-v2): evidence grading + corpus stats`

---

## Task 8: Testimonials + comparison + coming-soon

- [ ] **Step 1:** Testimonials: 3 quote cards with attribution (private beta members; consent must be in hand before launching). Stub copy for now.
- [ ] **Step 2:** Comparison table: Emersus vs ChatGPT vs Personal trainer (4-5 rows, simple 3-column table).
- [ ] **Step 3:** Coming-soon: dashed-border tiles for Wearable sync · Recipes · Exercise videos · Mobile app — `Join waitlist →` per tile (reuses `/api/integrations/waitlist` from Phase 6).
- [ ] **Step 4: Commit** `feat(public-v2): testimonials + comparison + coming-soon`

---

## Task 9: FAQ + final CTA + footer

- [ ] **Step 1:** FAQ: 8-10 `<details>`-based accordion entries (no JS).
- [ ] **Step 2:** Final CTA: full-width accent block — `Ready to train with the literature? → Request access`.
- [ ] **Step 3:** Rich footer: 4 columns (Product / Resources / Legal / Company) + bottom row with copyright + version + `info@emersus.ai`. Single contact email per memory `reference_contact_email.md`.
- [ ] **Step 4: Commit** `feat(public-v2): FAQ + final CTA + footer`

---

## Task 10: Static shell (Contact / Privacy / Terms / Consumer-health-data)

- [ ] **Step 1:** Shared sticky top nav (EMERSUS wordmark + sparse links + `Request access` CTA).
- [ ] **Step 2:** Sub-tabs row: Contact · Privacy · Terms (active state highlighting based on current path). Consumer-health-data tab is a sub-page of Privacy (linked from there, not a top-level tab).
- [ ] **Step 3:** Fixed grid background + mask.
- [ ] **Step 4: Commit** `feat(public-v2): static shell + sub-tabs`

---

## Task 11: Contact page

- [ ] **Step 1:** Hero + 2-column grid: form on left (subject pills: General / Beta support / Partnership / Press / Bug report, name, email, message) + aside on right with 2 cards (`info@emersus.ai` routing hub + subject-routing explainer).
- [ ] **Step 2:** Existing `POST /api/contact` flow stays. Success state replaces form: `✓ MESSAGE SENT · TICKET #<id> · WE'LL REPLY TO <email>` + `Send another →` link.
- [ ] **Step 3: Commit** `feat(public-v2): contact page`

---

## Task 12: Privacy / Terms / Consumer-health-data

- [ ] **Step 1:** Hero + 2-column grid: sticky TOC (left, 7+ section anchors with accent-active state via `IntersectionObserver`) + numbered article sections (right).
- [ ] **Step 2:** Terms includes prominent `⚠ IMPORTANT` callout in left-bordered red block: "Not medical advice."
- [ ] **Step 3:** All current legal copy preserved verbatim — this is purely a chrome rebuild.
- [ ] **Step 4:** `Download PDF` footer link (defer real PDF generation; for now, stub to `/privacy.pdf` 404 placeholder).
- [ ] **Step 5: Commit** `feat(public-v2): privacy/terms/cdh pages`

---

## Task 13: Demo page reskin

- [ ] **Step 1:** Existing demo page (`demo/index.html`) gets the new top nav + accent CTA. Content stays — chat-demo embed continues to work.
- [ ] **Step 2: Commit** `feat(public-v2): demo page reskin`

---

## Task 14: landing-v2.css + static-v2.css

- [ ] **Step 1:** Port mockup CSS into `shared/landing-v2.css` + `shared/static-v2.css`, scoped `[data-public-v2="1"]`.
- [ ] **Step 2:** Audit pass.
- [ ] **Step 3: Commit** `feat(public-v2): landing + static styles`

---

## Task 15: Flip default + tag

- [ ] **Step 1:** `DEFAULT_FLAGS.public_v2 = true`. Update flag tests.
- [ ] **Step 2:** Tag `redesign-phase-8-public`.
- [ ] **Step 3:** Commit + push (the marketing surface is the highest-impact deploy of the redesign).

---

## Acceptance criteria

1. Landing renders end-to-end on both palettes with no console errors.
2. Autoplay chat demo loops + respects `prefers-reduced-motion`.
3. Marquee scrolls + pauses on hover.
4. FAQ accordion expands without JS.
5. All CTAs route correctly: `Request access →` opens `/auth/?panel=request`; secondary anchors smoothly scroll.
6. Contact form submits + shows the success state.
7. Privacy / Terms TOC highlights the active section as you scroll.
8. `public_v2=0` falls back to existing landing.
