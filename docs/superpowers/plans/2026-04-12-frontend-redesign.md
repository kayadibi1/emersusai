# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the neon glassmorphism aesthetic with a typographic minimalist design — Georgia + JetBrains Mono + #78dc14 accent on #08080a dark base — across every frontend page.

**Architecture:** Rewrite three CSS files (styles.css, shared/site.css, shared/chat.css) that define the visual layer. Update HTML pages to swap font imports and remove inline CSS overrides. Update React components in script.js (landing page) and shared/react-chat-app.js to use new class names/styles. Update widget theme tokens in shared/emersus-renderer.js. The 3D canvas, GSAP animations, and all backend code remain untouched.

**Tech Stack:** CSS custom properties, Google Fonts (JetBrains Mono), Georgia system serif, HTML, React 18 (via esm.sh, no build step).

**Design spec:** `docs/superpowers/specs/2026-04-12-frontend-redesign-design.md`
**Mockup reference:** `.superpowers/brainstorm/25384-1776028424/content/page-*.html`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Rewrite | `styles.css` | Landing page styles (all sections, responsive) |
| Rewrite | `shared/site.css` | Design system + app page styles (dashboard, workout, nutrition, progress, profile, auth) |
| Rewrite | `shared/chat.css` | Chat 3-column layout + conversation styles |
| Modify | `index.html` | Swap font imports (Inter/Space Grotesk → JetBrains Mono) |
| Modify | `script.js:932-1118` | Landing React components (new markup + classes). **DO NOT touch lines 1-930 or 1119+** |
| Modify | `shared/emersus-renderer.js:50-263` | Widget theme CSS tokens (colors, fonts, gradients → new palette) |
| Modify | `shared/react-chat-app.js` | Inline style objects (WorkoutPlanCard, ChatToolCard, etc.) |
| Modify | `app/index.html` | Remove inline CSS, swap font import |
| Modify | `app/workout/index.html` | Remove inline CSS, swap font import |
| Modify | `app/workout/session/index.html` | Swap font import |
| Modify | `app/nutrition/index.html` | Remove inline CSS (warm-amber theme), swap font import |
| Modify | `app/profile/index.html` | Swap font import |
| Modify | `app/progress/index.html` | Remove inline CSS, swap font import |
| Modify | `app/progress/session/index.html` | Swap font import |
| Modify | `chat/index.html` | Remove inline CSS (duplicated chat styles), swap font import |
| Modify | `auth/login/index.html` | Swap font import |
| Modify | `auth/signup/index.html` | Swap font import |
| Modify | `auth/forgot-password/index.html` | Swap font import |
| Modify | `auth/reset-password/index.html` | Swap font import |

---

## Task 1: Rewrite shared/site.css — Global Design System

**Files:**
- Rewrite: `shared/site.css`

This is the foundation. Every authenticated page imports this file. All CSS tokens, base styles, top bar, cards, stat cards, buttons, inputs, dashboard layout, and responsive rules.

- [ ] **Step 1: Read the current shared/site.css to understand every class name referenced by HTML pages**

Run: Read `shared/site.css` in full. Note every class name. These classes are referenced in HTML files — renaming them requires updating HTML too. Where possible, keep class names and just change their styles.

- [ ] **Step 2: Rewrite shared/site.css with the new design system**

Replace the entire file. The new file must:

1. Import JetBrains Mono from Google Fonts
2. Define all CSS custom properties on `:root`:
   ```css
   :root {
     --bg: #08080a;
     --surface: rgba(255,255,255,0.03);
     --line: rgba(255,255,255,0.06);
     --ink: #e8e8e8;
     --muted: #666;
     --dim: #3a3a3a;
     --accent: #78dc14;
     --accent-soft: rgba(120,220,20,0.08);
     --accent-line: rgba(120,220,20,0.18);
     --danger: #ff8f9d;
     --protein: #4d8df5;
     --carbs: #78dc14;
     --fat: #e8a838;
     --serif: Georgia, 'Times New Roman', serif;
     --mono: 'JetBrains Mono', monospace;
     --sans: system-ui, -apple-system, sans-serif;
   }
   ```
3. Base element resets (body, *, a)
4. Grid texture on `body::before`
5. Top bar: `.topbar`, `.topbar-brand`, `.topbar-nav`, `.topbar-nav a`, `.topbar-avatar`
6. Page layout: `.main`, `.page-header`, `.page-eyebrow`
7. Welcome block: `.welcome`, `.welcome-eyebrow`, `.welcome h1`, `.welcome-sub`
8. Stat cards: `.stat-row`, `.stat-card`, `.stat-card-label`, `.stat-card-value`, `.stat-card-meta`
9. Dashboard cards: `.dash-grid`, `.dash-card`, `.dash-card-header`, `.dash-card-title`
10. Session card: `.session-card`, `.session-exercises`, `.session-start`
11. Buttons: primary (`.btn-primary`) and secondary (`.btn-secondary`)
12. Form inputs: `input`, `select`, `textarea` base styles
13. Auth card: `.auth-card` (centered card for login/signup)
14. Sidebar patterns: `.sidebar`, `.sidebar-label`, plan items
15. Week grid: `.week-grid`, `.day-col`, day labels
16. Exercise table: `.exercise-table th`, `.exercise-table td`
17. Nutrition: calorie ring, macro bars, meal cards, date nav
18. Progress: time-range pills, chart containers
19. `[data-auth-ready]` flicker guard (keep existing behavior)
20. Responsive breakpoints at 980px and 720px

Reference the mockups in `.superpowers/brainstorm/25384-1776028424/content/page-2-dashboard.html` through `page-5-nutrition.html` for exact values.

Remove all: glassmorphism (`backdrop-filter`), radial gradient corner accents, neon colors (#9ffb00, #ff44cc, #cc44ff, #00ffcc, #6d9fff), Space Grotesk / Inter font references, box-shadows on cards, `cta-pulse` / `nut-*` keyframes.

- [ ] **Step 3: Verify by starting the server and checking dashboard**

Run: `node server.js` (if not already running), open `http://127.0.0.1:3001/app/` in browser. Confirm the dashboard renders with the new typography, colors, and layout. Check that the top bar, stat cards, and dashboard cards look correct.

- [ ] **Step 4: Commit**

```bash
git add shared/site.css
git commit -m "style: rewrite shared/site.css with new design system

Georgia serif + JetBrains Mono + #78dc14 accent on #08080a base.
Removes glassmorphism, neon colors, Space Grotesk/Inter."
```

---

## Task 2: Update All HTML Font Imports

**Files:**
- Modify: `index.html`
- Modify: `app/index.html`, `app/workout/index.html`, `app/workout/session/index.html`, `app/nutrition/index.html`, `app/profile/index.html`, `app/progress/index.html`, `app/progress/session/index.html`
- Modify: `chat/index.html`
- Modify: `auth/login/index.html`, `auth/signup/index.html`, `auth/forgot-password/index.html`, `auth/reset-password/index.html`

Every HTML page has a Google Fonts `<link>` importing Inter and/or Space Grotesk. Replace all of them with JetBrains Mono.

- [ ] **Step 1: Replace font imports across all HTML files**

Find every `<link>` tag containing `fonts.googleapis.com` that loads Inter or Space Grotesk. Replace with:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Note: `chat/index.html` also imports Material Symbols Outlined — keep that import, only replace the Inter/Space Grotesk one.

- [ ] **Step 2: Remove inline `<style>` blocks from HTML pages that override site.css**

These pages have inline `<style>` blocks that define page-specific overrides using the old design tokens. Remove them — the new `shared/site.css` will contain all needed styles:

- `app/index.html` — inline styles for dashboard cards, today-card accent
- `app/workout/index.html` — inline styles for sidebar, plan buttons, active plan
- `app/nutrition/index.html` — entire warm-amber sub-theme (Playfair Display, DM Sans, amber tokens, nut-* keyframes)
- `app/progress/index.html` — inline styles for time-range pills, stat grid, exercise icons
- `chat/index.html` — inline styles that duplicate/override shared/chat.css

For each file, read it first to locate the `<style>` block, then remove it. Keep all `<script>` tags and HTML structure intact.

- [ ] **Step 3: Spot-check auth pages**

Open `http://127.0.0.1:3001/auth/login/` in browser. Confirm font has changed from Inter to JetBrains Mono on labels and the page uses the new color scheme.

- [ ] **Step 4: Commit**

```bash
git add index.html app/ chat/index.html auth/
git commit -m "style: swap font imports to JetBrains Mono, remove inline CSS overrides

All HTML pages now load JetBrains Mono instead of Inter/Space Grotesk.
Removed inline <style> blocks from dashboard, workout, nutrition,
progress, and chat pages — styles now come from shared/site.css."
```

---

## Task 3: Rewrite styles.css — Landing Page

**Files:**
- Rewrite: `styles.css`

The landing page CSS. Must define styles for all class names used by the React components in `script.js:932-1095` (`.nav`, `.brand`, `.nav-links`, `.nav-cta`, `.hero`, `.eyebrow`, `.headline`, `.subtitle`, `.button-primary`, `.button-secondary`, `.glass-card`, `.icon`, `.card-title`, `.card-copy`, `.steps`, `.step-card`, `.step-number`, `.step-title`, `.step-copy`, `.quote-grid`, `.quote-card`, `.quote-copy`, `.quote-author`, `.cta`, `.section`, `.section-inner`, `.section-title`, `.section-copy`, `.footer`, `.landing-shell`, `.hero-actions`, `.grid-3`, `.waitlist-form`, `.waitlist-feedback`, `.danger-word`, `.gradient`, `.quote-gap`, `.large`).

- [ ] **Step 1: Read current styles.css and the landing mockup**

Read `styles.css` in full. Then read `.superpowers/brainstorm/25384-1776028424/content/page-1-landing-v3.html` for the target design. Map mockup styles to existing class names.

- [ ] **Step 2: Rewrite styles.css**

Replace the entire file. Key requirements:
1. Use the same CSS custom properties as shared/site.css (can redefine `:root` or import)
2. `body::before` grid texture (same as site.css)
3. `.landing-shell` — `position: relative; z-index: 1`
4. `.nav` — sticky, gradient fade background (`rgba(8,8,10,0.95)` → transparent), flex between brand and links
5. `.brand` — JetBrains Mono, 0.88rem, weight 600, letter-spacing 0.3em, uppercase, color #aaa
6. `.nav-links a` — JetBrains Mono, 0.68rem, #555, uppercase
7. `.nav-cta` — accent background, dark text, rounded
8. `.section` — padding: 6rem 3.5rem
9. `.section-inner` — max-width if needed
10. `.eyebrow` — JetBrains Mono, 0.78rem, accent color, uppercase, letter-spacing 0.35em
11. `.headline` — Georgia serif, clamp(2.8rem, 6vw, 4.2rem), weight 400, -0.03em tracking
12. `.subtitle` — system sans, 1.05rem, color #666
13. `.danger-word`, `.gradient` — keep as color accents but using new palette (accent color or dimmed)
14. `.button-primary` — accent bg, dark text, mono font, uppercase
15. `.button-secondary` — transparent, text link with underline
16. `.hero-actions` — flex row with gap
17. `.grid-3` — 3-column grid, 1.5rem gap
18. `.glass-card` — 1px border (var(--line)), 8px radius, 2rem padding, hover → accent-line border. **NO glassmorphism / backdrop-filter.**
19. `.icon` — JetBrains Mono, accent color (the "01" numbers)
20. `.card-title` — Georgia serif, 1.3rem
21. `.card-copy` — sans, 0.88rem, color #666
22. `.steps` — 4-column grid, 1.2rem gap
23. `.step-card` — border card, starts `opacity: 0; transform: translateY(34px)` for GSAP animation. **Critical: keep this initial state or GSAP scroll trigger won't work.**
24. `.step-number` — JetBrains Mono, accent, small
25. `.step-title` — Georgia serif
26. `.step-copy` — sans, dim color
27. `.quote-grid` — 2-column grid
28. `.quote-card` — border card. `.large` variant gets more padding
29. `.quote-copy` — Georgia serif, large, color #ccc
30. `.quote-author` — JetBrains Mono, accent
31. `.cta` — centered, large vertical padding
32. `.waitlist-form` — inline-grid, input + button
33. `.waitlist-feedback` — mono text, color states (success = accent, error = danger)
34. `.footer` — mono text, flex between, border-top
35. `.section-title` — Georgia serif, ~2.4rem
36. `.section-copy` — sans, muted color
37. Text blur utilities: `.text-blur` and `.text-blur-strong` using `text-shadow` with background color at varying radii (30px/60px/100px and 40px/80px/120px/200px)
38. `#bg-canvas` — fixed, inset 0, z-index 0 (keep existing positioning)
39. Responsive rules at 900px and 720px breakpoints

- [ ] **Step 3: Verify landing page renders correctly with 3D background**

Open `http://127.0.0.1:3001/` in browser. Verify:
- 3D neuron animation still renders and animates behind content
- Scroll triggers still fire (step cards animate in)
- Lenis smooth scroll still works
- New typography (Georgia headlines, JetBrains Mono labels) is applied
- No neon colors visible
- Text is readable over the 3D canvas (text-shadow blur)

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "style: rewrite landing page CSS — typographic minimalist

Georgia headlines, JetBrains Mono labels, #78dc14 accent.
Preserves .step-card initial state for GSAP scroll animation.
Text-shadow blur for readability over 3D canvas."
```

---

## Task 4: Update Landing Page React Components in script.js

**Files:**
- Modify: `script.js:932-1118` ONLY

**CRITICAL SAFETY RULE:** Do NOT modify any line outside the range 932-1118. Lines 1-930 contain Three.js utilities, neuron geometry, and the WaitlistForm component. Lines 1119+ contain `initAnanNeuronBackground`, `initScaleBackground`, and the mount calls. Modifying these will break the 3D animation.

- [ ] **Step 1: Read the current components (lines 932-1118)**

Understand the component structure and which class names each uses. The React components use `h()` (createElement shorthand).

- [ ] **Step 2: Update the React component markup to match the new design**

Modify the components to match the mockup content and structure. Key changes:

**OldCopyNav (932-947):** Update brand text from "Emersus AI" to "Emersus". Add `text-blur` class to nav links. Keep all href paths the same.

**OldCopyHero (949-967):** Update eyebrow text to "Evidence-Based Fitness Intelligence". Update headline — the mockup uses "Your body deserves better than guesswork." Keep the `.text-blur-strong` class on headline. Update subtitle text. Update button text.

**OldCopyFeatures (969-998):** Update eyebrow to "What you get". Keep the feature cards but can update copy to match mockup. Add `text-blur` class to text elements.

**OldCopyOptimization (1000-1029):** Update to match "How it works" section from mockup. Use STEP 01/02/03/04 numbering.

**OldCopyProtocol (1031-1056):** Restructure to match the quote + side panel layout from mockup.

**OldCopyFinalCta (1058-1072):** Update text to match "Ready to train smarter?" CTA from mockup.

**OldCopyFooter (1074-1081):** Update to "Emersus © 2025" with Privacy/Terms/Contact links.

**mountLanding (1097-1118):** Do NOT change. The GSAP `.step-card` scroll trigger must remain exactly as-is.

- [ ] **Step 3: Add text-blur classes to components**

Add `className` additions for `text-blur` and `text-blur-strong` to the appropriate elements (headlines get strong, body text gets regular). Do this by appending to existing className strings, e.g., `className: "headline text-blur-strong"`.

- [ ] **Step 4: Verify landing page still works end-to-end**

Open `http://127.0.0.1:3001/` — verify:
- All sections render with updated copy
- GSAP scroll trigger on step-cards still fires
- 3D animation untouched
- No console errors

- [ ] **Step 5: Commit**

```bash
git add script.js
git commit -m "feat: update landing page React components for redesign

New copy, text-blur classes, updated section structure.
3D canvas, GSAP, and Lenis code untouched (outside edit range)."
```

---

## Task 5: Rewrite shared/chat.css — Chat Interface

**Files:**
- Rewrite: `shared/chat.css`

- [ ] **Step 1: Read the current shared/chat.css and the chat mockup**

Read `shared/chat.css` in full. Read `.superpowers/brainstorm/25384-1776028424/content/page-3-chat.html` for target design. Map classes.

- [ ] **Step 2: Rewrite shared/chat.css**

Replace entire file. The chat page uses the tokens from shared/site.css (imported via HTML `<link>`). This file only defines chat-specific layout:

1. 3-column grid layout: `.layout` — `grid-template-columns: 260px 1fr 280px; height: 100vh`
2. History sidebar: `.history`, `.history-brand`, `.history-label`, `.history-new`, `.thread`, `.thread.active`, `.thread-title`, `.thread-time`
3. Chat center: `.chat`, `.chat-header`, `.chat-topic`, `.chat-meta`, `.messages`
4. Message bubbles: `.msg-user`, `.msg-user .bubble`, `.msg-ai`, `.msg-ai-label`, `.msg-ai .bubble`, `.msg-ai .sources`
5. Widget frame: `.msg-widget`, `.widget-frame`, `.widget-label`
6. Composer: `.composer`, `.composer-box`, `.composer-input`, `.composer-send`
7. Context rail: `.rail`, `.rail-section`, `.rail-label`, `.rail-item`, `.rail-tag`
8. Responsive: collapse rail at 980px, collapse history at 720px

Important: check which class names `shared/react-chat-app.js` actually references and ensure they match. The JS file uses classes like `chat-card`, `chat-tool-card`, `chat-tool-header` — keep these or add them.

- [ ] **Step 3: Verify chat page**

Open `http://127.0.0.1:3001/chat/` (requires login). Verify 3-column layout, message styles, and composer.

- [ ] **Step 4: Commit**

```bash
git add shared/chat.css
git commit -m "style: rewrite chat.css — 3-column layout with new design system

History sidebar, conversation with accent-bordered AI messages,
context rail. Responsive collapse at 980px and 720px."
```

---

## Task 6: Update shared/react-chat-app.js Inline Styles

**Files:**
- Modify: `shared/react-chat-app.js`

- [ ] **Step 1: Read the inline style objects in react-chat-app.js**

Search for all `style:` and `Style` object definitions. Key areas:
- WorkoutPlanCard component (~lines 924-1142) — large style object
- ChatToolCard component (~lines 582-637) — card, header, content styles
- Text/evidence rendering (~lines 782-826) — bubble styles, danger colors
- Any other inline `style: { ... }` patterns

- [ ] **Step 2: Update inline style values to match new palette**

For each inline style object found:
- Replace `#6d9fff` / `var(--primary)` → `#78dc14` (accent)
- Replace `#9ffb00` / `var(--secondary)` → `#78dc14` (same accent, no dual-color)
- Replace `Space Grotesk` → `Georgia, serif` (for display text)
- Replace `Inter` → `system-ui, -apple-system, sans-serif` (for body text)
- Replace any `backdrop-filter` / glassmorphism → simple borders
- Replace bright neon colors with the new muted palette (#e8e8e8 for text, #666 for secondary, #3a3a3a for dim)
- Update `background` values that use radial gradients → `rgba(255,255,255,0.03)` or transparent
- Keep the same property names and structure — only change values

- [ ] **Step 3: Verify chat with workout plan cards**

If you have an existing chat thread that shows a workout plan card, check it renders correctly. Otherwise verify no console errors on the chat page.

- [ ] **Step 4: Commit**

```bash
git add shared/react-chat-app.js
git commit -m "style: update inline styles in react-chat-app.js

Replace neon colors and glassmorphism with new design tokens.
Georgia for display, system-ui for body, #78dc14 accent."
```

---

## Task 7: Update Widget Theme in shared/emersus-renderer.js

**Files:**
- Modify: `shared/emersus-renderer.js:50-263`

- [ ] **Step 1: Read EMERSUS_THEME_CSS (lines 50-263)**

Understand all token names. These are injected into sandboxed widget iframes. Widget HTML from the LLM references these tokens. Keep token NAMES the same — only change VALUES.

- [ ] **Step 2: Update the CSS token values**

In the `EMERSUS_THEME_CSS` template literal:

```
Font import: Replace Inter + Space Grotesk → JetBrains Mono
--color-background-primary: rgba(255,255,255,0.03)  (was gradient)
--color-background-secondary: rgba(255,255,255,0.06)
--color-background-tertiary: rgba(255,255,255,0.10)
--color-text-primary: #e8e8e8  (was #f9f9fd)
--color-text-secondary: #888  (was #a7adb4)
--color-text-tertiary: #555  (was #6f7480)
--color-border-primary: rgba(255,255,255,0.06)  (was 0.22)
--color-border-secondary: rgba(255,255,255,0.06)
--color-border-tertiary: rgba(255,255,255,0.06)
--color-background-success: rgba(120,220,20,0.10)  (was lime)
--color-text-success: #78dc14
--accent-primary: #78dc14  (was #6d9fff)
--accent-secondary: #78dc14  (was #9ffb00)
--ev-strong-bg/text/dot: use accent-based values
--font-sans: system-ui, -apple-system, sans-serif  (was Inter)
--font-display: Georgia, 'Times New Roman', serif  (was Space Grotesk)
```

Also update the element styles section (lines ~118-262) to remove `backdrop-filter`, glassmorphism, and any inline color values that reference the old palette.

- [ ] **Step 3: Verify a widget renders correctly in chat**

Open a chat conversation that has a widget. Verify the widget iframe shows the new color scheme (dark bg, correct accent, correct fonts).

- [ ] **Step 4: Commit**

```bash
git add shared/emersus-renderer.js
git commit -m "style: update widget theme CSS tokens for redesign

New palette (#78dc14 accent, #08080a base), Georgia + JetBrains Mono.
Token names preserved for backward compat with existing widget HTML."
```

---

## Task 8: Update Remaining HTML Pages Structure

**Files:**
- Modify: `app/index.html` — update class names if needed to match new site.css
- Modify: `app/workout/index.html` — update markup to use new classes
- Modify: `app/nutrition/index.html` — remove Playfair Display/DM Sans references, update to new classes
- Modify: `app/progress/index.html` — update to new classes
- Modify: `app/profile/index.html` — update to new classes

- [ ] **Step 1: Read each HTML file and map its class usage to new site.css**

For each file, check which CSS classes it uses and whether they exist in the new shared/site.css. Add missing classes to site.css if needed, or update the HTML to use existing classes.

- [ ] **Step 2: Update app/index.html (Dashboard)**

Ensure the HTML structure matches the dashboard mockup: topbar → welcome → stat-row → session-card → dash-grid. Update class names to match what's defined in site.css.

- [ ] **Step 3: Update app/workout/index.html**

Ensure sidebar + detail layout. Update plan-item classes, week-grid, session-detail, exercise-table classes.

- [ ] **Step 4: Update app/nutrition/index.html**

Remove all Playfair Display / DM Sans / warm-amber references. Update to use the global design system with macro-specific colors (--protein, --carbs, --fat). Ensure calorie ring, macro bars, and meal cards use new classes.

- [ ] **Step 5: Update app/progress/index.html**

Update time-range pills, stat cards, chart containers, session list to use new classes.

- [ ] **Step 6: Verify all app pages render correctly**

Navigate through each page at `http://127.0.0.1:3001/app/`, `/app/workout/`, `/app/nutrition/`, `/app/progress/`, `/app/profile/`. Confirm consistent design system across all pages.

- [ ] **Step 7: Commit**

```bash
git add app/
git commit -m "style: update all app page HTML for redesign

Dashboard, workout, nutrition, progress, profile pages now use
the new design system classes. Removed old inline overrides."
```

---

## Task 9: Update Auth Pages

**Files:**
- Modify: `auth/login/index.html`
- Modify: `auth/signup/index.html`
- Modify: `auth/forgot-password/index.html`
- Modify: `auth/reset-password/index.html`

- [ ] **Step 1: Read auth pages and update styles**

Auth pages are simpler — centered card with form. Ensure they use `.auth-card` from site.css, JetBrains Mono for labels, Georgia for headings. Keep the existing form structure and JavaScript (shared/auth-pages.js handles OAuth, email/password, etc.).

- [ ] **Step 2: Verify login page**

Open `http://127.0.0.1:3001/auth/login/`. Confirm dark background, centered card with border, correct fonts, accent-colored submit button.

- [ ] **Step 3: Commit**

```bash
git add auth/
git commit -m "style: reskin auth pages with new design system

Centered card layout, JetBrains Mono labels, accent submit buttons.
Same forms, same auth flows — visual changes only."
```

---

## Task 10: Final Visual QA Pass

**Files:** None (verification only)

- [ ] **Step 1: Full navigation test**

Visit every page in sequence and check for visual consistency:
1. `http://127.0.0.1:3001/` — Landing: 3D animation works, GSAP triggers, text readable
2. `http://127.0.0.1:3001/auth/login/` — Auth: centered card, correct fonts
3. `http://127.0.0.1:3001/app/` — Dashboard: stat cards, session card, nav cards
4. `http://127.0.0.1:3001/app/workout/` — Workout: sidebar, week grid, exercise table
5. `http://127.0.0.1:3001/app/nutrition/` — Nutrition: calorie ring, macro bars, meal cards
6. `http://127.0.0.1:3001/app/progress/` — Progress: pills, charts, sessions
7. `http://127.0.0.1:3001/app/profile/` — Profile: form fields, save button
8. `http://127.0.0.1:3001/chat/` — Chat: 3-column, messages, widgets

- [ ] **Step 2: Check for stale neon colors**

Search all modified files for any remaining references to the old palette:
```bash
grep -rn "#9ffb00\|#ff44cc\|#cc44ff\|#00ffcc\|#6d9fff\|Space.Grotesk\|Playfair.Display\|DM.Sans" styles.css shared/site.css shared/chat.css shared/emersus-renderer.js shared/react-chat-app.js
```

If any found, update them.

- [ ] **Step 3: Check for broken glassmorphism references**

```bash
grep -rn "backdrop-filter\|glass\|blur(" styles.css shared/site.css shared/chat.css
```

Only `text-shadow` blur should remain (in styles.css for landing page). No `backdrop-filter` anywhere.

- [ ] **Step 4: Responsive spot check**

Resize browser to ~720px width. Check that:
- Landing page: columns collapse to single column
- Dashboard: card grid goes single column
- Chat: rail collapses, then history collapses
- Nutrition: macro bars stack

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: visual QA cleanup for frontend redesign"
```
