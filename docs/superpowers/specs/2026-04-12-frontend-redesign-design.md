# Frontend Redesign — Design Spec

**Date:** 2026-04-12
**Status:** Superseded by `2026-04-15-frontend-redesign-design.md` (Linear-inspired chat-first IA, Space Grotesk + JetBrains Mono, Graphite · Jade / Paper · Royal palettes). The "Typographic Minimalist · Georgia serif · Monster Acid green" direction below was abandoned on 2026-04-15 before implementation.
**Scope:** Complete frontend visual redesign (all pages except 3D scroll animation / canvas background on landing page)

## Motivation

The current design uses neon lime (#9ffb00), hot pink (#ff44cc), purple (#cc44ff), and heavy glassmorphism with bloom effects. The aesthetic reads as aggressive and juvenile ("axe body spray commercial"). The goal is a refined, premium, typographically-led dark aesthetic inspired by topology.vc — confidence through restraint, not neon fireworks.

## Design Direction

**Typographic Minimalist** — near-monochrome dark base with a single vivid accent color. Typography hierarchy does the heavy lifting. Minimal decoration, generous whitespace, subtle grid texture.

## Design System

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#08080a` | Page background |
| `--surface` | `rgba(255,255,255,0.03)` | Elevated surfaces, input backgrounds |
| `--line` | `rgba(255,255,255,0.06)` | Borders, dividers |
| `--ink` | `#e8e8e8` | Primary text |
| `--muted` | `#666` | Secondary text, body copy |
| `--dim` | `#3a3a3a` | Tertiary text, metadata values |
| `--accent` | `#78dc14` | Monster Acid green — CTAs, eyebrow text, highlights, active states |
| `--accent-soft` | `rgba(120,220,20,0.08)` | Accent tint backgrounds (active cards, session cards) |
| `--accent-line` | `rgba(120,220,20,0.18)` | Accent border on hover/active states |
| `--danger` | (keep existing `#ff8f9d`) | Error states, destructive actions |

**Macro colors (nutrition page only):**

| Token | Value | Usage |
|-------|-------|-------|
| `--protein` | `#4d8df5` | Protein bars, labels |
| `--carbs` | `#78dc14` | Carb bars (same as accent) |
| `--fat` | `#e8a838` | Fat bars, labels |

### Typography

| Role | Font | Weight | Size Range | Letter-spacing | Case |
|------|------|--------|------------|----------------|------|
| Headlines, large data values | Georgia, 'Times New Roman', serif | 400 | 1.05rem – clamp(2.8rem, 6vw, 4.2rem) | -0.02em to -0.03em | Natural |
| Eyebrow, labels, metadata, nav, brand, CTAs | JetBrains Mono (Google Fonts) | 400–700 | 0.45rem – 0.88rem | 0.1em – 0.4em | Uppercase |
| Body copy, chat messages, descriptions | system-ui, -apple-system, sans-serif | 400 | 0.8rem – 1.05rem | Normal | Natural |

**Brand mark:** `EMERSUS` in JetBrains Mono, 0.88rem, weight 600, letter-spacing 0.3em, color #aaa.

### Texture & Effects

- **Grid texture:** Fixed-position 60×60px grid lines at `rgba(255,255,255,0.02)` — always visible behind content.
- **Text blur (landing page only):** `text-shadow` in the background color creates a soft glow that hugs the shape of letters, improving readability over the 3D canvas. Two levels:
  - `.text-blur`: `0 0 30px/60px/100px` at decreasing opacity — for body text, labels
  - `.text-blur-strong`: `0 0 40px/80px/120px/200px` — for headlines, large stat numbers
- **No glassmorphism.** No `backdrop-filter: blur()` on cards or panels. No radial gradient corner accents. Cards use simple `border: 1px solid var(--line)` only.
- **No box-shadows** on cards. Depth is conveyed through border color changes on hover.

### Spacing & Layout

- **Section padding:** 6rem vertical, 3.5rem horizontal
- **Card padding:** 1.4rem – 2rem
- **Card border-radius:** 8px (small), 10px (large)
- **Grid gaps:** 0.6rem (tight), 1.2rem (standard), 1.5rem (wide)
- **Dividers:** 1px solid var(--line) with 3.5rem horizontal margin

### Interactive States

- **Hover (cards):** `border-color` transitions to `var(--accent-line)` over 140ms ease
- **Active (sidebar items, plans):** `border-color: var(--accent-line); background: var(--accent-soft)`; left border accent on active thread in chat
- **Focus (inputs):** `border-color: var(--accent-line)`; no outline
- **Buttons (primary):** `background: var(--accent); color: var(--bg)` — JetBrains Mono, uppercase
- **Buttons (secondary):** `border: 1px solid var(--line); color: var(--muted)` — hover shifts to accent

## Pages

### 1. Landing Page

**Layout:** Vertical scroll, single column, sections separated by 1px dividers.

**Sections (top to bottom):**
1. **Sticky nav** — gradient fade background (`rgba(8,8,10,0.95)` to transparent), not solid. Brand left, links + CTA right.
2. **Hero** — Eyebrow (JetBrains Mono, accent color) → serif headline → sans body → CTA row (primary button + text link). All text has `text-blur` classes for readability over 3D canvas.
3. **Evidence strip** — 3 large stat numbers (serif) with mono labels, horizontally centered.
4. **Features grid** — 3-column grid. Each card: mono number (01/02/03 in accent) → serif title → sans description.
5. **How it works** — 4-column grid. Each step: mono label (STEP 01 in accent) → serif title → sans description.
6. **Quote** — 2-column: quote card (serif blockquote + mono author in accent) | supporting text.
7. **CTA** — Centered: serif headline → sans subtitle → email input + button.
8. **Footer** — mono text, flex space-between.

**Preserved:** 3D neuron animation canvas background and scroll-triggered GSAP animations from `script.js`. The text-blur shadows ensure readability without covering the canvas.

### 2. Dashboard

**Layout:** Top bar + single-column main content.

**Components:**
- **Top bar:** Brand left, horizontal nav links (JetBrains Mono, active = white, inactive = #444) + avatar circle right. 1px bottom border.
- **Welcome block:** Mono eyebrow ("Good afternoon") → serif headline ("Welcome back, {name}" with accent-colored name).
- **Stat row:** 4-column grid of stat cards (mono label → serif value → mono meta). Streak value in accent color.
- **Today's session (featured):** Full-width card with accent border + accent-soft background. Mono header + status badge, serif session title, exercise list in a horizontal flex row, accent "Start session →" button.
- **Nav card grid:** 2×2 grid. Each card: mono title + arrow → serif heading → sans description. Hover highlights border.

### 3. Chat

**Layout:** 3-column grid filling viewport height: 260px history | 1fr chat | 280px context rail.

**Left — History sidebar:**
- Brand mark top, "New conversation" button with accent border, thread list grouped by time (Today, Yesterday, This week). Active thread: left accent border + surface background.

**Center — Conversation:**
- Header: serif topic title + mono message/source count.
- Messages: user bubbles (right-aligned, surface background, rounded corners) and AI messages (left-aligned, accent left border, mono "EMERSUS" label, sans body text, mono source citations in accent).
- Widget embeds: bordered frame with mono label, data visualization inside.
- Composer: bordered input row at bottom, mono send indicator.

**Right — Context rail:**
- Sections: Sources cited (items with title + mono meta), Thread context (tag pills with mono text + line borders), User profile (mono key-value pairs).

### 4. Workout

**Layout:** Top bar → 2-column: 280px sidebar | 1fr detail. Full viewport height.

**Left — Plan sidebar:**
- "Your plans" label, plan items (name + mono meta). Active plan: accent border + accent-soft background. Dashed "Request new plan" button at bottom.

**Right — Plan detail:**
- Header: accent eyebrow ("Active plan") → serif plan name → sans description → meta row (duration, current week, frequency, progression in mono label/serif value pairs).
- Week grid: 7-column grid, one column per day. Today's column: accent border + accent-soft background. Rest days at 50% opacity. Each day: mono day label → serif session title → exercise list.
- Session detail (below week grid): Accent-bordered card with exercise table. Table headers in mono uppercase, exercise names in sans, sets/reps/RPE/rest/notes in mono. "Start session →" accent button.

### 5. Nutrition

**Layout:** Top bar + single-column main content.

**Components:**
- Header: accent eyebrow ("Nutrition") → serif "Daily intake".
- Date nav: arrow controls + serif date + "Today" accent label.
- Calorie overview: 2-column — SVG ring chart (accent stroke, serif value in center, mono labels) | macro progress bars (protein=blue, carbs=green, fat=amber with mono labels + values).
- Action buttons: "Log meal" (primary accent), "Quick add" and "Scan barcode" (secondary bordered).
- Meal log: Cards per meal slot. Header: mono slot name in accent + mono time. Items: sans food name + colored macro values (P/C/F in their respective colors) + kcal. Total at bottom-right. Unfilled slots: dashed border, 50% opacity.

## Additional Pages (same design system, not individually mocked)

The design system applies to **every** page in the app, not just the 5 mocked above. These pages follow the same tokens, typography, and patterns:

### Auth Pages (login, signup, forgot-password, reset-password)
- Same `--bg` background + grid texture
- Centered card layout: `border: 1px solid var(--line); border-radius: 10px; padding: 2.5rem`
- Brand mark (JetBrains Mono) centered above card
- Serif headline ("Sign in", "Create account")
- Form inputs: `background: var(--surface); border: 1px solid var(--line)` — focus → accent-line
- Submit button: primary accent style
- Links in mono, color #555, hover → #888
- OAuth button: bordered secondary style
- `[data-auth-ready]` flicker guard pattern stays unchanged

### Profile Page
- Same top bar as dashboard
- Serif page title ("Your profile")
- Form fields in a single-column layout with mono labels + sans values
- Editable fields: same input styling as auth pages
- Save button: primary accent

### Progress / Analytics Page
- Same top bar
- Time-range pills: mono text, line border, active = `accent-soft` bg + accent text
- Stats grid: same stat-card pattern as dashboard
- Chart containers: line border, no background, charts render inside
- Exercise type icons: simple bordered circles with mono abbreviations instead of colored backgrounds
- Session list: same card pattern as meal cards in nutrition

### Progress Session Detail
- Same card-based layout as workout session detail
- Exercise table with same mono headers / sans values pattern

### Static Pages (privacy, terms, contact)
- Same nav + footer as landing
- Serif headings, sans body copy
- Simple single-column text layout, max-width 720px centered

## What Does NOT Change

- `script.js` — 3D neuron THREE.js animation, GSAP scroll triggers, Lenis smooth scroll
- Canvas background on landing page
- All backend API routes and handlers
- `shared/emersus-renderer.js` widget rendering logic (though theme CSS tokens inside it will be updated to match new palette)
- `shared/supabase.js`, auth flows, RPC calls
- Admin pages (separate concern, not in scope)

## Migration Notes

- **No new dependencies.** JetBrains Mono loads via Google Fonts CDN `<link>` tag — same pattern as current Inter + Space Grotesk imports.
- **Remove:** Inter and Space Grotesk font imports, all glassmorphism/backdrop-filter rules, all neon color variables (#9ffb00, #ff44cc, #cc44ff, #00ffcc), radial gradient corner accents, cta-pulse keyframe, nut-fade-up/nut-ring-pulse/nut-shimmer keyframes from nutrition page.
- **Nutrition sub-theme:** The separate warm-amber nutrition theme (Playfair Display + DM Sans + amber accent) is removed. Nutrition now uses the global design system with macro-specific colors for data visualization only.
- `shared/site.css` will be rewritten as the primary stylesheet for all authenticated pages.
- `styles.css` (landing page) will be rewritten.
- `shared/chat.css` will be rewritten.
- Widget theme CSS in `shared/emersus-renderer.js` (`EMERSUS_THEME_CSS` constant) will be updated to match the new token set.

## Mockup Reference

All mockups are saved in `.superpowers/brainstorm/25384-1776028424/content/`:
- `page-1-landing-v3.html` — Landing page (approved)
- `page-2-dashboard.html` — Dashboard
- `page-3-chat.html` — Chat
- `page-4-workout.html` — Workout planner
- `page-5-nutrition.html` — Nutrition tracker
