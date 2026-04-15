# Mobile Polish — Design Spec

**Date:** 2026-04-15
**Status:** Draft, awaiting sign-off
**Scope:** Mobile (≤ 768 px viewport) UI/UX for every authenticated route — chat, train, nutrition, progress, profile — plus the widget iframe, landing and auth chrome.
**Related:** `2026-04-15-frontend-redesign-design.md` shipped the desktop redesign; mobile was never explicitly specced.

---

## Motivation

The 2026-04-15 redesign was spec'd and shipped desktop-first. A targeted audit (`2026-04-15 mobile audit, Explore agent`) found the main entry point — `/app` (chat) — is effectively unusable on phones:

- The 280 px sidebar never collapses. At 375 px viewport that leaves ~95 px for messages.
- `height: 100vh` on every app shell collapses when iOS Safari's address bar retracts or the software keyboard raises.
- The fixed composer slides under the software keyboard on both iOS and Android.
- Primary actions (submit orb, chip buttons, pill badges) are 22–36 px tall, well below the Apple HIG 44 × 44 minimum.
- Nothing in the codebase references `env(safe-area-inset-*)`, so sticky bars overlap the iPhone notch / home indicator.

These are blocking bugs, not polish. The redesign's other surfaces (landing, auth, profile) already have reasonable breakpoints — they need smaller touch-ups but aren't broken.

**Scope boundary:** this spec covers UI chrome and responsive behavior only. LLM pipeline, retrieval policy, workflow.js, and backend routes stay untouched.

---

## Design principles

1. **Chat is the default home and must work on phones first.** Any mobile regression in `/app` blocks ship.
2. **No regressions on desktop.** All changes scope behind `@media (max-width: X)` or equivalent — desktop rendering paths stay byte-identical.
3. **No feature flag this time.** The entire redesign shipped behind `chat_v2`; mobile polish is a narrow follow-up and rolls out with the rest.
4. **Zero new JS libraries.** Use native CSS viewport units, CSS media queries, and existing React state patterns. No drawer / bottom-sheet library.
5. **Native-feeling, not app-shell-y.** The sidebar becomes an overlay drawer on mobile — not a bottom-tab bar, not a hamburger menu hidden behind a header. It slides in from the left, dims the rest, and dismisses on tap-outside / Esc / swipe-left.
6. **Both palettes every time.** Graphite · Jade and Paper · Royal must both look correct on the viewport being fixed.

---

## Phases

The work splits into three shippable commits, each independently reviewable. Each phase is a deploy-gated unit: A can ship without B or C, and so on.

### Phase A — Critical chat mobile (blocks use)

The three issues that make `/app` unusable on phones.

**A1. Collapsible sidebar (drawer pattern).**

At viewport ≤ 768 px the sidebar transforms from the 280 px left column into an overlay drawer:
- Hidden by default, slides in from the left over the chat surface.
- Trigger: a new top-bar button (hamburger-style, left-aligned, 44 × 44 hit target).
- Dismiss: tap the dimmer scrim, Esc key, or swipe-left gesture on the drawer itself.
- When open, the drawer is `position: fixed; left: 0; top: 0; bottom: 0; width: 300px; z-index: 40;` with a `translate3d(-100%)` default state and `translate3d(0)` active state. Dimmer scrim `.chat-nav-scrim` covers the rest at `rgba(0,0,0,0.45)` with a 150 ms fade.
- Body scroll-lock applied while open (`overflow: hidden` on `html, body`).
- Opening a thread auto-closes the drawer.
- **Breakpoint:** `@media (max-width: 768px)`.
- **Accessibility:** drawer is `role="dialog" aria-modal="true" aria-labelledby="chat-sidebar-title"`; focus moves into the drawer on open and returns to the trigger on close.
- **Desktop unchanged:** ≥ 769 px, the sidebar is the existing static 280 px column. The new trigger button is `display: none`.

**A2. `100dvh` everywhere an app shell uses `100vh`.**

iOS Safari's `100vh` returns the maximum viewport (address bar retracted); when the bar is visible or the keyboard is up, the layout overflows. Replacements:
- `shared/chrome.css:43` `.app-shell { height: 100vh }` → `100dvh`
- `shared/chat-v2.css:1052` `.chat-app-shell { height: 100vh }` → `100dvh`
- All other `100vh` references in v2 stylesheets: ditto.
- Fallback: a preceding `height: 100vh` rule covers browsers without `dvh` support (very few in our target audience). Use the `@supports (height: 100dvh)` pattern where a fallback matters.

**A3. Composer keyboard guard.**

The fixed composer covers the last message(s) once the keyboard raises on iOS (the viewport shrinks, the composer stays bottom-anchored). Fix:
- Chat thread gets `padding-bottom` equal to the composer height (+ safe-area inset) so messages are never hidden underneath.
- Composer wrapper gets `padding-bottom: max(12px, env(safe-area-inset-bottom))`.
- Scroll-into-view for the latest message happens after the composer's textarea `focus` event, using `scrollIntoView({ block: "end", behavior: "smooth" })` on the pending-glyph element.

---

### Phase B — App shell chrome

Cross-page chrome fixes that benefit Train, Nutrition, Progress, Profile, and any sticky element.

**B1. Safe-area insets on fixed/sticky bars.**

Every sticky / fixed chrome element pads out the notch and home indicator:
- `.app-sidebar` (desktop) — not affected, but `@media (max-width: 768px)` drawer version uses `padding-top: max(16px, env(safe-area-inset-top))`.
- `.top-bar` — `padding: max(14px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) 14px max(20px, env(safe-area-inset-left))`.
- `.tr-bottom-bar` (train sticky submit bar) — `padding-bottom: max(12px, env(safe-area-inset-bottom))`.
- `.chat-composer-shell` — same.

**B2. Tab bar responsiveness.**

The shared `.tabs` component (used in Train, Nutrition, Progress, Profile) currently has `gap: 40px; padding: 0 28px` and no wrap/scroll rule. On phones the tabs run off-screen.
- `@media (max-width: 640px) { .tabs { overflow-x: auto; scrollbar-width: none; gap: 20px; padding: 0 16px; -webkit-overflow-scrolling: touch; } .tabs::-webkit-scrollbar { display: none; } }`
- Scroll-snap: `.tab { scroll-snap-align: start; }`; `.tabs { scroll-snap-type: x mandatory; }`.
- Active tab auto-scrolls into view on change (existing JS uses `scrollIntoView` pattern — extend to tabs).

**B3. Top-bar pill overflow on chat page.**

The chat top bar carries title + model pill + sources pill + share + ⋯ icon. On narrow phones they wrap-then-overflow.
- `@media (max-width: 500px)`: hide `.pill.model` and `.pill-sources` text portion, keeping only icon glyphs (e.g., `💊 · 3` → `3` with an accent dot). Share button collapses to icon-only.
- Title stays visible but gets `max-width` and ellipsizes.
- ⋯ menu stays unconditionally (it contains rename + share fallbacks).

---

### Phase C — Touch targets, breakpoint coverage, widget polish

Accessibility + polish items. Not blocking, but worth shipping together.

**C1. Touch-target min size — 44 × 44 on phones.**

Every interactive control grows to ≥ 44 × 44 at `@media (max-width: 768px)`:
- `.submit-orb` — 36 × 36 → 44 × 44.
- `.srcs-chip` — 26 × 22 → 32 × 30 (the strip already wraps; this still stays compact).
- `.pill`, `.pill.model`, `.pill-sources` — padding bumps to `6px 10px`, min-height 32 px (desktop unchanged).
- `.srcs-row .mini-link` — min-height 32 px.
- `.stop-btn` — min-height 40 px, min-width 88 px (paired with submit orb).
- Message action buttons (`.msg-action`) — min-height 32 px.

**C2. Responsive message padding.**

`.message` has `padding: 32px 28px` at all widths. On phones, replace with `padding: 20px 16px` under 640 px, `padding: 16px 12px` under 400 px.

**C3. Additional chat breakpoints.**

Today `chat-v2.css` has exactly one breakpoint (`640px` for sources rows). Add:
- `@media (max-width: 768px)` — sidebar → drawer, trigger visible, composer keyboard guard, touch targets bump.
- `@media (max-width: 500px)` — top-bar pill collapse, message padding step-down, welcome-screen font scale-down.
- `@media (max-width: 400px)` — even tighter message padding, thinner chip strip, suggest-prompts chips go single-column.

**C4. Widget iframe max-width guard.**

`MAX_WIDGET_FRAME_HEIGHT` is 1400 px; no width clamp. On phones, widget iframes should not overflow the viewport.
- `WidgetFrame` wrapper `<div class="widget-frame">` gets `width: 100%; max-width: 100%; overflow: hidden;`.
- Inside the iframe, base CSS adds `html, body { max-width: 100vw; overflow-x: hidden; }` (already `overflow-wrap: break-word` exists; we're adding width guard).

**C5. Auth input zoom guard.**

Auth inputs have `font-size: 14px`. Older iOS (< 16) zooms on focus when the field's computed font-size < 16 px. Bump to 16 px across auth inputs at phone widths.

**C6. `overflow-x: hidden` on app page roots.**

Add `html, body { overflow-x: hidden; }` to `train-v2.css`, `nutrition-v2.css`, `progress-v2.css`, `profile-v2.css` as a defensive belt against any child overflowing on narrow widths.

---

## Acceptance criteria

Each phase is acceptance-gated by a manual checklist run on these device profiles:

| Device class | Width | Key scenario |
|---|---|---|
| iPhone SE (2020) | 375 × 667 | Smallest iOS still in target |
| iPhone 14 | 390 × 844 | Modern notch + home indicator |
| Pixel 7 | 412 × 915 | Android soft keyboard raise |
| iPad mini (portrait) | 744 × 1133 | Tablet — sidebar should still be drawer |
| Desktop | ≥ 1024 | Regression: must render identically to pre-change |

**Phase A acceptance — `/app` chat on 375 × 667:**
- [ ] Sidebar starts hidden; hamburger button visible in top-left.
- [ ] Tapping hamburger slides drawer in over chat; scrim dims background.
- [ ] Tapping scrim / pressing Esc / tapping a thread closes the drawer.
- [ ] Composer stays visible when keyboard raises; last message is not hidden.
- [ ] Layout does not "jump" when iOS address bar toggles (no `100vh` collapse).
- [ ] At ≥ 769 px the desktop 2-column layout is byte-identical to pre-change.

**Phase B acceptance — /app/train, /app/nutrition, /app/progress, /app/profile on 375 × 667:**
- [ ] Top bar content is not clipped by the notch / camera cutout.
- [ ] Tab bar scrolls horizontally when tabs overflow; active tab auto-scrolls into view.
- [ ] Sticky bottom bar (train) clears the home-indicator gesture zone.
- [ ] Chat top-bar pill cluster fits without wrapping at 390 px.

**Phase C acceptance:**
- [ ] All interactive targets in the chat surface are ≥ 44 × 44 on phones (measured via Chrome devtools + actual device).
- [ ] Message prose has generous left/right breathing room but not wasted space.
- [ ] Widget iframes never horizontally scroll the page at 320 px.
- [ ] Auth login field does not trigger iOS zoom on focus.

---

## Non-goals

- **Landing/marketing page redesign.** Already has reasonable breakpoints; only `overflow-x: hidden` defense is included.
- **Bottom tab bar.** We deliberately kept the sidebar-as-drawer pattern; a bottom tab bar would conflict with chat scroll + fixed composer.
- **Offline/PWA work.** Separate initiative.
- **Backend changes.** No new endpoints, no schema changes.
- **Landscape orientation on phones.** The chat UI implicitly supports it but no dedicated polish.

---

## Rollback

All changes are behind CSS media queries plus small React state additions (`sidebarOpen`). Single revert of the per-phase commit cleanly restores previous behavior. No feature flag, no migration, no DB change — `git revert <sha>` + webhook auto-deploy is the rollback path.

---

## Open questions

None. Audit-driven; all findings have a fix path.
