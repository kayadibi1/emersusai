# Frontend Redesign — Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Supersedes:** `2026-04-12-frontend-redesign-design.md` (Typographic Minimalist · Georgia serif · Monster Acid green direction — abandoned before implementation)
**Scope:** Complete frontend redesign across landing + every authenticated route. Chat-first information architecture. Brand-new visual language (Linear-inspired).
**Prerequisite:** `2026-04-14-ui-strip-design.md` (strip of the old UI from `/`, `/contact`, `/privacy`, `/terms`, `/demo`, `/admin`, `/internal/email-mockups`) — already approved for implementation.

---

## Motivation

The current design reads as aggressive and juvenile ("axe body spray commercial") — neon lime, hot pink, purple, heavy glassmorphism. The 2026-04-12 spec proposed a Georgia-serif / Monster Acid green direction, but before implementing it we reconsidered and landed on a Linear-inspired aesthetic that better fits emersus's positioning: **evidence-based, rigorous, chat-first AI product**.

This redesign is also the moment to collapse the page tree. The old structure had 15+ distinct URLs (`/app/workout/`, `/app/workout/session/`, `/app/workout/cardio/`, `/app/workout/swim/`, `/app/workout/climb/`, `/app/progress/session/`, `/app/progress/exercise/`, `/chat/` as a root sibling of `/app/`, etc.). We consolidate to **5 main routes** with in-page tabs for modality/view, which is also easier to maintain as features grow.

---

## Information Architecture

**Chat-first.** `/app` **is the chat interface.** Other sections (Train, Nutrition, Progress, Profile) are peers accessible from the persistent sidebar. The legacy `/chat/` URL redirects to `/app`.

### Routes (collapsed from ~15 → 5)

| Route | Purpose | In-page structure |
|---|---|---|
| `/app` | **Chat** (default home) | Thread sidebar + messages + composer |
| `/app/train` | Training | Modality tabs: **Lift · Cardio · Swim · Climb** × sub-tabs: **Active · History** |
| `/app/nutrition` | Nutrition | Top tabs: **Today · Plans · Log · Recipes (soon) · Allergens (soon)** |
| `/app/progress` | Progress | Modality filter tabs + period selector (Week/Month/3M/Year) |
| `/app/profile` | Profile | Tabs: **Goals · Equipment · Injuries · Integrations (soon) · Billing** |

Old `/app/workout/session|cardio|swim|climb` → all consolidated under `/app/train` with modality tabs.
Old `/app/progress/session|exercise` → drill-down overlays/drawers inside `/app/progress`, no sub-routes.

### Persistent sidebar (280px, on all authenticated routes)

1. **Brand wordmark** (EMERSUS, mono 0.28em letter-spacing) — clickable back to `/app` (chat home)
2. **Primary CTA** — section-specific: `+ New thread` (Chat), `+ Start session` (Train), `+ Log meal` (Nutrition), `+ Log session` (Progress), none (Profile)
3. **Search input** — `Search emersus…`
4. **Sections nav** — 5 items (Chat / Train / Nutrition / Progress / Profile), active has accent left-border + accent-soft bg + glowing dot
5. **Thread list** — grouped by Today / Yesterday / Previous 7 days (always visible because chat is 1 click away)
6. **User card** at the bottom — avatar + name + plan pill + `⋯` menu

---

## Design System

### Palettes

**Two palettes = the brand's dark mode and light mode.** They are not alternative brand themes the user picks one of — they are the same brand rendered for two display modes, with a mode-appropriate accent each (jade green reads well against dark; royal blue reads well against light). Both ship; the user's preference is persisted in `localStorage.emersus-theme`, and the initial value is picked from `prefers-color-scheme` when no saved value exists.

Design sign-off for every feature must verify both modes — nothing ships with only dark (or only light) working.

**Graphite · Jade — dark mode** (internal id: `data-theme="mint"`)
- Background `#0a0a0b`
- Surface `#141417`, surface-faint `rgba(255,255,255,0.02)`
- Ink `#ededee`, muted `#8a8a8f`, dim `#55555a`
- Line `rgba(255,255,255,0.06)`, line-strong `rgba(255,255,255,0.10)`
- **Accent (Jade)** `#34d399`, accent-text `#04221a`
- accent-soft `rgba(52,211,153,0.10)`, accent-line `rgba(52,211,153,0.34)`
- Citation `#8ab4f8`

**Paper · Royal — light mode** (internal id: `data-theme="paper"`)
- Background `#f4efe5` (warm cream)
- Surface `#ece5d6`, surface-faint `rgba(26,24,19,0.025)`
- Ink `#1a1813`, muted `#5e564a`, dim `#8f8676`
- Line `rgba(26,24,19,0.10)`, line-strong `rgba(26,24,19,0.18)`
- **Accent (Royal)** `#3b82f6`, accent-text `#ffffff`
- accent-soft `rgba(59,130,246,0.10)`, accent-line `rgba(59,130,246,0.36)`
- Citation `#b37214` (warm amber)

Palettes are runtime-switchable via `data-theme="mint"` / `data-theme="paper"` on `<html>`, with the selection stored in `localStorage.emersus-theme`. **User-facing toggle labels read as "Dark" / "Light"** — the internal `mint`/`paper` strings are opaque identifiers, never exposed in the UI.

**Macro colors** (nutrition only, stable across themes):
- Protein `#4d8df5`
- Carbs `#78dc14`
- Fat `#e8a838`

**Status colors**:
- Warning `#fbbf24` (amber, e.g., "behind pace", "preprint")
- Danger `#f87171` (red, destructive actions, over-target)
- Info `#60a5fa` (blue, supplementary info, HR zone 1)

### Typography

| Role | Font | Weight | Size | Letter-spacing |
|------|------|--------|------|----------------|
| Headlines, body, UI | **Space Grotesk** (Google Fonts) | 400–700 | 13px–74px | −0.03em (display), −0.005em (body) |
| Eyebrows, labels, metadata, mono numerics | **JetBrains Mono** (Google Fonts) | 400–600 | 9px–13px | 0.14em–0.28em (uppercase) |
| Tabular numerics (weights, kcal, times) | Space Grotesk with `font-variant-numeric: tabular-nums` | 600 | varies | −0.015em to −0.035em |

Brand mark: `EMERSUS` in JetBrains Mono 12.5px weight 600, letter-spacing 0.28em.

### Component patterns (reusable across pages)

**Cards** — 1px solid line border, 12–14px radius, `surface-faint` bg, 20–28px padding. Hover: border shifts to `accent-line`.

**Tabs** — mono uppercase labels, 40px centered gap, active has accent bottom-border (2px) + accent text color.

**Pills / segmented controls** — bordered group with inner dividers, active state uses `accent-soft` bg + accent text.

**Toggles** — 40×22px pill, 16px circle, accent fill when on.

**Inputs** — `composer-bg` background, `line-strong` border, 7–11px padding, focus adds `accent-line` border + `accent-soft` 3px box-shadow ring.

**Sliders** — thin 4px track, accent thumb with 3px accent-soft ring. Endpoint range labels below (muted mono).

**Progress bars** — 4–8px height, accent fill. Optional tolerance-band pattern (diagonal hatched) for "on-pace zones" (nutrition).

**Citation card** — bordered card with head (tag + HIGH/MODERATE/LIMITED/INSUFFICIENT strength badge with mini bar), body (title, authors, stats), and footer actions (`PUBMED ↗`, `DOI ↗`, `ASK FOLLOW-UP`).

**Meal widget** — bordered table with head (title + total kcal/protein), rows (meal type · name · macros), and action footer (`Adjust meals` / `Save to Nutrition →`).

**Macro bars** — horizontal bars per macro, optional tolerance-zone overlay, `Ng / target · Mg left` value display.

**Streak tracker** — large number (96px, weight 700) with pulsing ◆ flame in accent, `N-DAY STREAK` label, 3 sub-stats.

**Meal dots (timeline)** — dots sized by kcal contribution, filled for logged, dashed-outline for planned.

**Benchmark bar** — track with muted band showing "typical intermediate range" (literature-backed) + solid ink-colored tick showing your value, status pill `↑ ABOVE TYPICAL` / `WITHIN RANGE`.

**Small multiples chart** — 3 mini cards side-by-side, each with big number + filled-area SVG sparkline.

**Range plot (lift volume)** — vertical bars per week showing min→max worked-weight range, with 1RM tick mark.

**HR-zone stacked bars (cardio)** — stacked colored segments per weekly column (Z1 blue → Z5 red).

**Training-load area chart** — acute load (accent area fill) vs chronic load (dashed muted line), with shaded 0.8–1.3 safe-zone band (Gabbett 2016).

**Empty-state prompt chips** — rounded-pill buttons with suggested questions, anchored to the bottom of an otherwise-empty chat area (not centered — would dominate).

### Brand narrative

- Primary headline: **"Trained on the literature."** (double meaning: AI training + your training) — used on auth and secondary surfaces. Landing still uses "Your body deserves better than guesswork" as its hero.
- Product positioning: **private beta** — no "Sign up free", instead `Request access`. Invite-gated with optional code to skip waitlist.
- Model is branded **Emersus** in-product; the underlying GPT-5.4-mini is an implementation detail.
- Contact email is **info@emersus.ai** only — subject-line routed (`?subject=Privacy`, etc.), not multiple fake addresses.
- Auth supports **Google OAuth + email/password** on both login and request-access flows.

---

## Page designs

Every authenticated page follows the same chrome: sidebar on the left (280px), top section/tab bar, scrollable content area, sticky bottom bar (optional — carries `Ask Emersus` hook into a chat drawer on non-chat pages).

### 1. Landing (`/`)

Public marketing page. Hero-centric. Sections in order:

1. Top nav (sticky, backdrop-blur)
2. Hero — eyebrow pill, gradient-fade headline, subhead, two CTAs, `1,041,448 PAPERS INDEXED · UPDATED DAILY` mono meta
3. Embedded autoplay chat demo — macOS-style frame, sidebar with mock threads, user-question → streaming answer → citation card unfolds (protein intake / Morton 2018 RCT meta-analysis). Loops every 16 seconds.
4. "What you get" bento — 6 cards in asymmetric grid (Every claim sourced · Grade not guess · Every way you move · Macros that add up · Preprints flagged · Built for how you actually train)
5. "Five things no one else does" — 5 spotlight rows with alternating left/right visuals (interactive widgets · evidence-backed substitutions · progress vs literature · workout share cards · meal planning)
6. Marquee — counter-directional scrolling rows of sample questions (no background, 14–17px body weight)
7. "No topic is too niche" marquee header
8. How it works — 4 numbered steps
9. Evidence grading scale — 4-tier deep-dive
10. Corpus stats — 3 big numbers (1,041,448 papers · 302 topic areas · 100% citations verifiable)
11. Testimonials — 3 cards (no avatars, clean names + roles)
12. Comparison table — Emersus vs Generic AI vs Influencer
13. Coming soon — 4 roadmap cards (Wearable sync · Recipe builder · Allergens & diets · Exercise video library)
14. FAQ — 5 expandable questions
15. Final CTA — big gradient headline + `Request access →` + reassurance line
16. Rich footer — 4-column with EMERSUS brand + Product / Science / Company links

Mockup: `.superpowers/brainstorm/linear-landing/mockup-themes.html`.

### 2. Chat (`/app`, default home)

- Sidebar (described above, Chat section active)
- Top bar: thread title + **Emersus ▾** (clickable model pill) + `3 SOURCES CITED` meta pill + Share / ⋯
- Messages: mono `YOU` / `EMERSUS` labels + timestamps, body text, inline widgets (citation cards with `PUBMED ↗` / `DOI ↗` / `ASK FOLLOW-UP` footer actions, meal widgets with `Save to Nutrition →`)
- Message actions (Copy / Cite / Regenerate / Save plan / Swap meal / Export) always visible at 55% opacity, brighter on hover
- Streaming: `■ Stop` button replaces `Send` in composer; composer hint reads `GENERATING…`
- Empty state (new thread): suggested-prompt chips anchored to the bottom above the composer (no dominating hero); clicking a chip fills the composer and swaps back to the messages view
- Composer: textarea, `+ Attach` chip on left, send/stop button on right, `⏎ SEND · ⇧⏎ NEWLINE` hint (when not generating)

Mockup: `.superpowers/brainstorm/linear-landing/chat.html`.

### 3. Train (`/app/train`)

- Modality tabs centered: **Lift · Cardio · Swim · Climb**. Switching swaps the active panel and updates the session title.
- Session header: title ("Push Day · Chest Volume") + mono sub (`● IN PROGRESS · 38:22 · APR 15, 2026 · DUMBBELL · 50 MIN TARGET`) + `● AUTO-SAVING` indicator + `⋯`
- Sub-tabs: **Active · History**
- **Lift / Active**: plan-banner tying this session to its source chat thread → exercise cards with numbered sets, hero weight×reps (17px body weight 600 tabular-nums), mono `RPE N · rested M:SS` meta, checkmark; current-set row has accent-soft bg with input groups (80px wide, 3-digit weights fit), RPE chips, `Log set` button; empty rows show target weight×reps in italic
- Cardio / Swim / Climb: different layouts per modality — Cardio has 4 big metrics + HR zone bars; Swim has lap grid (filled = done, accent = current); Climb has route list with grade chips + flash/send/working status
- Bottom bar: `READY FOR SET N` idle label (left) + `[chat icon] Ask Emersus` + `Finish session` (accent, right). Rest timer replaces the idle label only when resting.

Mockup: `.superpowers/brainstorm/linear-landing/train.html`.

### 4. Nutrition (`/app/nutrition`)

- Top tabs: **Today · Plans · Log · Recipes [SOON] · Allergens [SOON]**
- Day header: `‹ Wednesday · Apr 15 ›` with prev/next arrows + `TODAY` accent chip, sub meta `2026 · WEEK 16 · DAY 4 OF 7`, `● AUTO-SAVING` + `⋯`

**Today tab is the showcase:**

- **Time-aware fuel gauge** (v4+, the headline visualization):
  - Header: big kcal number (38px bold) + delta chip (`+230 AHEAD · OF PACE AT 3:40 PM`) + predictive status (`● ON TRACK · TARGET BY 6:30 PM · +1 MEAL`)
  - Timeline: meal dots **sized by kcal** above the bar (B 340 · L 680 · S 280 · D 590 planned, dashed outline), bar with solid accent fill + diagonal-hatched "on pace zone" tolerance band + vertical `NOW` marker at current time
  - Time axis below (7 AM · 12 PM · **3:40 PM** · 6:30 PM · 10 PM)
  - **NEXT UP card** (accent-soft bg): planned vs target macros + amber `⚠ PLANNED DINNER IS 230 KCAL OVER TARGET` + `Suggest lighter option →` accent button
  - Per-macro mini gauges with the same tolerance-band pattern (consistency across kcal + macros)
  - **WHY footnote**: muted explanation ("Lunch came in at 680 kcal, 100 over the planned rice bowl...")
- Water + supplements micro-strip (2-column)
- Meals list — logged meals have `⋯`, planned meals have `Log as eaten` (accent) + `Swap`. Ingredient lists collapsed inside `<details>` chips (`4 items ⌄`).
- `+ Log a meal` dashed button
- Bottom bar: `+ Quick log` dropdown (Water / Meal / Snack / Supplement) + `Ask Emersus`

**Plans tab** — saved meal plans list
**Log tab** — recent days with status dots (green on-target / amber short / red over)
**Recipes / Allergens** — coming-soon cards

Mockup: `.superpowers/brainstorm/linear-landing/nutrition.html`. Alternatives explored in `macro-variants.html`.

### 5. Progress (`/app/progress`)

- Modality filter: **All · Lift · Cardio · Swim · Climb · Nutrition**
- Period pills: Week · Month · 3M · Year
- Page header: "April 2026" + sub meta, `⋯`

**Sections (in order):**

1. **Benchmark bars** (replaces flat stat tiles) — 4 rows, each with a muted "typical intermediate" range band + your ink-colored vertical tick + value + `↑ ABOVE TYPICAL` / `WITHIN RANGE` status. Ties stats to literature norms — uniquely emersus.
2. **Personal records** — 3 accent-soft cards (`NEW PR / PR / FIRST` tags) with exercise, value, delta-from-previous, colored sparkline
3. **Lifting — 1RM progression** (small multiples) — 3 mini cards (Bench / Squat / Deadlift), each with big 1RM + delta chip + filled-area sparkline
4. **Bench — working weight range** (range plot) — 8 vertical bars showing min→max worked-weight per week, 1RM tick on each, current week highlighted
5. **Cardio — intensity distribution** (HR-zone stacked bars) — 4 stacked weekly bars split by Z1–Z5 colors, totals below, 5-item legend
6. **Training load** (acute:chronic ratio chart) — area chart with acute (accent fill) vs chronic (dashed muted line), shaded 0.8–1.3 safe-zone band, current ratio `1.24` called out, `INSIGHT` footnote citing Gabbett 2016
7. **Consistency** (streak tracker) — massive `14 ◆` with pulsing flame, 14-dot streak row, 3 sub-stats (longest ever · total active days this year · this month %)
8. **Recent sessions** — mixed-modality list with color-coded modality pills, PR chips, chevron for drill-down

Mockup: `.superpowers/brainstorm/linear-landing/progress.html`. Alternatives explored in `progress-variants.html`.

### 6. Profile (`/app/profile`)

- Tabs: **Goals · Equipment · Injuries · Integrations [SOON] · Billing**
- Page header: 48px avatar with hover-revealed ✎ edit badge, name + meta (email · PRIVATE BETA · MEMBER SINCE), last-trained line (`LAST TRAINED · APR 14 · PUSH DAY · 48 MIN · BENCH PR`), `● AUTO-SAVING`, `⋯`

**Goals tab**:
- Primary goal pills (Hypertrophy / Strength / Endurance / General / Hybrid) + **preview hint**: `ADJUSTS · rep ranges · weekly volume · rest periods · progression rules · recommended deload cadence`
- Experience pills (Beginner / Intermediate / Advanced)
- Body: weight, target weight, height (numeric inputs)
- Weekly targets: 3 sliders with min/max labels (`1` · `7` · `5,000 KG` · `60,000 KG` · `10 KM` · `200 KM`)
- Nutrition targets: 4 editable macro pills (kcal / P / C / F) + muted note `AUTO-COMPUTED FROM BODY WEIGHT × 1.8 G/KG · EDITS SYNC TO NUTRITION`
- Preferences: 4 toggles (injury-aware, auto-deload, metric units, daily reminder with time chip)

**Equipment tab**: environment pills + 10+10 checkboxes with item-descriptive sub-labels ("Olympic barbell · 20 KG STANDARD", "Kettlebells · 8 – 32 KG TYPICAL RANGE") — NOT state-descriptive.

**Injuries tab**: active (amber border) + healed (muted) injury rows with citation-backed notes ("AVOID CONVENTIONAL DEADLIFT · USE TRAP-BAR · CAMARA 2016"), dashed `+ Report a new injury` button. Movements-to-avoid is derived from injuries automatically — not a separately-maintained list.

**Integrations tab**: 6 dashed coming-soon tiles. Brand-safe generic labels only (Smartwatch sync, HR chest strap, Running watch, Activity platforms, Scale & body metrics, Cycling computers). **No brand names** per legal.

**Billing tab**: plan hero (Private beta, billing paused), 3-column usage grid with `UNLIMITED DURING BETA` accent sub-labels, account actions (change email / password / export), **Danger zone** at the bottom in a separately-bordered red card containing delete-account.

Mockup: `.superpowers/brainstorm/linear-landing/profile.html`.

### 7. Auth (`/auth/login`, `/auth/signup`, `/auth/reset`, `/auth/invite`)

Single split-screen layout with 4 state-switched panels:

- **Left pane (55%)**: brand wordmark + hero headline **"Trained on the literature."** + subhead ("Over a million peer-reviewed papers. Every recommendation traced back to the study that justifies it...") + 3 stat tiles (papers / topics / verifiable %), centered within their columns. Subtle grid background + radial accent glow.
- **Right pane (45%)**: form card, max-width 400px, fades/slides in on panel switch.

Panels:

1. **Log in** (default): `Continue with Google` + OR divider + email/password + `Remember for 30 days` (defaults **off**) + `Forgot password?` + `Sign in →`. Footer: "Don't have access? Request private beta →" + muted "Just got an invite? Set up account →"
2. **Request access**: OAuth button + manual form (name + email + optional invite code with `EM-8X4K-9PQR` placeholder) + helper `WE'LL EMAIL YOU TO SET YOUR PASSWORD ONCE ACCESS IS APPROVED`. **No password field** — password is set after approval. ToS/Privacy agreement note above the footer. Beta notice callout mentioning wearable sync / recipes / videos as member perks.
3. **Forgot password**: email + `LINK EXPIRES AFTER 30 MINUTES FOR SECURITY`
4. **Set up account** (after invite link click): OAuth + OR + disabled pre-filled email + password + `Complete setup →`. Next step is conversational onboarding.

Password show/hide via `SHOW`/`HIDE` mono buttons. ToS/Privacy links appear where signing up (Request access, Set up account). Keyframe fade+slide animation on panel switch.

Mockup: `.superpowers/brainstorm/linear-landing/auth.html`.

### 8. Static (`/contact`, `/privacy`, `/terms`)

Single shared page shell with:
- Sticky top nav (EMERSUS + links + `Request access` accent CTA)
- Sub-tabs: **Contact · Privacy · Terms**
- Fixed grid background + mask

**Contact**: hero + 2-column grid — form on the left (subject pills: General / Beta support / Partnership / Press / Bug report, name, email, message) + aside with one accent card (`info@emersus.ai` as the single routing hub) + second card explaining subject-routing.

**Privacy / Terms**: hero + 2-column grid — sticky TOC on the left (7 section links with accent-active state) + numbered article sections on the right. Terms includes a prominent `⚠ IMPORTANT` callout in a left-bordered red block: "Not medical advice." Current production privacy/terms (see local WIP) use launch-ready legal copy covering scope, data categories, GDPR-style rights, HIPAA carve-out, AI-output disclaimers, user content license.

Mockup: `.superpowers/brainstorm/linear-landing/static.html`.

### 9. Onboarding (first run after account creation)

**Conversational, not quiz-form.** The user lands in the chat UI with a first thread where Emersus asks open-ended questions and the user types natural answers. Under the hood, the model extracts `goal`, `experience`, `equipment`, `injuries`, `body_weight`, etc. from free-text responses and writes them to Profile. The user never sees a form.

Existing spec: `2026-04-10-conversational-onboarding-design.md`. Mockup **deferred** — it's a content/system-prompt change over the existing chat UI, not a separate visual surface. An earlier attempt at a quiz-widget onboarding (`onboarding.html` with pills + number inputs) was rejected and deleted on 2026-04-15.

---

## Behaviors

This section specifies what every interactive element does — so nothing ships as a drawn-but-unwired button. Organized by scope (global → per page).

### Global patterns

#### Theme switching
- `data-theme="mint"` (Graphite · Jade) or `data-theme="paper"` (Paper · Royal) on `<html>`. Persisted to `localStorage.emersus-theme`.
- Default: if `prefers-color-scheme: light`, use `paper`; else `mint`.
- Transitions: 0.4s background + color on root.

#### Auto-save
- Mutations to Profile / Nutrition / Train state debounce 500ms, POST to their endpoints.
- The `● AUTO-SAVING` indicator pulses (2.5s cycle) while any save is in-flight; goes solid when idle (last save succeeded).
- On save failure: dot turns amber, label changes to `SAVE FAILED · RETRY ↻` (clickable to retry), exponential backoff up to 30s. Stored locally in IndexedDB until successful flush.
- Route changes while pending: flush on `beforeunload`; warn if offline.

#### `Ask Emersus` drawer (on Train, Nutrition, Progress, Profile)
- Clicking the button opens a 440px right-side sliding drawer (250ms ease-out). Main content is pushed/dimmed.
- Drawer contents: same chat shell as `/app` but scoped to the current page's context — composer + messages only, no thread sidebar.
- Auto-seeds a system-prompt context: a JSON blob of the current page data (active session, today's meals, filtered progress window, profile snapshot) inserted before the user's first message in this drawer thread.
- Drawer threads persist per-page (keyed `drawer:<page>:<entity-id>`). Closing the drawer stashes the thread; reopening on the same entity restores it.
- `Save as thread →` button in drawer header promotes the drawer thread to a top-level thread in `/app`.
- Close: `Esc`, clicking the backdrop, or a top-right `×`. State saves on close.

#### Chat-seed pattern
Many places open a chat with a pre-populated prompt (empty-state chips, `Suggest lighter option →` in NEXT UP, `ASK FOLLOW-UP` in citation card, prompt marquee on landing clicked-through).
- From outside `/app`: navigate to `/app?prompt=<url-encoded>&autosend=0|1`.
- From inside `/app`: populate composer with prompt; set cursor to end; if `autosend=1`, submit.
- From a drawer: populate drawer composer instead.

#### Loading & error states
- Button loading: the icon swap to a 14px spinning arc; button disabled; the label remains but color mutes.
- Form submission: button shows spinner, inputs disable (readonly, not `disabled`, to preserve layout), `Esc` cancels if supported.
- Inline field error: red `line` variant + `field-helper` in red with `⚠` prefix.
- Top-right toast for transient errors (`COULDN'T SAVE · WILL RETRY`), 4s auto-dismiss + `×` manual.
- Empty-state is page-specific (covered per page below).

#### Navigation
- Sidebar brand wordmark → `/app`.
- Sidebar Section items → their routes. Active highlighted by matching current path prefix.
- Section switching: fade + slide-up 0.25s for main content; sidebar stays mounted.
- All nav is SPA-internal (client router). Direct-URL load works for every route (SSR or client-hydration, pick per platform).

---

### 1. Chat (`/app`)

#### Top bar
- **Thread title** — editable inline (click to edit, `Enter` saves, `Esc` cancels). Mutation → `PATCH /api/threads/:id { title }`. If empty after edit, revert to "Untitled thread".
- **`Emersus ▾` model pill** — opens a dropdown with model choices.
  - Options (initial): `Emersus` (balanced, default) · `Emersus Fast` (quicker, less retrieval depth) · `Emersus Deep` (slower, more aggressive retrieval).
  - Under the hood, maps to `OPENAI_EMERSUS_MODEL` variants + retrieval-policy tier. Selection stored on the thread: `PATCH /api/threads/:id { model }` (DB tier ids `emersus-0.5*` are kept stable for backwards compatibility).
  - New threads inherit the user's default (Profile → Preferences, not yet in the spec — add as a hidden default: use the balanced `emersus-0.5` tier).
- **`3 SOURCES CITED` pill** — non-interactive; displays count of unique citations served in the current thread. Updates live as the assistant streams new citations.
- **`Share` button** — opens a share modal with three options:
  1. **Copy link** — generates a signed, public, read-only URL (`/share/t/<hash>`) that renders the thread as a static HTML page. Expires in 30 days by default. Endpoint: `POST /api/threads/:id/share { expires_days } → { url, expires_at }`.
  2. **Copy as Markdown** — dumps the thread as Markdown text to clipboard (for pasting into docs/Slack/etc.). No network call.
  3. **Export as PDF** — server-renders the thread to PDF, opens the download. `GET /api/threads/:id/export.pdf`.
  - Shared threads hide the share button for viewers; show only for the author.
- **`⋯` menu** — overflow actions: Rename, Archive, Delete. Delete prompts a confirm modal.

#### Message actions (assistant messages)
Always rendered at 55% opacity, brighten on hover/focus. Tap-to-reveal on touch is unnecessary because they're always visible (fixed from the hover-only UX in the mockup).

- **`Copy`** — copies the rendered message text (widgets rendered to plain text — e.g., meal plan becomes a Markdown table) to clipboard. Toast: `COPIED`.
- **`Cite`** — copies a formatted citation block for this message only: all cited papers in APA-like format. Toast: `CITATIONS COPIED · N PAPERS`.
- **`Regenerate`** — re-runs inference from this message. Posts the parent user message + prior context to the stream endpoint; replaces this assistant message in place. Streaming caret + stop button active during the regen.
- **`Save plan`** — only appears on assistant messages containing a `workout-plan` fence. Opens a drawer confirming:
  - Plan title (editable)
  - Target day (date picker — defaults to today or tomorrow if today has a session already)
  - Modality (inferred from plan, editable)
  - On save → `POST /api/workout-plans` + toast `SAVED · VIEW IN TRAIN →` (link).
- **`Swap meal`** — only on assistant messages with a meal-plan widget. Opens an inline composer seeded with "Swap the [meal] — I don't want [ingredient]" and sends on confirm. New assistant message with updated widget appears below.
- **`Export`** — modal with formats: `Markdown` · `JSON` · `PDF`. Same endpoint as Share → Export.

#### Citation card (inside assistant messages)
Rendered when the LLM emits a `citation` fence with paper metadata. Footer actions:

- **`PUBMED ↗`** — opens `https://pubmed.ncbi.nlm.nih.gov/<pmid>/` in a new tab. Only rendered if the paper has a `pmid`.
- **`DOI ↗`** — opens `https://doi.org/<doi>` in a new tab. Only rendered if the paper has a `doi`.
- **`ASK FOLLOW-UP`** — opens the current-page chat (or drawer) with a seeded composer: "Tell me more about [citation title] by [first author]". No auto-send — the user edits/confirms.
- If neither `pmid` nor `doi` is available, the card hides the external links and only shows `ASK FOLLOW-UP`.

**Data requirements**:
- Citation payload must include: `title`, `authors[]`, `journal`, `year`, `pmid?`, `doi?`, `evidence_strength ∈ {HIGH, MODERATE, LIMITED, INSUFFICIENT}`, `stats[]` (e.g., `[{k: 'n', v: '49 RCTs'}, {k: 'N', v: '1,863'}]`).
- These fields are already present in `research_articles` + retrieval payloads; verify the widget-fence parser propagates them.

#### Meal widget (inside assistant messages)
Rendered when the LLM emits a `meal-plan` fence.

- **`Adjust meals`** — opens a bottom-sheet (on mobile) / inline editor (desktop) where each row's macros can be tweaked with numeric inputs. Save returns an updated widget in the same message. Pure client-side until saved.
- **`Save to Nutrition →`** — posts the current meal plan to `POST /api/nutrition/plans` (or overwrites today's plan if unscheduled) + redirects to `/app/nutrition` with the saved plan highlighted. Toast: `SAVED · 4 MEALS ADDED TO TODAY`.

#### Empty-state prompt chips (new thread)
- Shown when `messages.length === 0` in the current thread.
- Chips anchored to the bottom of the messages area (not centered — would dominate visually).
- Click a chip → fills the composer with the chip's `data-prompt` value. No auto-send. Focus moves to the composer.
- Chip list is personalized based on Profile data (if experience = intermediate + goal = hypertrophy, show prompts relevant to that; no fallback is fine for v1).
- `GET /api/suggest-prompts` returns the current chip list (profile-aware).

#### Composer
- **Textarea** — grows 44px → 200px (max) with content. `⏎` sends, `⇧⏎` inserts newline. Disabled during generation.
- **`+ Attach`** — opens a file picker. Accepted types: `.pdf`, `.png/.jpg/.webp` (form-check images, lab results, etc.). Max 5MB. Attachments render as chips above the textarea; clicking `×` removes. On send, attachments POST as multipart alongside the message. Deferred: if attachments aren't implemented yet, hide the chip; don't show a disabled button.
- **`Send`** button — submits the message. Disabled when textarea is empty or only whitespace.
- **`■ Stop`** button — replaces Send when the assistant is mid-stream. Clicking aborts the stream via `AbortController` sent to the stream endpoint. Partial response is kept.
- **Hint text** — `⏎ SEND · ⇧⏎ NEWLINE` when idle; `GENERATING…` while streaming.

#### Streaming
- Uses the existing `/api/emersus/workflow` SSE/fetch stream.
- Assistant message appears immediately with a blinking caret at the end of the streaming text.
- Inline widgets (citation / meal / macros / workout-plan) render incrementally as the LLM emits `<widget-start>...<widget-end>` fences (existing parser in `shared/emersus-renderer.js`).
- Citation count in the top-bar pill increments as new citations stream.
- On `Stop`: stream aborts, caret removed, partial content retained. User can regenerate or continue from this state.
- On network error: caret replaced with `STREAM INTERRUPTED · RETRY ↻` inline chip.

#### Sidebar on `/app`
- **`+ New thread`** — creates a new thread client-side with `id=draft-<uuid>` (no server call yet). Empty state shows. First message submission promotes to a real thread: `POST /api/threads → { id, title }`. Thread title is auto-inferred server-side from the first user message after the reply completes (existing behavior — or if not, add it to the workflow spec).
- **Search input** — debounced 300ms, calls `GET /api/threads?search=<query>` and filters the visible thread list. Matches title + message content. Clear `×` resets.
- **Thread item click** — navigates to `/app/t/<id>` (or `/app?t=<id>`, pick one). Loads thread messages via `GET /api/threads/:id/messages`.
- **Active thread** — highlighted; clicking the active thread scrolls messages to bottom.

---

### 2. Train (`/app/train`)

#### Modality tabs (Lift · Cardio · Swim · Climb)
- Switching swaps the main panel visual (different forms per modality).
- The modality is persisted per-session: `PATCH /api/workout-sessions/:id { modality }`.
- If the user has no in-progress session when they tap a modality tab, a new session is auto-created on first logged set/metric.

#### Session header
- **Editable session title** — click to edit (same pattern as chat thread title).
- **`● IN PROGRESS · MM:SS`** — elapsed time since `session.started_at`, live-updating every second.
- **`⋯` menu** — End session (with save), Cancel session (without save, confirm prompt), Change modality, Attach note.

#### Sub-tabs (Active · History)
- **Active** — the currently in-progress session (or the empty "start a session" state).
- **History** — list of past sessions for the current modality, paginated (50 at a time). Endpoint: `GET /api/workout-sessions?modality=lift&limit=50&offset=0`. Row click opens a read-only detail view (inline-expand, not a separate route).

#### Lift · Active view
- **Plan banner** — shown if the session was started from a chat-generated plan. `View plan details` chevron button expands the plan inline (the full list of exercises, target reps/sets). Collapse re-hides. Link-out `Open original thread →` takes you to `/app/t/<thread_id>` in a new tab.
- **Exercise card** — each has:
  - **Name** (editable — inline rename).
  - **Metadata line** — `Primary compound · Chest` style (Movement pattern · muscle group). Read-only, comes from the exercise catalog (`GET /api/exercises/:id`).
  - **`Demo`** button — opens a right-drawer showing the exercise's video/animation (blocked on the Coming Soon `Exercise video library` — fallback: embed the description + cues text while the video backend is pending). Mark this feature behind a flag.
  - **`⋯` menu** — Swap exercise (opens a substitute-picker — filtered by equipment + injuries), Delete exercise, Move up/down.
  - **Sets rows** — each row is a set:
    - **Done set** — static display (`1  80 kg × 10 reps  RPE 7 · rested 2:15  ✓`). Click the row to edit (reveals inline inputs; Save to commit).
    - **Current set** (one at a time) — inline editable: weight input, `×`, reps input, RPE chip row (6/7/8/9/10), `Log set` accent button. On submit → `POST /api/sets { exercise_id, weight_kg, reps, rpe }` → append to sets, advance to next empty set, start rest timer with the plan's rest target (default 2:00).
    - **Empty set** — displays planned target (`target 85 kg × 6`) or just a placeholder if no plan.
- **`+ Add exercise`** — opens a search modal over the exercise catalog. Filter by modality / equipment available / muscle group / recently used.

#### Rest timer
- Shown in the bottom bar only when a rest is active (i.e., a set was just logged).
- Counts down from the plan's target rest (default 2:00 if none). Auto-dismisses at 0:00 and plays a subtle chime + optional browser notification (permission-gated on first use).
- `Skip` button immediately dismisses.
- `+30s` / `-30s` adjust chips (not drawn yet; add them).

#### Bottom bar
- When resting: `RESTING · M:SS · Skip` on the left; `Ask Emersus` + `Finish session` on the right.
- When idle: `READY FOR SET N` static label on the left; same buttons on the right.
- **`Ask Emersus`** — opens the drawer seeded with the current session's state (exercises completed, current exercise, RPE trend).
- **`Finish session`** — prompts a confirm sheet:
  - Summary (total volume, duration, PRs if any)
  - Optional note field
  - `Save & finish` (accent) + `Keep editing` (secondary)
  - On save → `PATCH /api/workout-sessions/:id { ended_at, note }` → navigate to `/app/progress` with the session highlighted.

#### Cardio / Swim / Climb
- Cardio — `Pause` button on the plan banner. Live metrics: distance, pace, HR (from wearable if connected; else manual entry on finish). Zone bars populate from HR data if available.
- Swim — lap counter. Tap `+` to log a lap with auto-timed split (manual entry if stopwatch not used). Lap grid fills as swim progresses.
- Climb — route-list editor. `+ Add problem` opens a grade picker + style tags (crimpy, dynamic, etc.) + status (flash / send / working / project).
- All three use the same session header + auto-save + Finish button.

---

### 3. Nutrition (`/app/nutrition`)

#### Top tabs
- `Today · Plans · Log · Recipes [SOON] · Allergens [SOON]`.
- `Recipes` and `Allergens` panels show the coming-soon state card; no data endpoints yet. Mark the tabs with a tooltip on hover: `SHIPPING Q3 2026` (or whatever target).

#### Today tab · Date navigation
- `‹` — previous day. Loads `GET /api/nutrition/day?date=<yyyy-mm-dd>`.
- `›` — next day. Disabled when on today. Future dates show "no data yet" with `+ Plan ahead` button opening the planner.
- `TODAY` accent chip appears only when viewing today.

#### Time-aware fuel gauge
- **Data source**: `GET /api/nutrition/day?date=<today>` returns `{ consumed, planned, target, meals[], acute_ratio, chronic_ratio, pace_zone_start, pace_zone_end, predicted_target_time }`.
- **Pace zone** = `[pace_zone_start, pace_zone_end]` as % of target kcal — server-computed based on time-of-day + user's eating window (from Profile, default 7 AM–10 PM).
- **`NOW` marker** = current time mapped to its position in the eating window (not kcal axis).
- **`NEXT UP` card**:
  - Shows the next planned meal (from `meals[]`).
  - Compares planned macros vs. remaining-to-target. If planned is over target by >15%, shows the amber `⚠ OVER TARGET` warning.
  - **`Suggest lighter option →`** button opens the Ask Emersus drawer seeded with: `"Suggest a lighter [dinner] — under [X] kcal with at least [Y]g protein to hit today's targets."`
- **WHY insight line** — natural-language explainer generated server-side summarizing why you're ahead/behind (e.g., "Lunch came in at 680 kcal, 100 over the planned rice bowl.")

#### Water + supplements micro-strip
- **Water** — `+ 250ml` / `+ 500ml` quick-log buttons → `POST /api/nutrition/water { ml }` → updates the `1.8L / 3L` counter. Long-press (or `⋯` menu) to edit or delete recent entries.
- **Supplements** — `Log creatine` (or whatever's scheduled today per Profile). Opens a small modal: check what you've taken + optional time override → `POST /api/nutrition/supplements { items[] }`.
- Defaults (3L water, 4 supplements/day, creatine as default) come from Profile → Preferences. If Profile has no supplements defined, this card shows `+ Add supplements to track` CTA taking the user to Profile.

#### Meals list
- Logged meal `⋯` — Edit (inline-edit ingredients + macros), Move to another day, Duplicate, Delete.
- Planned meal `Log as eaten` (accent) — promotes the planned meal to logged with `eaten_at: now()`. Macros reconcile.
- Planned meal `Swap` — opens the Ask Emersus drawer seeded with swap request.
- Planned meal `⋯` — Replan for another day, Delete, Edit.
- Ingredient list `<details>` chip — native HTML toggle. No JS needed.

#### `+ Log a meal`
- Opens a modal with fields: Meal type (Breakfast/Lunch/Snack/Dinner pills), Name (text), Ingredients (autocomplete multi-select from `/api/foods/search?q=`), Time (defaults to now).
- On save → `POST /api/nutrition/meals { type, name, ingredients, consumed_at }`. Response includes computed macros.
- Or: `Describe in plain text` mode (chat-first emersus behavior) — submits the text to the model which extracts structured data.

#### Bottom bar
- **`+ Quick log` dropdown** — 4 items:
  - `Water + 250ml` → same endpoint as water strip
  - `Meal (full)` → opens the full meal modal above
  - `Snack (quick)` → opens a simplified modal (name + quick macros)
  - `Supplement` → opens the supplement modal
  - Each item has a mono `hint` on the right (`+ 250ML`, `FULL`, `QUICK`, `FROM LIST`).
- **`Ask Emersus`** — drawer seeded with today's nutrition snapshot.

#### Plans tab
- List of saved meal plans. Each is a named template (e.g., "Cutting · 2,250 kcal · 140g protein").
- Plan click → opens a detail view with all meals + `Start this plan` (assigns it to today forward) / `Duplicate` / `Archive`.
- `+ New plan` → blank plan editor.

#### Log tab
- Recent days (paginated 14 at a time) with date + meal count + macros + kcal + status pill.
- Click row → navigates to that day in the Today tab (date navigation).
- Status pill computed: green (within ±5% of target), amber (short by >5%), red (over by >10%).

---

### 4. Progress (`/app/progress`)

#### Modality filter tabs (`All · Lift · Cardio · Swim · Climb · Nutrition`)
- Filters every section on the page to that modality.
- `All` = unified view (mixed sessions).
- Persisted in URL: `/app/progress?modality=lift&period=month`.

#### Period pills (`Week · Month · 3M · Year`)
- Loads data for the selected window. Endpoint: `GET /api/progress?period=month&modality=all`.
- Default: `Month`.
- Persisted in URL.

#### Benchmark bars
- `GET /api/progress/benchmarks?profile_id=<me>` returns `[{ metric, value, literature_range: { low, high, label: "typical intermediate" }, status: "above|within|below" }]`.
- Literature ranges are sourced from a curated table (`benchmarks` table in DB) keyed on experience level. **Data pipeline required**: initial seed via research-backed values, refresh quarterly.
- If no benchmark exists for a given metric × experience combo, hide that row (don't show a bar without a band).
- **Deferred until seeded** — flag-gate this section until the benchmarks table has coverage. Fallback: render simple number tiles (like the current mockup before redesign) behind the flag.

#### Personal records (PR cards)
- `GET /api/progress/prs?window=month&limit=3` returns latest 3 PRs.
- Sparkline data included per PR: previous N values for that metric.
- Card click → drill-down right-side panel with full history for that metric.
- PR detection is already implemented server-side (session-logging code flags PRs on write).

#### Small multiples (lift 1RM progression)
- `GET /api/progress/lift-1rm?exercises=bench,squat,deadlift&period=8w` returns `[{ exercise, values: [{ week, weight }], delta_kg }]`.
- Default exercises: bench, squat, deadlift (the big three). Profile → Preferences lets the user pick alternative "headline lifts" (deferred — use defaults for v1).
- Card click → drill-down with per-set history.

#### Range plot (working weight range)
- `GET /api/progress/lift-range?exercise=bench&period=8w` returns `[{ week, min_weight, max_weight, est_1rm }]`.
- Exercise toggle (Bench / Squat / Deadlift) — not drawn yet; add as a small pill-picker above the chart.

#### Cardio HR zones
- `GET /api/progress/cardio-zones?period=month` returns `[{ week, distance_km, zone_minutes: { z1, z2, z3, z4, z5 } }]`.
- If HR data is missing for some weeks (user didn't wear a monitor), show a hatched bar with `HR DATA UNAVAILABLE` hover tooltip. Don't fake the breakdown.

#### Training load
- `GET /api/progress/training-load?period=12w` returns `[{ week, acute, chronic, ratio }]`.
- **Calculation** (server-side): acute = current week volume-intensity; chronic = 4-week rolling average; ratio = acute / chronic.
- Insight footnote is a pre-computed natural-language summary based on the ratio (emitted by a server-side rule, not the LLM).
- Safe zone band (0.8–1.3) is hard-coded per Gabbett 2016.

#### Streak tracker
- `GET /api/progress/streak` returns `{ current, longest_all_time: { days, start_date, end_date }, total_active_2026, this_month: { active, total, pct } }`.
- Streak definition: any day with ≥1 logged session across any modality. Missed days break the streak.
- If `current === 0`, show the card but replace the big number with a muted `0` and an accent `Start a streak today →` CTA.

#### Recent sessions list
- `GET /api/sessions/recent?limit=10&modality=<filter>` returns mixed-modality list.
- Click row → drill-down right-side panel with full session detail (same pattern as everything else).
- Modality pills are color-coded per the design system.
- PR chips on rows come from the already-flagged PR events.

#### Drill-down panels (chevron rows)
- Right-side sliding panel (540px wide, full-height overlay).
- Loaded async on first open: `GET /api/sessions/:id` (or `/api/exercises/:id/history` for exercise drill).
- Contains: full session data, per-set breakdown, charts specific to that entity, Ask Emersus button seeded with `"Review my [session] from [date]"`.
- Close: `×`, click-outside, or `Esc`.

---

### 5. Profile (`/app/profile`)

#### Goals tab
- **Training focus pill change** → `PATCH /api/profile { goal }`. Triggers plan-generation cache bust (client tells chat to regenerate next plan from scratch, not from cached plan).
- **`ADJUSTS · rep ranges · ...` preview hint** — static copy. (If users complain they want to know *exactly* what changes — add a second-level `See what changes →` link to a modal comparing old vs new.)
- **Experience pills** → `PATCH /api/profile { experience }`. Same cache-bust behavior.
- **Body inputs** (weight, target, height) — debounced 500ms on change → `PATCH /api/profile { body_weight_kg, target_weight_kg, height_cm }`. Weight updates also enqueue a macro-recompute: protein target = `body_weight_kg × 1.8` unless the user has manually overridden the macro values.
- **Weekly target sliders** (sessions, volume, distance) — debounced 500ms → `PATCH /api/profile { targets: { ... } }`. These drive the benchmark-bar comparisons and goal progress.
- **Macro target pills (editable)** — input change → debounced 500ms → `PATCH /api/profile { macros: { kcal, protein_g, carbs_g, fat_g } }`. Simultaneously syncs to Nutrition's targets (one source of truth — the Profile endpoint is canonical).
  - If the user edits manually, set `macros.overridden_at = now()`. Body-weight changes no longer auto-recompute after override (shown as a subtle tooltip `Overridden · click to reset` on the pills).
- **Preference toggles** (injury-aware, auto-deload, metric units, daily reminder) → `PATCH /api/profile { preferences: { ... } }`.
  - Metric units toggle — client-wide state; all weight/distance displays re-render in the new unit.
  - Daily reminder toggle — if on, shows the `8:00 PM ▾` time chip. Clicking the chip opens a native time-input picker (or a custom pill-based picker). Saves to `profile.reminders.daily_review.time`.

#### Equipment tab
- Environment pill change → `PATCH /api/profile { training_env }`. Affects default exercise selection in generated plans.
- Checkbox toggles → `PATCH /api/profile { equipment: [...] }`. Items with their own sub-specs (e.g., kettlebell weight range) open a small detail popover when toggled on.
- Plan generation reads this list; exercises requiring unavailable equipment are excluded.

#### Injuries tab
- **`+ Report a new injury`** → opens a modal with fields: name (text), body region (dropdown), severity (mild/moderate/severe), movements-to-avoid (multi-select from exercise catalog), citation/note (free-text), reported_date (defaults today).
- On save → `POST /api/profile/injuries { ... }`. Affects plan generation (movements-to-avoid are auto-filtered).
- Injury row click → edit modal (same fields).
- Injury `⋯` → Mark healed, Delete, Edit.
- **Movements-to-avoid** is a derived read-only list (pulled from injuries in the DB) — not a separately-maintained card (removed from the mockup for this reason).

#### Integrations tab
- All tiles are in the `SOON` state. No endpoints. Each tile has `Join waitlist →` CTA that adds the user to the feature's priority list: `POST /api/integrations/waitlist { integration_key }` → toast `ADDED · WE'LL EMAIL YOU`.

#### Billing tab
- **Plan hero** (`Private beta`) — static during beta. Post-beta, this card renders the active plan + renewal.
- **Usage grid** — `GET /api/usage?window=month` returns counts. Sub-label reads `UNLIMITED DURING BETA` for each metric during beta; post-beta, shows `X OF Y INCLUDED · N% USED`.
- **`View invoice history`** — post-beta only; during beta shows an empty state "No invoices during beta."
- **Change email** → modal with: new email, password confirm, verification code (sent to new email). `POST /api/account/email-change`.
- **Change password** → modal with: current password, new password, confirm. `POST /api/account/password-change`. Logs out other sessions.
- **Request export** → `POST /api/account/export`. Returns `{ job_id }`. Email sent with download link when ready (async — up to 24h).
- **Delete account (Danger zone)** → confirm modal with:
  - Amber warning explaining what's deleted.
  - Type-your-email confirmation field.
  - `I understand, delete my account` red button (disabled until email matches).
  - On confirm → `POST /api/account/delete` → immediate logout + marketing-email with "you can re-register within 30 days to restore."

---

### 6. Auth (`/auth/**`)

#### Log in
- **`Continue with Google`** — redirects to Supabase OAuth: `/auth/v1/authorize?provider=google&redirect_to=/auth/callback`. On callback, Supabase sets the session cookie; the client then redirects to `/app`.
- **Email + password form** — `POST /auth/v1/token?grant_type=password { email, password }`. Success → set session → redirect to `/app`. Error → inline error `INCORRECT EMAIL OR PASSWORD` + field highlight on both fields (don't say which one is wrong).
- **`Remember for 30 days`** — defaults off. When on, refresh-token TTL = 30d; when off, session-only cookies (expire on tab close).
- **`Forgot password?`** — navigates to the Forgot panel.
- **`Request private beta →`** → Request panel.
- **`Set up account →`** (muted) → Invite panel (used when the user clicked the email invite link).

#### Request access
- **`Request access with Google`** — OAuth pre-fills name/email; submits the request automatically. Different from the Login OAuth: this creates a waitlist entry rather than logging in.
- **Manual form** (name + email + optional invite code) → `POST /api/auth/request-access { name, email, invite_code? }`.
  - If `invite_code` is valid, response includes `{ status: 'invited', next: '/auth/invite?token=...' }` → redirect there for immediate account creation.
  - If not, response is `{ status: 'waitlist', position: N }` → show a success state: `YOU'RE ON THE WAITLIST · POSITION #247 · WE'LL EMAIL WHEN A SPOT OPENS`.
- **ToS/Privacy links** — `/terms` and `/privacy`.

#### Forgot password
- **`Send reset link`** → `POST /auth/v1/recover { email }`. Response is always success (don't leak whether the email is registered).
- Success state: `CHECK YOUR INBOX · LINK VALID FOR 30 MINUTES`. `Resend in 60s ↻` button available after initial 60s grace.

#### Set up account (invite landing)
- URL: `/auth/invite?token=<token>`. Token validated on load: `GET /api/auth/validate-invite?token=...` → `{ email, expires_at }` or 401.
- Email field is pre-filled + disabled (from the validated token).
- **`Continue with Google`** — OAuth with the token bound to the invite (server validates the email match).
- **Password form** → `POST /api/auth/accept-invite { token, password }` → creates the account + logs in + redirects to **conversational onboarding** (first thread in `/app` seeded with Emersus's welcome message).

#### Google OAuth
- Already configured in prod (per memory note `reference_google_oauth.md`).
- Callback at `/auth/callback` sets the session cookie and redirects to the intended destination (`/app` by default, or a saved `?returnTo=` URL).
- First-time OAuth user (no profile yet) → redirect to conversational onboarding.

---

### 7. Static (`/contact`, `/privacy`, `/terms`)

#### Contact form
- **Subject pills** — pick one (defaults to General). Field value posted.
- **Submit** → `POST /api/contact { subject, name, email, message }`. Response: `{ ticket_id }`. Success state replaces the form with: `✓ MESSAGE SENT · TICKET #<id> · WE'LL REPLY TO <email>` + subtle `Send another →` link.
- Spam protection: HCaptcha or Turnstile challenge before submit (invisible unless flagged). Basic rate-limit per IP (10 per hour).
- Server emails `info@emersus.ai` with the formatted message, with `Reply-To: <user_email>` and subject `[Emersus Contact · <subject>] <excerpt>`.

#### Privacy / Terms
- Static pages. TOC anchors scroll-into-view on click. No backend interaction.
- Content lives in the working tree (privacy/index.html, terms/index.html — currently being drafted locally).
- `Download PDF` (at the bottom of each legal page) → `GET /privacy.pdf` / `/terms.pdf`. Generated at build time.

---

### 8. Onboarding (conversational, first-run)

- Triggered on first login (new account, no profile data yet).
- Redirects to `/app` with a flag `?onboarding=1` (or detected server-side based on empty profile).
- First thread is auto-created server-side with Emersus's system-prompt override for onboarding mode:
  ```
  [ONBOARDING MODE]
  Goal: gather user's training focus, experience level, body weight, height,
  training environment, available equipment, injuries, and weekly target.
  Rules: ask one open question at a time; acknowledge answers; extract
  structured values; write them to the profile via the extract_profile tool;
  end when all required fields are captured. Never show a form.
  ```
- Assistant sends the first message: `"Welcome to Emersus. Before we start, tell me a bit about what you're training for..."`.
- User replies in natural language. The model calls `extract_profile` (tool) with structured extractions, which writes to `/api/profile`.
- Onboarding ends when the model emits a `<onboarding-complete>` token → client removes the onboarding flag, thread becomes a regular thread, main page header/sidebar fully enable.
- User can `Skip setup →` from the top bar at any time (marks onboarding skipped; profile stays default, user can complete later).

**Tool definition** (new):
```json
{
  "name": "extract_profile",
  "description": "Write one or more extracted profile fields. Call whenever you've inferred a field from user input.",
  "parameters": {
    "goal": "hypertrophy | strength | endurance | general | hybrid",
    "experience": "beginner | intermediate | advanced",
    "body_weight_kg": "number",
    "height_cm": "number",
    "training_env": "home | commercial | outdoor | mixed",
    "equipment": "string[]",
    "injuries": "{ name, body_region, severity, movements_to_avoid }[]",
    "weekly_sessions_target": "number"
  }
}
```

---

### Cross-cutting data models (summary)

For implementers — the new fields this spec assumes. If any don't exist, add migrations first.

| Table | New/modified fields | Notes |
|---|---|---|
| `profile` | `goal`, `experience`, `body_weight_kg`, `target_weight_kg`, `height_cm`, `training_env`, `equipment jsonb`, `preferences jsonb`, `macros jsonb`, `macros_overridden_at timestamptz?`, `reminders jsonb` | Most likely already there — verify against `docs/schema.md` |
| `injuries` | `id, profile_id, name, body_region, severity, movements_to_avoid jsonb, note, reported_date, healed_at?` | Per-user injury list |
| `threads` | `model text not null default 'emersus-0.5'`, `shared_token text?`, `shared_expires_at timestamptz?` | Per-thread model override + sharing |
| `sessions` (workout) | existing + `ended_at timestamptz?`, `note text?` | Confirm structure |
| `benchmarks` (new) | `metric, experience, low, high, label, source_citation` | Literature-backed typical ranges — **seed required** |
| `nutrition_days` (view) | materialized view or on-demand query aggregating `meals`, `water`, `supplements` per day per user | For the time-aware gauge |
| `streaks` (cache or computed) | `profile_id, current_days, longest_days, longest_start, longest_end, total_2026` | Recompute on session-write |
| `contact_tickets` | `id, subject, name, email, message, ip, created_at` | Deferred — current contact form has minimal storage |

---

### Feature flags (recommended per-phase rollout)

- `chat_model_selector` — gate the Emersus ▾ dropdown until multiple model tiers are wired.
- `progress_benchmarks` — gate the Benchmark Bars section until the `benchmarks` table is seeded. Fall back to simple stat tiles otherwise.
- `progress_training_load` — same — gate until the acute/chronic calc job is running.
- `nutrition_quick_log` — gate the `+ Quick log` dropdown; fallback is just `+ Log a meal`.
- `integrations_waitlist` — the Integrations tab's `Join waitlist` endpoint.
- `conversational_onboarding` — the first-run redirect. If off, skip onboarding entirely and let users start with an empty chat.

Each flag defaults off until the corresponding backend work is done. The visual shell ships without them.

---

### Acceptance criteria for "fully functional"

A route is considered fully functional when:

1. Every drawn button produces a visible effect (or has a declared feature flag state that hides it).
2. Every async action has a loading state + error state.
3. Every form validates client-side + reports server errors inline.
4. Every destructive action has a confirm step.
5. Every redirect works (keyboard `Enter`, mouse click, SPA back/forward).
6. Every URL loads the right view on direct-link (not just via client-router navigation).
7. Every empty state has content (including: 0 threads, 0 sessions, 0 meals, 0 PRs, no internet connection).

Sign off on each page means: someone clicks every button, tries every form with invalid + valid input, and reloads every view via a fresh URL. That's the test gate for the phase.

---

## Animations

- Panel / tab switches: 0.25–0.28s keyframe fade + 6px slide-up
- Theme transition: 0.4s background + color on root
- Active dots / status pulses: `pulse` keyframe 2s infinite, box-shadow ring expansion
- Streak flame: `flicker` keyframe 2s, subtle scale + drop-shadow
- Streaming caret: `blink` 1s step(2)
- Meal-plan row updates: `background` transition 0.4s
- Microinteractions: border-color transitions 0.14s on hover
- **No** parallax, no full-screen transitions, no 3D

---

## What this redesign explicitly rejects

- Neon lime, hot pink, purple (old `#9ffb00` / `#ff44cc` / `#cc44ff` palette)
- Heavy glassmorphism + `backdrop-filter: blur()` on every card
- Radial bloom-gradient corner accents
- Box-shadows on content cards (depth via border-color shifts only)
- Multi-color gradient progress bars that imply macro data when they're kcal-only
- State-descriptive checkbox sub-labels ("NOT OWNED", "NOT AVAILABLE" — use item specs instead)
- Quiz/form-based onboarding (replaced with conversational)
- Multiple fictional contact emails (use `info@emersus.ai` routed by subject)
- "Sign up free" framing (this is private beta; use `Request access`)
- "GPT-5.4-MINI" shown to users (brand as `Emersus`)

---

## Implementation phases

Phase 0 is done. The UI strip (2026-04-14 spec) should be done before this starts. Remaining phases:

1. **Design tokens + base layer** — ship the CSS custom properties, theme switcher, Space Grotesk + JetBrains Mono load, core layout grid, sidebar chrome. No content pages yet.
2. **Chat** (`/app`) — the default home. Wire model pill, streaming + stop button, citation / meal / macro inline widgets with their action footers, always-visible message actions, empty-state prompt chips.
3. **Train** (`/app/train`) — modality tabs, set logger, exercise cards, rest timer, `Ask Emersus` drawer hook. Migrate `/app/workout/**` URLs with redirects.
4. **Nutrition** (`/app/nutrition`) — time-aware fuel gauge as the Today-tab hero (acute/chronic pace, tolerance band, NEXT UP card, insight footnote), meal cards, micro-strip. Wire the Quick log dropdown.
5. **Progress** (`/app/progress`) — benchmark bars, PR cards, small multiples, range plot, HR zones, training load chart, streak tracker, session list. Fold old `/app/progress/session|exercise` routes into drill-down overlays.
6. **Profile** (`/app/profile`) — all 5 tabs. Wire bidirectional sync between Profile ↔ Nutrition for macro targets.
7. **Auth** (`/auth/**`) — 4 panels + Google OAuth wiring. Invite email → `Set up account` flow → onboarding.
8. **Public/legal** (`/`, `/contact`, `/privacy`, `/terms`) — landing with the big bento + marquee + spotlights + FAQ. Legal pages use the already-drafted copy in working tree.
9. **Conversational onboarding** — per the 2026-04-10 spec, update the system prompt + add the first-run thread trigger.

Each phase ships behind a feature flag and can ship incrementally. No "big-bang cutover."

---

## Mockup files (reference source)

All in `.superpowers/brainstorm/linear-landing/`:

| File | Page |
|---|---|
| `mockup-themes.html` | Landing |
| `chat.html` | Chat |
| `train.html` | Train |
| `nutrition.html` | Nutrition |
| `progress.html` | Progress |
| `profile.html` | Profile |
| `auth.html` | Auth (4 panels) |
| `static.html` | Contact / Privacy / Terms |
| `macro-variants.html` | Macro-viz current vs pushed (time-aware gauge) |
| `progress-variants.html` | 7 progress-viz alternatives |
| `mockup.html` | Earliest landing comp (for reference) |

These files are throwaway — they are design source-of-truth during brainstorming, not production code. Production code will reuse the CSS patterns but integrate with the real React chat app, Supabase auth, etc.

---

## Open questions / deferred decisions

- **Admin pages** (`/admin/**`): not mocked yet; lower priority (internal staff only). Can follow the same sidebar pattern but with admin-specific section nav (alerts · candidates · feeds · jobs · topics).
- **2FA setup flow**: for a health-data product, 2FA is worth adding. Not mocked; the flow (QR code → code confirmation → backup codes) is simple enough to add during auth implementation.
- **Drill-down overlays on Progress**: mocked as chevrons on rows (click to open) but not mocked beyond the row. Could be a right-side sliding panel OR a modal overlay — pick during implementation.
- **Sidebar collapse on mobile**: the current mockup hides the sidebar under 900px. A hamburger to reveal it is standard; not drawn.
- **Share card visuals**: shown as a teaser on the landing page but not mocked as a full feature surface (the `Export what you moved` section). Each modality may want its own share-card composition (climbing topo, running route map, lift summary).

---

## Sign-off

**Design lead:** Sidar
**Design partner:** Claude (2026-04-15 session)
**Session artifacts:** ~1,200 lines of spec · 11 mockup files · ~6,000 lines of mockup HTML/CSS/JS
