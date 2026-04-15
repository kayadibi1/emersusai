# Frontend Redesign · Phase 3 · Train (`/app/train`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`. Use checkbox (`- [ ]`) syntax.

**Goal:** Consolidate `/app/workout`, `/app/workout/session`, `/app/workout/cardio`, `/app/workout/swim`, `/app/workout/climb` (3,150 LOC across 5 pages) into a single `/app/train` SPA with modality tabs (**Lift · Cardio · Swim · Climb**) and sub-tabs (**Active · History**). Wire the set logger, rest timer, `Ask Emersus` drawer, and Finish-session flow.

**Scope rule:** This phase is **structural + new chrome**. Preserve every existing Supabase RPC and the per-set / per-session schema. If a task would change the workout DB schema beyond the small additions in Task 1, **stop and ask**.

**Spec:** `docs/superpowers/specs/2026-04-15-frontend-redesign-design.md` § "3. Train" + "Behaviors · 2. Train".

**Mockup:** `.superpowers/brainstorm/linear-landing/train.html`.

**Prerequisite:** Phase 2 shipped (`redesign-phase-2-chat` tag).

**Branch strategy:** Ship behind `train_v2` flag. Old `/app/workout/*` URLs keep working until Task 18 flips defaults + 302-redirects.

---

## File structure

- **New:** `app/train/index.html` — page shell
- **New:** `app/train/train.js` — router + modality tab orchestrator
- **New:** `shared/train/lift-active.js` — exercise cards + set rows + log-set logic
- **New:** `shared/train/lift-history.js` — paginated past sessions list
- **New:** `shared/train/cardio-active.js`, `shared/train/cardio-history.js`
- **New:** `shared/train/swim-active.js`, `shared/train/swim-history.js`
- **New:** `shared/train/climb-active.js`, `shared/train/climb-history.js`
- **New:** `shared/train/session-header.js` — title + elapsed + ⋯ menu
- **New:** `shared/train/rest-timer.js` — bottom-bar countdown widget
- **New:** `shared/train/finish-session-sheet.js` — confirm modal
- **New:** `shared/train/ask-emersus-drawer.js` — 440px right-slide chat drawer (reused in Phases 4–6)
- **New:** `shared/train/exercise-picker.js` — modal over exercise catalog
- **New:** `shared/train-v2.css` — page styles on top of `chrome.css`
- **New:** `shared/chat/url-state.js` — query-string ↔ tab/modality state helpers (pure, testable)
- **New:** `api/emersus/workout-sessions.js` — REST: GET/PATCH/list sessions, replaces ad-hoc client-side Supabase calls
- **New:** `api/emersus/sets.js` — `POST /api/sets` handler
- **New:** `api/emersus/exercises-catalog.js` — `GET /api/exercises?q&equipment&muscle`
- **Modify:** `server.js` — mount new routers + 302 from old `/app/workout/*` → `/app/train` when `train_v2` is on
- **Modify:** `vite.config.js` — register `app/train/index.html` as entry; remove old workout entries in Task 18

No Supabase migration required — uses existing `workout_logs` + `exercises` tables.

---

## Task 1: Feature flag + URL-state helpers

**Files:**
- Modify: `shared/feature-flags.js` (already has `train_v2` in `KNOWN_FLAGS`)
- Create: `shared/chat/url-state.js`
- Create: `tests/unit/shared/chat/url-state.test.js`

- [ ] **Step 1: TDD pure helpers.** `parseTrainUrl(search)` returns `{ modality, tab, sessionId }` defaulting `{ modality:'lift', tab:'active' }`. `buildTrainUrl(state)` round-trips. Validates modality ∈ `{lift,cardio,swim,climb}`, tab ∈ `{active,history}`.

- [ ] **Step 2: Implement `shared/chat/url-state.js`** exporting `parseTrainUrl`, `buildTrainUrl`, `MODALITIES`, `TABS`. (Pure — no `window` access; caller passes the search string.)

- [ ] **Step 3: Commit** `feat(flags): train_v2 + URL-state helpers`

---

## Task 2: Page shell + modality tab routing

**Files:**
- Create: `app/train/index.html`
- Create: `app/train/train.js`
- Modify: `vite.config.js` (add entry)

- [ ] **Step 1:** Build `app/train/index.html` from chat/index.html template — same `<head>` (design-tokens, chrome, train-v2.css gated by train_v2 flag), `<div id="train-root">`, loads `app/train/train.js` as module entry.

- [ ] **Step 2:** `app/train/train.js`:
  - Boot theme + check `resolveFlag('train_v2')`. If off, `window.location.replace('/app/workout/')`.
  - Read URL via `parseTrainUrl(window.location.search)`.
  - `<TrainApp/>` component renders modality tab bar (Lift · Cardio · Swim · Climb), sub-tabs (Active · History), and lazy-loads the matching panel module via dynamic `import()`.
  - On tab change → push state with `buildTrainUrl(...)`.

- [ ] **Step 3:** Add `app/train/index.html` to `vite.config.js` `htmlEntries`.

- [ ] **Step 4: Smoke test** — `node server.js` + browser to `/app/train/?train_v2=1` → tabs visible, switching changes URL.

- [ ] **Step 5: Commit** `feat(train-v2): page shell + modality tab routing`

---

## Task 3: Session header component

**Files:**
- Create: `shared/train/session-header.js`
- Create: `tests/unit/shared/train/session-header.test.js`

- [ ] **Step 1:** Pure helpers `formatElapsed(ms)` ("38:22" / "1:38:22"), `parseSessionTitle(rawTitle)` (mirror chat-top-bar's normalizeThreadTitle).

- [ ] **Step 2:** `<SessionHeader session onRename onChangeModality onEndSession onCancelSession onAttachNote/>` — editable title, live elapsed (60s `setInterval`), `● AUTO-SAVING` indicator (controlled prop), `⋯` menu with the 4 actions.

- [ ] **Step 3: Commit** `feat(train-v2): session header with editable title + elapsed`

---

## Task 4: Workout-sessions REST router

**Files:**
- Create: `api/emersus/workout-sessions.js`
- Create: `tests/unit/api/emersus/workout-sessions.test.js`
- Modify: `server.js`

- [ ] **Step 1:** Express router exposing:
  - `GET    /api/workout-sessions/:id` — full session w/ sets joined
  - `GET    /api/workout-sessions?modality=lift&limit=50&offset=0` — paginated list (current user only)
  - `POST   /api/workout-sessions { modality, started_at?, source_thread_id? }` — create, returns full row
  - `PATCH  /api/workout-sessions/:id { title?, ended_at?, note?, modality?, exercises? }`
- All handlers `requireAuth`, RLS-aware via `req.verifiedUserId`, use `supabaseAdmin` from `api/lib/clients.js`.

- [ ] **Step 2:** Pure helpers `validateSessionPatch(body)` + `buildSessionListQuery(params)` get unit tests. Handler integration is acceptance-tested in Step 4.

- [ ] **Step 3:** Mount in `server.js`: `app.use("/api/workout-sessions", workoutSessionsRouter())`.

- [ ] **Step 4:** Manual smoke: `curl -H "Authorization: Bearer <jwt>" http://127.0.0.1:3001/api/workout-sessions?modality=lift` returns array.

- [ ] **Step 5: Commit** `feat(train-v2): workout-sessions REST router`

---

## Task 5: Sets endpoint

**Files:**
- Create: `api/emersus/sets.js`
- Create: `tests/unit/api/emersus/sets.test.js`
- Modify: `server.js`

- [ ] **Step 1:** `POST /api/sets { session_id, exercise_id, weight_kg, reps, rpe?, rest_target_seconds? }`. requireAuth. Validates session ownership, inserts a row into `workout_logs` (existing table), returns the inserted row + the updated session totals (volume, set_count).

- [ ] **Step 2:** Pure validator `validateSetBody(body)` with bounds (`weight_kg ∈ [0, 999]`, `reps ∈ [0, 100]`, `rpe ∈ [1, 10]?`).

- [ ] **Step 3:** Mount + commit `feat(train-v2): POST /api/sets`

---

## Task 6: Exercise catalog endpoint

**Files:**
- Create: `api/emersus/exercises-catalog.js`
- Modify: `server.js`

- [ ] **Step 1:** `GET /api/exercises?q=&equipment=&muscle=&recent=true&limit=20`. Reads `exercises` + uses the existing matching helpers (see `scripts/backfill-workout-logs.js` for fuzzy matching). `recent=true` joins on `workout_logs.user_id` and orders by max(`logged_at`).

- [ ] **Step 2:** Mount + commit `feat(train-v2): GET /api/exercises catalog`

---

## Task 7: Lift · Active panel

**Files:**
- Create: `shared/train/lift-active.js`
- Modify: `app/train/train.js` (lazy-loads it)

- [ ] **Step 1:** `<LiftActive session/>`. Renders the plan banner (only when `session.source_thread_id` is set — show `View plan details ▸ · Open original thread →`), then a list of `<ExerciseCard/>` per `session.exercises[i]`, then `+ Add exercise` button.

- [ ] **Step 2:** `<ExerciseCard exercise sets currentSetIdx onLogSet onSwap onDelete onMove/>`:
  - Header: editable name (`contentEditable` w/ blur-commit), metadata line, `Demo` (drawer stub — flag `exercise_demo_videos`, fallback shows description), `⋯` menu.
  - Set rows: done sets are static; current set has weight input + `×` + reps input + RPE chips (6/7/8/9/10) + `Log set` accent button.
  - On `Log set` → `POST /api/sets` → optimistic append + advance currentSetIdx + start rest timer w/ default 2:00.

- [ ] **Step 3:** `<EmptySetRow target/>` shows `target 85 kg × 6` (italic) when no plan target → muted placeholder.

- [ ] **Step 4: Commit** `feat(train-v2): lift active panel + set logger`

---

## Task 8: Rest timer

**Files:**
- Create: `shared/train/rest-timer.js`
- Create: `tests/unit/shared/train/rest-timer.test.js`

- [ ] **Step 1:** Pure `tickRestTimer(state, now)` reducer + `formatRestRemaining(seconds)` ("1:30").

- [ ] **Step 2:** `<RestTimer endsAt onSkip onAdjust({deltaSeconds})/>`:
  - Bottom-bar widget: `RESTING · 1:30 · Skip · +30s · −30s`.
  - Auto-dismiss at 0:00 → optional chime via `<audio>` (gated on user interaction permission).
  - Optional browser notification when tab is hidden (Notification API permission gated on first use).

- [ ] **Step 3: Commit** `feat(train-v2): rest timer with skip + ±30s`

---

## Task 9: Cardio · Active

**Files:**
- Create: `shared/train/cardio-active.js`

- [ ] **Step 1:** 4 metric tiles (Distance · Pace · HR · Time) + Z1–Z5 zone bars (populate from `session.hr_samples` if present, else show `+ Enter HR data` link → opens manual entry modal). `Pause` button on the plan banner.

- [ ] **Step 2: Commit** `feat(train-v2): cardio active panel`

---

## Task 10: Swim · Active

**Files:**
- Create: `shared/train/swim-active.js`

- [ ] **Step 1:** Lap grid (40 cells, fills as laps logged). `+ Log lap` button → `POST /api/sets { session_id, exercise_id: 'swim_lap', meta: { distance_m, time_s, stroke } }`. Auto-time split from previous lap.

- [ ] **Step 2: Commit** `feat(train-v2): swim active panel`

---

## Task 11: Climb · Active

**Files:**
- Create: `shared/train/climb-active.js`

- [ ] **Step 1:** Route list, each row: grade chip (uses existing `shared/climbing-grades.js` resolver), style tag chips (crimpy/dynamic/...), status (Flash · Send · Working · Project — uses existing `shared/climbing-send-type.js`). `+ Add problem` modal.

- [ ] **Step 2: Commit** `feat(train-v2): climb active panel`

---

## Task 12: History tab (all modalities)

**Files:**
- Create: `shared/train/lift-history.js`, `shared/train/cardio-history.js`, `shared/train/swim-history.js`, `shared/train/climb-history.js`

- [ ] **Step 1:** Each panel: paginated list (50 at a time) from `GET /api/workout-sessions?modality=<m>&limit=50&offset=N`. Row: title · date · duration · key metric (volume / distance / lap count / sends).

- [ ] **Step 2:** Row click → inline expand showing the full set/lap/route list. NOT a route navigation — keep it on `/app/train`.

- [ ] **Step 3: Commit** `feat(train-v2): history panels (lift/cardio/swim/climb)`

---

## Task 13: Add-exercise modal

**Files:**
- Create: `shared/train/exercise-picker.js`

- [ ] **Step 1:** `<ExercisePicker open onPick onClose filters={equipment, muscle, modality}/>`. Hits `GET /api/exercises?q=&equipment=&muscle=&recent=true`. Shows tabs `Recent · Search · By muscle`.

- [ ] **Step 2:** `+ Add exercise` button in `<LiftActive/>` opens it. On pick → `PATCH /api/workout-sessions/:id { exercises: [...prev, { exercise_id, planned_sets: 3 }] }`.

- [ ] **Step 3: Commit** `feat(train-v2): exercise picker modal`

---

## Task 14: Finish-session flow

**Files:**
- Create: `shared/train/finish-session-sheet.js`

- [ ] **Step 1:** Confirm sheet with summary (total volume / duration / PR count from server response), optional note field, `Save & finish` (accent) + `Keep editing` (secondary).

- [ ] **Step 2:** On Save → `PATCH /api/workout-sessions/:id { ended_at: now, note }` → response includes `prs[]` → navigate to `/app/progress?highlight=<session_id>`.

- [ ] **Step 3: Commit** `feat(train-v2): finish-session flow`

---

## Task 15: Ask Emersus drawer (440px right slide)

**Files:**
- Create: `shared/train/ask-emersus-drawer.js`

- [ ] **Step 1:** `<AskEmersusDrawer open onClose seedContext/>`. 440px wide, position: fixed right, full-height. Embeds a slimmed-down chat composer + thread display (reuses `shared/react-chat-app.js` ChatApp via a `mode="drawer"` prop — add the prop in this task; default mode keeps the full-page layout).

- [ ] **Step 2:** Bottom-bar `Ask Emersus` button on Train opens the drawer with `seedContext = { type: 'workout_session', session_id, summary }`. Drawer's first user message is auto-prepended with this context as a hidden system note.

- [ ] **Step 3: Commit** `feat(train-v2): ask emersus drawer`

> **Note:** This component is reused in Phases 4 (Nutrition), 5 (Progress), 6 (Profile). Don't couple it to Train — keep `seedContext` generic.

---

## Task 16: Auto-save pulse + bottom bar wiring

**Files:**
- Modify: `app/train/train.js`
- Modify: `shared/train/session-header.js`

- [ ] **Step 1:** Debounced 800ms auto-save effect — when any session-mutating field changes, queue a `PATCH` with the dirty payload only. While in-flight, `<SessionHeader autoSaving=true/>` shows the indicator.

- [ ] **Step 2:** Bottom bar:
  - Idle: `READY FOR SET N` (left) · `[chat icon] Ask Emersus` + `Finish session` (right).
  - Resting: `<RestTimer/>` replaces the idle label.

- [ ] **Step 3: Commit** `feat(train-v2): auto-save + bottom bar`

---

## Task 17: train-v2.css

**Files:**
- Create: `shared/train-v2.css`

- [ ] **Step 1:** Port the train.html mockup's CSS into `shared/train-v2.css`, scoped under `[data-train-v2="1"]`. Sections: modality tabs, sub-tabs, session header, exercise card, set row (current/done/empty states), bottom bar, rest timer, finish sheet, ask drawer.

- [ ] **Step 2:** Audit class names match what the JS components reference.

- [ ] **Step 3: Commit** `feat(train-v2): chat-specific styles`

---

## Task 18: Old-route 302s + flag flip + tag

**Files:**
- Modify: `server.js`
- Modify: `shared/feature-flags.js` — `DEFAULT_FLAGS.train_v2 = true`

- [ ] **Step 1:** In `server.js`, for each old workout path (`/app/workout`, `/app/workout/session`, `/app/workout/cardio`, `/app/workout/swim`, `/app/workout/climb`) add a 302 redirect to `/app/train?modality=<inferred>&session=<id-from-query?>`. Only fire when the request `Accept`s HTML AND `train_v2` is on for the user (server reads localStorage via a tiny client-side bootstrap; if not feasible, redirect unconditionally — old pages can be deleted in a follow-up).

- [ ] **Step 2:** `DEFAULT_FLAGS.train_v2 = true`. Update `tests/unit/shared/feature-flags.test.js`.

- [ ] **Step 3:** Manual QA pass with `?train_v2=0` and `?train_v2=1` — both work; old URLs redirect; auto-save still saves.

- [ ] **Step 4: Commit** `feat(train-v2): default to true + old-route redirects`

- [ ] **Step 5:** `git tag -a redesign-phase-3-train -m "Phase 3 — Train shipped"`

---

## Acceptance criteria

1. `/app/train/?train_v2=1` renders all 4 modality tabs, both sub-tabs, no console errors on either theme.
2. Logging a set persists to `workout_logs`, advances the current set, starts the rest timer.
3. Rest timer counts down accurately; Skip and ±30s work; chime fires at 0:00 (after first user gesture).
4. History row click expands inline with full set/lap/route detail.
5. Finish-session navigates to `/app/progress?highlight=<id>` and the session is visible there.
6. Ask Emersus drawer slides in from right with seeded session context; user can close + reopen.
7. Auto-save indicator pulses during writes, idle otherwise.
8. Old `/app/workout/*` URLs redirect cleanly when flag is on.
9. `train_v2=0` still serves the prior workout pages (no regressions).
10. Per-modality in-progress sessions persist across tab switches.

---

## Spec coverage check

Covered: modality tabs, session header, sub-tabs, lift/cardio/swim/climb panels, plan banner, exercise card, set rows, add-exercise, rest timer, bottom bar, finish flow, ask drawer, auto-save.

Deferred (intentionally):
- Exercise demo videos — flag `exercise_demo_videos`, falls back to description text. Real videos land when content backend exists.
- HR data ingestion from wearables — manual entry only for now.
- Movement-pattern auto-suggestion in `+ Add exercise` — uses simple muscle-group filter; ML-driven suggestions are post-Phase-9.

---

## Next: Phase 4 (Nutrition)

When Phase 3 stable + tagged, start `2026-04-15-redesign-phase-4-nutrition.md`.
