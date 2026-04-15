# Mobile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every authenticated Emersus route usable on phones (≤ 768 px). Chat sidebar becomes a drawer; `100vh` → `100dvh`; composer survives the software keyboard; touch targets ≥ 44 × 44; safe-area insets; tab-bar horizontal scroll; widget iframes clamp to viewport.

**Architecture:** Pure CSS media queries for 95 % of the work. One small React state addition (`sidebarOpen`) in `shared/react-chat-app.js` for the drawer. Zero new libraries, zero backend changes. Three phase commits (A critical / B chrome / C polish) — each independently deployable.

**Tech Stack:** React 18 (esm.sh, no build), hand-rolled CSS, existing `shared/chat-v2.css` + `shared/chrome.css` + `shared/{train,nutrition,progress,profile,auth}-v2.css`, Lucide icons already in the bundle.

**Spec:** `docs/superpowers/specs/2026-04-15-mobile-polish-design.md`.

**Audit source:** Explore agent report, 2026-04-15 — 10 top-priority findings enumerated, with `file:line` anchors.

**Deploy path:** `git push origin main` → GitHub webhook → Hetzner pulls + `npm run build` + `pm2 restart`. No migrations, no env changes.

**Rollback:** `git revert <phase-sha>` per phase, webhook redeploys.

---

## File structure

- **Modify:** `shared/chat-v2.css` — drawer styles, scrim, mobile breakpoints (`@768px`, `@500px`, `@400px`), touch-target bumps, responsive message padding.
- **Modify:** `shared/react-chat-app.js` — add `sidebarOpen` state, hamburger trigger, scrim element, Esc handler, body-scroll-lock on open, close-on-thread-click.
- **Modify:** `shared/chrome.css` — `100vh` → `100dvh`, safe-area insets on top-bar + sidebar, tabs overflow-x scroll.
- **Modify:** `shared/train-v2.css` — safe-area on `.tr-bottom-bar`, `overflow-x: hidden` belt.
- **Modify:** `shared/nutrition-v2.css` — `overflow-x: hidden` belt.
- **Modify:** `shared/progress-v2.css` — `overflow-x: hidden` belt.
- **Modify:** `shared/profile-v2.css` — `overflow-x: hidden` belt.
- **Modify:** `shared/auth-v2.css` — input `font-size: 16px` on `@max-width: 640px`.
- **Modify:** `shared/emersus-renderer.js` — widget iframe wrapper `max-width: 100%; overflow: hidden;`.
- **Modify:** `changelog.md` — one entry per phase commit.

No new files. No new dependencies. No schema migrations.

---

## Manual test matrix

Every phase is gated by a manual pass on these viewports in Chrome DevTools device toolbar (and at least one real iOS device if available):

| Profile | Width × height |
|---|---|
| iPhone SE | 375 × 667 |
| iPhone 14 | 390 × 844 |
| Pixel 7 | 412 × 915 |
| iPad mini portrait | 744 × 1133 |
| Desktop control | 1440 × 900 (must be byte-identical to pre-change) |

Each task lists the specific scenarios to verify.

---

# Phase A — Critical chat mobile

## Task A1: Replace `100vh` with `100dvh` on app shells

**Files:**
- Modify: `shared/chat-v2.css:1052`
- Modify: `shared/chrome.css:43`

- [ ] **Step 1: Edit `shared/chrome.css`** — replace the `.app-shell` height rule.

```css
/* before */
.app-shell {
  display: grid;
  grid-template-columns: 280px 1fr;
  height: 100vh;
}

/* after */
.app-shell {
  display: grid;
  grid-template-columns: 280px 1fr;
  /* 100dvh = dynamic viewport; survives iOS address-bar + keyboard reflow */
  height: 100vh;            /* fallback for browsers without dvh */
  height: 100dvh;
}
```

- [ ] **Step 2: Edit `shared/chat-v2.css`** — same swap on `.chat-app-shell`.

Search `height: 100vh` in `shared/chat-v2.css`; for each `.chat-app-shell` or similar app-shell rule, duplicate the property: keep `height: 100vh;` then add `height: 100dvh;` right below.

- [ ] **Step 3: Grep-verify** no other `100vh` references remain unintentionally on shells.

```bash
grep -nE "height:\s*100vh" shared/*.css
```

Review each hit; only app-shell and full-viewport modal containers should switch to `100dvh`. Leave landing hero units alone (those are on desktop-dominant views).

- [ ] **Step 4: Smoke-test on Chrome devtools iOS Safari emulation.**
  - Load `/app/` at 390 × 844.
  - Scroll messages — the address bar retracts, layout should not shift.
  - Tap the composer; the software keyboard (emulator shows a fake one) raises — layout does not collapse.

- [ ] **Step 5: Commit**

```bash
git add shared/chrome.css shared/chat-v2.css
git commit -m "fix(mobile): use 100dvh on app shells to survive iOS address bar + keyboard

100vh includes the iOS address bar and doesn't shrink when the keyboard
raises, so the app-shell grid overflows and primary actions slide
offscreen. Swap to 100dvh with a 100vh fallback for browsers that lack
dvh (rare in target audience).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task A2: Sidebar drawer — CSS structure

**Files:**
- Modify: `shared/chat-v2.css` (add new selectors at the bottom, inside a new `@media (max-width: 768px)` block)

- [ ] **Step 1: Add mobile drawer block at the bottom of `shared/chat-v2.css`.**

```css
/* ========================================================================== */
/* MOBILE — drawer sidebar, scrim, hamburger trigger (Phase A)                */
/* ========================================================================== */

/* Hamburger trigger — hidden on desktop, visible as a 44x44 hit target
 * on mobile. Lives in the top bar, leftmost position. The React code
 * renders it unconditionally; this CSS hides it on desktop. */
[data-chat-v2="1"] .chat-nav-toggle {
  display: none;
  background: transparent;
  border: 0;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  color: var(--ink);
  cursor: pointer;
  border-radius: 6px;
  transition: background .14s;
}
[data-chat-v2="1"] .chat-nav-toggle:hover {
  background: var(--surface-faint);
}

/* Scrim — tap-outside-to-close dimmer behind the drawer. */
[data-chat-v2="1"] .chat-nav-scrim {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 39;
  opacity: 0;
  transition: opacity .15s ease;
}
[data-chat-v2="1"] .chat-nav-scrim.is-open {
  display: block;
  opacity: 1;
}

@media (max-width: 768px) {
  /* Shell collapses to single column — no sidebar column reserved. */
  [data-chat-v2="1"] .chat-app-shell {
    grid-template-columns: 1fr;
  }
  [data-chat-v2="1"] .chat-app-shell.history-hidden {
    grid-template-columns: 1fr;
  }

  /* Sidebar becomes an overlay drawer. Hidden by default, slides in
   * when .chat-nav has .is-open. */
  [data-chat-v2="1"] .chat-nav {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(300px, 86vw);
    z-index: 40;
    transform: translate3d(-100%, 0, 0);
    transition: transform .22s ease;
    box-shadow: 8px 0 40px rgba(0, 0, 0, 0.35);
    padding-top: max(12px, env(safe-area-inset-top));
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }
  [data-chat-v2="1"] .chat-nav.is-open {
    transform: translate3d(0, 0, 0);
  }

  /* Trigger becomes visible on mobile. */
  [data-chat-v2="1"] .chat-nav-toggle {
    display: inline-flex;
  }

  /* Body scroll-lock while the drawer is open so background doesn't
   * scroll behind the fixed drawer. Set via JS adding .is-nav-open to
   * <html>. */
  html.is-nav-open,
  html.is-nav-open body {
    overflow: hidden;
  }
}
```

- [ ] **Step 2: Grep-verify** the new classes don't collide with anything existing.

```bash
grep -nE "chat-nav-toggle|chat-nav-scrim|is-nav-open" shared/*.css shared/*.js
```

Only the new additions should match. If `.chat-nav.is-open` already exists, rename to `.chat-nav.is-mobile-open` to avoid collision.

- [ ] **Step 3: Desktop regression check** — load `/app/` at 1440 × 900. Sidebar still the static 280 px column; no hamburger visible; scrim invisible.

- [ ] **Step 4: Commit**

```bash
git add shared/chat-v2.css
git commit -m "feat(mobile): chat sidebar drawer CSS scaffolding

Adds the classes/media-queries that transform the 280 px static sidebar
into an overlay drawer at ≤ 768 px. Drawer opens via .is-open, scrim
covers the rest at 45 % black, body scroll-locked via html.is-nav-open.
Wired up in the next task (React state + handlers).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task A3: Sidebar drawer — React wiring

**Files:**
- Modify: `shared/react-chat-app.js` — ChatApp component: add state, trigger button, scrim element, Esc handler, close-on-thread-click.

- [ ] **Step 1: Add `sidebarOpen` state and handlers in ChatApp.**

Find the ChatApp function body (after `const [isSubmitting, setIsSubmitting] = useState(false);` or similar near the top of the component). Insert:

```js
// Mobile sidebar drawer — only visible at ≤ 768 px. Controls .chat-nav.is-open,
// .chat-nav-scrim.is-open, and html.is-nav-open (for body scroll-lock).
const [sidebarOpen, setSidebarOpen] = useState(false);
const openSidebar = useCallback(() => setSidebarOpen(true), []);
const closeSidebar = useCallback(() => setSidebarOpen(false), []);

useEffect(() => {
  if (!sidebarOpen) return undefined;
  document.documentElement.classList.add("is-nav-open");
  function onKey(e) {
    if (e.key === "Escape") setSidebarOpen(false);
  }
  document.addEventListener("keydown", onKey);
  return () => {
    document.documentElement.classList.remove("is-nav-open");
    document.removeEventListener("keydown", onKey);
  };
}, [sidebarOpen]);
```

- [ ] **Step 2: Auto-close on thread switch.**

Find the existing `setActiveThreadId` calls inside `.chat-nav-link` onClick handlers (there are two — the v2 branch grouped list, and the legacy flat list). Wrap each to also close:

```js
onClick: () => {
  setActiveThreadId(threadData.id);
  closeSidebar();
}
```

- [ ] **Step 3: Add the scrim element and hamburger trigger in the render tree.**

Find `h("aside", { className: "chat-nav" }, ...)` in the ChatApp render. Replace the opening props with the conditional `is-open` class:

```js
h("aside", { className: `chat-nav${sidebarOpen ? " is-open" : ""}`, ... )
```

Add the scrim RIGHT BEFORE the aside element:

```js
h("div", {
  className: `chat-nav-scrim${sidebarOpen ? " is-open" : ""}`,
  onClick: closeSidebar,
  "aria-hidden": true,
}),
```

- [ ] **Step 4: Add the hamburger trigger inside the top bar.**

Find where `ChatTopBar` is rendered (`chatV2On ? h(ChatTopBar, { ... }) : null`). Add a new prop to it for the trigger. In `shared/chat/top-bar.js`, add the button at the very start of the top bar row:

```js
// at top of top-bar row, before title
props.onOpenSidebar
  ? h("button", {
      type: "button",
      className: "chat-nav-toggle",
      "aria-label": "Open conversation list",
      onClick: props.onOpenSidebar,
    }, h(PanelLeftOpen, { size: 18, "aria-hidden": true }))
  : null,
```

(`PanelLeftOpen` is already imported from `lucide-react` in react-chat-app.js; re-import in top-bar.js if needed.)

- [ ] **Step 5: Pass `onOpenSidebar` to `ChatTopBar`.**

In the render tree where ChatTopBar is instantiated, add:

```js
h(ChatTopBar, {
  ...
  onOpenSidebar: openSidebar,
})
```

- [ ] **Step 6: Verify on 390 × 844 emulation.**

  - Hamburger visible top-left, 44 × 44.
  - Tap → drawer slides in from left; scrim dims the rest.
  - Tap scrim → drawer slides out.
  - Press Esc → drawer slides out.
  - Open drawer, tap a thread → drawer closes, thread opens in main.
  - Desktop 1440 × 900: hamburger hidden, drawer is the static column, no scrim.

- [ ] **Step 7: Syntax check + commit.**

```bash
node --check shared/react-chat-app.js && node --check shared/chat/top-bar.js
git add shared/react-chat-app.js shared/chat/top-bar.js
git commit -m "feat(mobile): chat sidebar drawer — React state + trigger + scrim

Adds sidebarOpen state to ChatApp, a 44x44 hamburger trigger in the top
bar, a scrim element between the main column and the sidebar, and an
Esc keydown handler. Opening the drawer adds html.is-nav-open for body
scroll-lock; tapping a thread auto-closes. Desktop path unchanged.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task A4: Composer keyboard guard

**Files:**
- Modify: `shared/chat-v2.css` — add `padding-bottom` on chat thread; safe-area on composer wrapper.

- [ ] **Step 1: Find the chat-thread scroll container rule.**

```bash
grep -nE "\.chat-thread\s*\{|\.chat-main\s*\{" shared/chat-v2.css
```

- [ ] **Step 2: Add responsive padding-bottom so messages clear the composer.**

At the end of the existing `.chat-thread` or `.conversation-canvas` rule, inside a new `@media (max-width: 768px)` block:

```css
@media (max-width: 768px) {
  [data-chat-v2="1"] .chat-thread {
    padding-bottom: calc(140px + env(safe-area-inset-bottom));
  }
}
```

(140 px = approx composer height; tune on device.)

- [ ] **Step 3: Safe-area inset on the composer wrapper.**

Find `.chat-composer-shell` rule and add:

```css
[data-chat-v2="1"] .chat-composer-shell {
  /* existing rules... */
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}
```

- [ ] **Step 4: Verify on iOS Safari emulation.**

  - Focus composer → keyboard raises → last message remains visible above composer.
  - Send a message → after send, thread scrolls so newest message + composer both visible.

- [ ] **Step 5: Commit**

```bash
git add shared/chat-v2.css
git commit -m "fix(mobile): composer keyboard guard — padding-bottom + safe-area

The fixed composer previously slid under the iOS keyboard, hiding the
last message. Chat thread now carries padding-bottom = composer height
+ safe-area at ≤ 768 px. Composer wrapper pads the home-indicator zone.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task A5: Phase A changelog + push

- [ ] **Step 1: Append changelog entry.**

Append to `changelog.md` right under the most recent `2026-04-15` entry:

```markdown
- 2026-04-15 — Mobile chat fixes — Phase A. Three critical issues that blocked usable `/app` on phones: (1) `height: 100vh` on `.app-shell` (`shared/chrome.css:43`) and `.chat-app-shell` (`shared/chat-v2.css:1052`) replaced with `100dvh` + `100vh` fallback so iOS Safari address-bar retraction and software keyboard raise don't collapse the grid; (2) 280 px sidebar transformed into an overlay drawer at `@media (max-width: 768px)` — slides in from left, dimmer scrim covers the rest, Esc/tap-outside/tap-thread close it, body scroll-locked while open via `html.is-nav-open`; 44 × 44 hamburger trigger added to the top bar left of the title; (3) composer keyboard guard — chat thread gets `padding-bottom: calc(140px + env(safe-area-inset-bottom))` under 768 px so messages clear the fixed composer, and composer wrapper pads the iOS home-indicator zone. Zero desktop regression (≥ 769 px renders byte-identical). — `shared/chat-v2.css`, `shared/chrome.css`, `shared/react-chat-app.js`, `shared/chat/top-bar.js`
```

- [ ] **Step 2: Push Phase A.**

```bash
git add changelog.md
git commit -m "docs(changelog): mobile Phase A — chat drawer + 100dvh + keyboard guard"
git push origin main
```

- [ ] **Step 3: Post-deploy verification** — once the GitHub webhook completes on Hetzner (~2 min):

  - Visit emersus.ai/app on a real iPhone.
  - Run through the Phase A acceptance checklist in the spec.

---

# Phase B — App shell chrome

## Task B1: Safe-area insets on top-bar and sticky bars

**Files:**
- Modify: `shared/chrome.css` — top-bar padding.
- Modify: `shared/train-v2.css` — `.tr-bottom-bar` padding.

- [ ] **Step 1: Edit `shared/chrome.css` top-bar rule.**

Find `.top-bar { ... padding: 14px 28px; ... }` and replace:

```css
.top-bar {
  /* ...existing rules... */
  padding:
    max(14px, env(safe-area-inset-top))
    max(20px, env(safe-area-inset-right))
    14px
    max(20px, env(safe-area-inset-left));
}
```

- [ ] **Step 2: Edit `shared/train-v2.css` sticky bottom bar.**

Find `.tr-bottom-bar` and add:

```css
.tr-bottom-bar {
  /* ...existing rules... */
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}
```

- [ ] **Step 3: Verify on iPhone 14 emulation (390 × 844).**

Notch should not clip the top-bar title; home-indicator area should not overlap the sticky submit button.

- [ ] **Step 4: Commit**

```bash
git add shared/chrome.css shared/train-v2.css
git commit -m "fix(mobile): safe-area insets on top-bar + train bottom bar

Top-bar padding now maxes between the static 14/20 px and
env(safe-area-inset-top/left/right) so the notch + rounded corners
don't clip content. Train's sticky submit bar pads the home-indicator
gesture zone.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task B2: Tab bar horizontal scroll on phones

**Files:**
- Modify: `shared/chrome.css` — `.tabs` responsive behavior.

- [ ] **Step 1: Find the existing `.tabs` rule.**

```bash
grep -nE "^\.tabs\b" shared/chrome.css
```

- [ ] **Step 2: Add mobile overflow-scroll block.**

Append at the end of the `.tabs` section:

```css
@media (max-width: 640px) {
  .tabs {
    overflow-x: auto;
    overflow-y: hidden;
    gap: 20px;
    padding: 0 16px;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tab {
    scroll-snap-align: start;
    flex-shrink: 0;
  }
}
```

- [ ] **Step 3: Verify on /app/train at 375 × 667.**

  - Four modality tabs (Lift / Cardio / Swim / Climb) scroll horizontally when they overflow.
  - No visible scrollbar.
  - Swipe snaps to each tab start.
  - Desktop: no change.

- [ ] **Step 4: Commit**

```bash
git add shared/chrome.css
git commit -m "fix(mobile): tabs scroll horizontally on phones, no visible scrollbar

The shared Tabs component used fixed gap: 40px with no overflow rule,
so tab bars (Train modality, Nutrition top tabs, Progress filters,
Profile tabs) ran off-screen at ≤ 640 px. Now scroll-x with
scroll-snap-type: x mandatory and hidden scrollbar.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task B3: Chat top-bar pill overflow

**Files:**
- Modify: `shared/chat-v2.css` — pill collapse rules at `@max-width: 500px`.

- [ ] **Step 1: Add a new mobile breakpoint block at the bottom of `chat-v2.css`.**

```css
@media (max-width: 500px) {
  /* Top-bar pills collapse to icon-only on narrow phones so they fit
   * alongside the title + ⋯ menu without wrapping. */
  [data-chat-v2="1"] .chat-top-bar .pill.model .model-pill-label,
  [data-chat-v2="1"] .chat-top-bar .pill.pill-sources .pill-label {
    display: none;
  }
  [data-chat-v2="1"] .chat-top-bar .pill.model,
  [data-chat-v2="1"] .chat-top-bar .pill.pill-sources {
    padding: 6px 8px;
  }
  /* Title ellipsizes instead of wrapping. */
  [data-chat-v2="1"] .chat-top-bar .chat-title {
    max-width: 55vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Share button icon-only. */
  [data-chat-v2="1"] .chat-top-bar .share-btn .share-btn-label {
    display: none;
  }
}
```

- [ ] **Step 2: Verify existing labels have the classes this CSS targets.**

```bash
grep -nE "model-pill-label|pill-label|share-btn-label" shared/chat shared/*.js
```

If the labels don't have those classes, wrap the pill text in a `<span class="model-pill-label">...</span>` etc. in `shared/chat/top-bar.js`. Add the class where needed.

- [ ] **Step 3: Verify on 375 × 667.**

  - Title ellipsizes if long.
  - Model pill shows just the pill + dot (no "Emersus 0.5" text).
  - Sources pill shows just the count (no "sources cited" text).
  - Share icon no text.
  - ⋯ menu unchanged.

- [ ] **Step 4: Commit**

```bash
git add shared/chat-v2.css shared/chat/top-bar.js
git commit -m "fix(mobile): chat top-bar pills collapse to icon on narrow phones

Below 500 px the pill label spans are display: none, title is clipped to
55 vw with ellipsis, share button goes icon-only. ⋯ menu stays so rename
+ share fallbacks are always reachable.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task B4: `overflow-x: hidden` belt on app pages

**Files:**
- Modify: `shared/train-v2.css`, `shared/nutrition-v2.css`, `shared/progress-v2.css`, `shared/profile-v2.css` — add a defensive overflow rule at the top.

- [ ] **Step 1: Add the rule at the top of each file (after any existing `@import` or comment header).**

```css
/* Defensive belt: prevent any child with unexpected width from creating
 * a horizontal scroll on narrow phones. */
body {
  overflow-x: hidden;
}
```

Apply verbatim to all four files.

- [ ] **Step 2: Verify at 320 px (smallest realistic phone).**

Load /app/train, /app/nutrition, /app/progress, /app/profile at 320 px wide. No horizontal scrollbar appears.

- [ ] **Step 3: Commit**

```bash
git add shared/train-v2.css shared/nutrition-v2.css shared/progress-v2.css shared/profile-v2.css
git commit -m "fix(mobile): overflow-x: hidden belt on app page bodies

Defensive guard so any accidentally-wide child (inline style, widget,
unstyled table) can't create a horizontal scroll at narrow widths.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task B5: Phase B changelog + push

- [ ] **Step 1: Append changelog entry.**

```markdown
- 2026-04-15 — Mobile chrome fixes — Phase B. (B1) `env(safe-area-inset-*)` applied to `.top-bar` (`shared/chrome.css`) and `.tr-bottom-bar` (`shared/train-v2.css`) so iPhone notch + home-indicator don't clip content. (B2) `.tabs` now `overflow-x: auto` with hidden scrollbar + `scroll-snap-type: x mandatory` at `≤ 640 px`, unblocking Train modality tabs (and all other tabs) at 375 px. (B3) Chat top-bar pills collapse to icon-only at `≤ 500 px`, title ellipsizes at 55 vw. (B4) `body { overflow-x: hidden }` defensive belt added to `train-v2`, `nutrition-v2`, `progress-v2`, `profile-v2` so rogue inline widths can't create horizontal scrollbars. — `shared/chrome.css`, `shared/chat-v2.css`, `shared/train-v2.css`, `shared/nutrition-v2.css`, `shared/progress-v2.css`, `shared/profile-v2.css`, `shared/chat/top-bar.js`
```

- [ ] **Step 2: Push Phase B.**

```bash
git add changelog.md
git commit -m "docs(changelog): mobile Phase B — safe-area + tabs scroll + pill collapse"
git push origin main
```

- [ ] **Step 3: Post-deploy verification** — Phase B acceptance checklist from the spec.

---

# Phase C — Touch targets, breakpoint coverage, widget polish

## Task C1: Touch targets ≥ 44 × 44 on phones

**Files:**
- Modify: `shared/chat-v2.css` — bump sizes inside `@max-width: 768px`.

- [ ] **Step 1: Add touch-target bumps to the existing `@media (max-width: 768px)` block.**

Append inside the existing block you created in Task A2:

```css
@media (max-width: 768px) {
  /* (previous A2 rules still present) */

  /* Touch targets — Apple HIG 44x44 minimum. */
  [data-chat-v2="1"] .submit-orb {
    width: 44px;
    height: 44px;
  }
  [data-chat-v2="1"] .stop-btn {
    min-height: 40px;
    min-width: 88px;
  }
  [data-chat-v2="1"] .srcs-chip {
    width: 32px;
    height: 30px;
    font-size: 11px;
  }
  [data-chat-v2="1"] .pill,
  [data-chat-v2="1"] .pill.model,
  [data-chat-v2="1"] .pill.pill-sources {
    padding: 6px 10px;
    min-height: 32px;
  }
  [data-chat-v2="1"] .srcs-row .mini-link {
    min-height: 32px;
    display: inline-flex;
    align-items: center;
  }
  [data-chat-v2="1"] .msg-action {
    min-height: 32px;
    padding: 6px 10px;
  }
}
```

- [ ] **Step 2: Verify with Chrome devtools "Inspect element → Computed → hit area".**

Hover each interactive control; the dashed outline should be ≥ 44 × 44 (or at least 32 × 32 for non-primary controls).

- [ ] **Step 3: Commit**

```bash
git add shared/chat-v2.css
git commit -m "a11y(mobile): bump touch targets to ≥ 44x44 (submit orb, chips, pills)

Apple HIG minimum for primary tap targets is 44x44. On phones:
.submit-orb 36→44, .srcs-chip 26→32, .pill min-height 32, .msg-action
min-height 32, .stop-btn min-height 40 / min-width 88. Desktop
unchanged.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task C2: Responsive message padding

**Files:**
- Modify: `shared/chat-v2.css`

- [ ] **Step 1: Find the `.message` rule.**

```bash
grep -nE "^\[data-chat-v2=\"1\"\] \.message\b" shared/chat-v2.css
```

- [ ] **Step 2: Add two step-downs inside the mobile blocks.**

```css
@media (max-width: 640px) {
  [data-chat-v2="1"] .message {
    padding: 20px 16px;
  }
}
@media (max-width: 500px) {
  /* Welcome/empty-state scales down so it doesn't dominate the short screen. */
  [data-chat-v2="1"] .thread-welcome-title {
    font-size: 22px;
  }
  [data-chat-v2="1"] .thread-welcome-copy {
    font-size: 14px;
  }
}
@media (max-width: 400px) {
  [data-chat-v2="1"] .message {
    padding: 16px 12px;
  }
  [data-chat-v2="1"] .msg-body {
    font-size: 14.5px;
  }
  /* Empty-state prompt chips go single-column so each is thumb-tappable
   * without horizontal crowding. */
  [data-chat-v2="1"] .empty-prompts-row {
    flex-direction: column;
    align-items: stretch;
  }
  [data-chat-v2="1"] .empty-prompt-chip {
    width: 100%;
  }
}
```

- [ ] **Step 3: Verify.** Messages at 320/375/414/768/1024. Padding should step down predictably without the prose feeling cramped.

- [ ] **Step 4: Commit**

```bash
git add shared/chat-v2.css
git commit -m "fix(mobile): responsive message padding — 32/20/16 px step-down

Message bubble had padding: 32px 28px at all widths, crushing prose on
phones. Now steps down to 20px 16px at ≤ 640 px and 16px 12px at
≤ 400 px. Font-size drops 0.5 px at the narrowest step.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task C3: Widget iframe viewport clamp

**Files:**
- Modify: `shared/emersus-renderer.js` — wrapper style + iframe CSS addition.

- [ ] **Step 1: Find the WidgetFrame `iframe` element render.**

```bash
grep -nE "h\(\"iframe\"" shared/emersus-renderer.js
```

- [ ] **Step 2: Clamp the iframe width at the React level.**

In the `style` object passed to the iframe (already includes `width: "100%"`), verify `maxWidth: "100%"` is present. If not, add it:

```js
style: {
  width: "100%",
  maxWidth: "100%",          // add if missing
  height: "260px",
  maxHeight: `${MAX_WIDGET_FRAME_HEIGHT}px`,
  border: "none",
  background: "transparent",
  display: "block",
},
```

- [ ] **Step 3: Clamp the iframe's internal body width.**

In `EMERSUS_THEME_CSS`, find the `html, body { ... }` block. Add `max-width: 100vw; overflow-x: hidden;`:

```css
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.5;
  letter-spacing: -0.005em;
  overflow-wrap: break-word;
  word-wrap: break-word;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  max-width: 100vw;        /* add */
  overflow-x: hidden;      /* add */
}
```

- [ ] **Step 4: Verify.** Generate a widget containing a wide table / chart (e.g., "show me a weekly protein chart for 4 people at 2.2 g/kg"). Confirm at 375 px the widget fits without horizontal page scroll.

- [ ] **Step 5: Syntax check + commit.**

```bash
node --check shared/emersus-renderer.js
git add shared/emersus-renderer.js
git commit -m "fix(mobile): widget iframes clamp to viewport width

Previously iframes could overflow the page width when a widget emitted
a wide table or chart. Added max-width: 100% on the iframe style object
and max-width: 100vw + overflow-x: hidden on the injected html/body
inside the iframe.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task C4: Auth input zoom guard

**Files:**
- Modify: `shared/auth-v2.css`

- [ ] **Step 1: Add a phone-width override.**

Append at the bottom of `shared/auth-v2.css`:

```css
@media (max-width: 640px) {
  .auth-form input,
  .auth-form select,
  .auth-form textarea {
    font-size: 16px;
  }
}
```

(Targets auth form only — profile already uses 14 px intentionally.)

- [ ] **Step 2: Verify.** Load `/auth/login/` on an iOS emulator. Tap the email field. Viewport should NOT zoom.

- [ ] **Step 3: Commit**

```bash
git add shared/auth-v2.css
git commit -m "fix(mobile): auth input font-size 16 px to avoid iOS zoom

Older iOS Safari zooms the viewport when focused input has font-size
< 16 px. Auth inputs were 14 px. Bumped to 16 px at ≤ 640 px.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task C5: Phase C changelog + push

- [ ] **Step 1: Append changelog entry.**

```markdown
- 2026-04-15 — Mobile polish — Phase C. (C1) Touch targets bumped to Apple HIG 44x44 min at `≤ 768 px`: `.submit-orb` 36→44, `.srcs-chip` 26→32, `.pill`/`.msg-action` min-height 32, `.stop-btn` 40x88. (C2) Message bubble padding steps down: 32 px → 20 px (≤ 640 px) → 16 px (≤ 400 px), with `.msg-body` font-size dropping 0.5 px at the narrow step. (C3) Widget iframes now clamp to viewport width: `max-width: 100%` on the iframe element + `max-width: 100vw; overflow-x: hidden` inside the iframe body. (C4) Auth form inputs `font-size: 16 px` at `≤ 640 px` to suppress iOS focus-zoom. — `shared/chat-v2.css`, `shared/emersus-renderer.js`, `shared/auth-v2.css`
```

- [ ] **Step 2: Push Phase C.**

```bash
git add changelog.md
git commit -m "docs(changelog): mobile Phase C — touch targets + padding + iframe clamp + auth zoom"
git push origin main
```

- [ ] **Step 3: Final verification** — run the full manual test matrix from the spec:

  - iPhone SE (375 × 667)
  - iPhone 14 (390 × 844)
  - Pixel 7 (412 × 915)
  - iPad mini (744 × 1133)
  - Desktop (1440 × 900) — byte-identical

Tick every acceptance criterion bullet in the spec.

---

## Execution notes

- **Commit discipline:** one commit per task, even if touching the same file.
- **Desktop regression check after EACH task:** load /app/ at 1440 × 900, compare to the pre-task screenshot. If anything shifts pixels, the task is broken.
- **Webhook deploy** fires on every push, so expect each phase to be live on emersus.ai within ~2 min. Real-device verification is the acceptance gate.
- **If blocked on a device-specific bug** (e.g., the sidebar drawer animation stutters on specific Androids), stop and ask — don't guess.

## Self-review checklist

- [ ] Every spec section maps to a task (A1-A5 cover spec Phase A; B1-B5 cover Phase B; C1-C5 cover Phase C).
- [ ] No "TODO", "TBD", "similar to", placeholder pattern in any step.
- [ ] Every file reference is absolute from repo root.
- [ ] Every commit message is the full heredoc, not an intent.
- [ ] Every code block is the real snippet, not pseudocode.
- [ ] Desktop regression is an explicit gate in every phase.
