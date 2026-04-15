# Frontend Redesign · Phase 3 · Train (`/app/train`) Implementation Plan — Outline

> **Status:** Outline. Expand before executing. Use superpowers:writing-plans to flesh out each task with code examples + commit messages following the Phase 1 / Phase 2 template.

**Goal:** Consolidate `/app/workout`, `/app/workout/session`, `/app/workout/cardio`, `/app/workout/swim`, `/app/workout/climb` into a single `/app/train` route with modality tabs (**Lift · Cardio · Swim · Climb**) and sub-tabs (**Active · History**). Wire the set logger, rest timer, `Ask Emersus` drawer, and Finish-session flow.

**Spec reference:** `2026-04-15-frontend-redesign-design.md` sections "Page designs · 3. Train" and "Behaviors · 2. Train".

**Mockup:** `.superpowers/brainstorm/linear-landing/train.html`.

**Feature flag:** `train_v2` (per phase). Default off until shipped.

---

## File structure (proposed)

- **New:** `app/train/index.html` — the consolidated page shell
- **New:** `app/train/train.js` — router-aware entry that mounts modality + sub-tab panels
- **New:** `app/train/lift-active.js` — exercise cards + set rows + rest timer
- **New:** `app/train/lift-history.js` — paginated past sessions
- **New:** `app/train/cardio-active.js`, `cardio-history.js`
- **New:** `app/train/swim-active.js`, `swim-history.js`
- **New:** `app/train/climb-active.js`, `climb-history.js`
- **New:** `app/train/session-header.js` — shared header component (title · elapsed · auto-save · ⋯)
- **New:** `app/train/rest-timer.js` — countdown timer with skip + ±30s
- **New:** `app/train/ask-emersus-drawer.js` — 440px right-side sliding chat drawer (reusable across train/nutrition/progress/profile)
- **New:** `shared/train-v2.css` — page-specific styles on top of `chrome.css`
- **New:** `api/emersus/workout-sessions.js` — REST handlers: GET/PATCH session, list sessions by modality
- **New:** `api/emersus/sets.js` — `POST /api/sets` (log a set)
- **New:** `api/emersus/exercises-catalog.js` — `GET /api/exercises?q=&equipment=&muscle=&recent=true`
- **Modify:** `server.js` — redirect `/app/workout` + subroutes → `/app/train?modality=<inferred>`; mount new handlers
- **Modify:** `infra/Caddyfile` (not tracked — document the redirect pattern in `docs/overview.md`) — optional Caddy redirects for SEO

---

## Task outline (~20 tasks)

1. **Feature flag + redirect stubs** — `train_v2` flag; server redirects from old workout URLs when `train_v2` on
2. **Modality tab shell + sub-tab routing** — renders empty panels for each tab
3. **Session header** — shared component + live elapsed time
4. **Lift · Active — exercise card shell** — list from `GET /api/workout-sessions/:id`
5. **Lift · Active — set row logic** — done/current/empty states, editable on click
6. **Lift · Active — `Log set` + auto-advance** — `POST /api/sets`, advance to next empty set
7. **Rest timer** — bottom-bar widget, skip + ±30s, chime + browser notification gating
8. **Plan banner** — if session was started from a chat plan (`source_thread_id` set), show the banner + inline expand
9. **`+ Add exercise`** — modal over exercise catalog (search by name/equipment/muscle)
10. **Exercise `⋯` menu** — Swap (injury-aware filter), Delete, Move up/down
11. **Cardio · Active** — 4 metric tiles + zone bars (populate from HR if present, else manual entry on finish)
12. **Swim · Active** — lap grid + `+` log lap
13. **Climb · Active** — route list with grade chips + status
14. **History tab** — paginated list per modality with row drill-down (inline expand, not a new route)
15. **Finish-session flow** — confirm sheet → `PATCH /api/workout-sessions/:id` → redirect to `/app/progress` with session highlighted
16. **Ask Emersus drawer** — 440px right-slide; seeded with session context
17. **Auto-save pulse** — debounced saves + `● AUTO-SAVING` indicator
18. **URL persistence** — `/app/train?modality=lift&tab=active&session=<id>` SPA routing + direct-load
19. **Old-route redirects** — `/app/workout/**` → `/app/train?modality=<inferred>&session=<id>` (server-side 302)
20. **Flip flag default** — `train_v2=true`

---

## Acceptance criteria

- All drawn buttons do something (per the spec's "Acceptance criteria for fully functional" section).
- Modality switching preserves an in-progress session per modality.
- Direct URL loads every view.
- Old URLs redirect to the new shape.
- Both themes render cleanly.

---

## Open questions

- Should modality tabs persist across sessions, or default to the user's most-recent modality? → Default to most-recent; spec doesn't say.
- Should rest-timer chime be user-configurable? → Add a Profile → Preferences toggle in phase 6.
- Climb grade system — V scale vs Font? → Respect existing `shared/climbing-grades.js` resolver.
