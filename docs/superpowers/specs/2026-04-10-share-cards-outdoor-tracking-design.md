# Share Cards + Outdoor Tracking — Design Spec

**Date:** 2026-04-10
**Status:** Approved
**Predecessor:** `2026-04-10-workout-tracking-design.md` (Phase 1 — progress dashboard)

## Goal

Let users celebrate and share their workouts with a Strava-style post-workout summary card, and track outdoor/sport activities (cardio with GPS, pool swimming, climbing) that don't fit the resistance training model.

## Scope

Two interlocking features shipping together:

1. **New session views** for cardio (outdoor GPS), pool swimming (lap tap), and climbing (route logging) — distinct from the existing resistance session view
2. **Post-workout share card** generated via Canvas 2D → PNG, distributed via Web Share API with Download / Copy fallbacks
3. **GPS tracking** for outdoor cardio via `navigator.geolocation.watchPosition`
4. **Mapbox Static API** integration for rendering the route map on the cardio share card
5. **LLM workflow updates** so generated plans can target cardio, swimming, and climbing sessions with correct block shapes
6. **Onboarding additions** for preferred sports and default pool length / grade system

### Out of scope

- Live interactive map during tracking (Mapbox GL JS, Leaflet) — explicitly deferred for battery and code-size reasons
- Elevation gain / heart rate / cadence sensor integration
- Route search, social follow, leaderboards, segments
- Freestyle (unplanned) workouts — still requires an LLM-generated plan as entry point for v1
- Multi-sport / brick workouts (triathlon) — requires unified session view
- Sport-specific metrics beyond what's listed (stroke count for swimming, cadence for climbing, wind / weather context)

---

## System Overview

```
┌──────────────────────┐         ┌──────────────────────┐         ┌──────────────────┐
│  /app/workout/       │──pick──▶│  Session views       │──save──▶│  workout_plans   │
│  (planner, routes by │         │  • resistance (exst) │         │  .plan JSONB     │
│   block category)    │         │  • cardio   (new)    │         └──────────────────┘
└──────────────────────┘         │  • swim     (new)    │                  │
                                 │  • climb    (new)    │                  │
                                 └──────┬───────────────┘                  ▼
                                        │                          ┌──────────────────┐
                                        │ Finish & share            │  workout_logs    │
                                        ▼                          │  (flat, for      │
                                 ┌──────────────────────┐           │   analytics)    │
                                 │  share-card.js       │           └──────────────────┘
                                 │  (Canvas 2D render)  │
                                 │  + mapbox static     │
                                 └──────┬───────────────┘
                                        │
                                        ▼
                                 ┌──────────────────────┐
                                 │  Share modal         │
                                 │  • Preview PNG       │
                                 │  • Web Share API     │
                                 │  • Download / Copy   │
                                 └──────────────────────┘
```

**Variant selection logic** (client-side, when planner routes to a session):

| First block's exercise category | Route |
|---|---|
| `resistance` or `bodyweight` | `/app/workout/session/` (existing) |
| `cardio` | `/app/workout/cardio/` |
| `swimming` | `/app/workout/swim/` |
| `climbing` | `/app/workout/climb/` |
| `hybrid` (mixed block categories) | `/app/workout/session/` with inline mini-cardio for cardio blocks |

Session-level `category` field (optional, from LLM) overrides block-level inference.

---

## Session View 1: Cardio (`/app/workout/cardio/`)

### Pre-start screen
- **Editable session title** — input prefilled with `session.title`. User can tap to edit; edit persists to plan JSONB on Start via `applyManualWorkoutPlanEdit`.
- **Activity type chips** — Running / Cycling / Walking / Hiking / Other. Prefilled from the block's exercise (e.g. `running` → Running chip active).
- **Prescribed target display** — read-only from the plan block (`duration_target_minutes`, `distance_target_km`, notes)
- **Start button** — big lime-to-blue gradient, primary CTA

### Live tracking screen
- **Giant timer** — MM:SS, font-variant-numeric: tabular-nums, 3.5rem weight 900
- **Three stat tiles:** Distance (km or mi from `profiles.distance_unit`), Current Pace (rolling 30s window, min/km or min/mi), Avg Pace (session average)
- **GPS indicator** — small lime pill "GPS locked · N sats" in the top bar; turns amber if signal degrades, red if lost
- **Pause button** — stops timer + GPS recording; inserts a pause marker in the path so the map doesn't draw straight lines across breaks
- **Finish button** — opens confirmation dialog
- **Screen Wake Lock API** requested on start, released on pause/finish

### Paused state
- Timer greyed out, Distance and Current Pace tiles greyed out, Avg Pace preserved
- **Resume** button (primary) + **Finish & share** button (secondary)

### Finish confirmation dialog
- Summary: duration, distance, avg pace
- Two buttons: **Finish** (just save, go to planner) and **Finish & share** (save, open share modal)

### GPS handling details
- **Permission requested on Start tap** (not page load) so the user understands why the prompt appears
- `navigator.geolocation.watchPosition()` with `{enableHighAccuracy: true, maximumAge: 2000, timeout: 10000}`
- **Throttling:** one accepted point every 3 seconds (rejected points still feed the position buffer)
- **Jitter filter:** drop points where implied speed > 50 m/s OR cumulative distance from previous accepted point < 3m
- **Permission denied** → tile row switches to "--" for Distance and Current Pace, small banner "GPS unavailable — tracking time only", session continues
- **No movement for 5 min** → same fallback (treadmill mode)
- **Unit display:** distance and pace respect a new profile field `distance_unit` (km | mi), independent from `weight_unit`

### Crash recovery
- Every 10 seconds during live tracking, persist `{gps_path, start_time, paused_seconds, activity_type, session_title}` to `localStorage` keyed by `${plan_id}:${session_id}`
- On cardio session mount, check localStorage for the same key — if present, show "Resume previous session?" banner with Continue / Discard

---

## Session View 2: Swimming (`/app/workout/swim/`)

### Pre-start screen
- **Editable session title**
- **Stroke type chips** — Freestyle / Back / Breast / Fly / IM
- **Pool length chips** — 25m / 50m / 25yd / 33⅓yd. Default from `profiles.default_pool_length_m`.
- **Prescribed target display** — from block
- **Start button**

### Live tracking screen
- **Elapsed time** in the top bar (small, not the hero)
- **Lap counter** — big lime number, giant label "Laps · Xm"
- **Lap tap button** — oversized, gradient-bordered, "TAP FOR LAP" — each tap increments lap count and records a timestamp
- **Undo last lap** text link below
- **Stats row:** Pace /100m / Last lap / Fastest lap
- **Pause / Finish** button row at bottom

### Computed fields
- `total_distance_m = lap_count × pool_length_m`
- `lap_splits = [seconds between consecutive taps]`
- `avg_pace_per_100m = (total_seconds × 100) / total_distance_m`

### Safeguards
- Lap count capped at 500 (prevents runaway mistaps)
- Undo removes last lap + removes last split
- No GPS permission requested

---

## Session View 3: Climbing (`/app/workout/climb/`)

### Pre-start screen
- **Editable session title**
- **Style chips** — Bouldering / Sport / Top-rope / Trad. Default from `profiles.default_grade_system`-implied style.
- **No prescribed target** (climbing sessions don't have rep targets)
- **Start button**

### Live screen
- **Wall-clock timer** in top bar (small)
- **"+ Add route" button** — primary, opens modal
- **Route list** — scrollable, newest at top. Each row: grade + optional name + send-type badge (FLASH / SEND / PROJECT). Tap to edit.
- **Finish / Finish & share** buttons at bottom

### Add Route modal
- **Grade grid** — 5-column grid of V0-V17 (bouldering) or 5.6-5.15d (YDS sport). Switchable by session style.
- **Attempts counter** — minus/plus buttons, default 1
- **Send type toggle** — three pills: Flash (attempts = 1), Send (attempts > 1, completed), Project (not completed)
  - Auto-syncs: if attempts = 1 and user taps Send, it becomes Flash. If user taps Project, attempts don't matter.
- **Optional route name** text input
- **Log route** button — appends to session's route list, closes modal

### Computed fields (for share card)
- `total_routes = routes.length`
- `hardest_sent_grade` — max grade where `send_type in ['flash', 'send']`
- `flash_count = routes filter send_type == 'flash'`
- `send_count = routes filter send_type == 'send'`
- `project_count = routes filter send_type == 'project'`

---

## Share Card Generation

### Module: `shared/share-card.js`

Pure Canvas 2D renderer. No build step, no dependencies beyond browser native APIs.

### Output
- **Resolution:** 1080 × 1350 (4:5 portrait, Instagram post / story friendly)
- **Format:** PNG via `canvas.toBlob('image/png', 0.95)`
- **Fonts:** Inter (400, 600, 700, 800, 900) loaded via FontFace API before drawing
- **Background:** radial-gradient layer drawn via `ctx.createRadialGradient` matching the approved mockups

### Variant matrix

| Variant | Hero stat | Bottom section | Triggered by |
|---|---|---|---|
| **Gym** | Total volume (e.g. "12.4t") | Top 3 exercises with best set + PR badges | All blocks `resistance` or `bodyweight` |
| **Cardio with map** | Distance (e.g. "10.2km") | Mapbox static route image | All blocks `cardio` AND GPS path has ≥ 2 points after privacy crop |
| **Cardio time-only** | Duration (e.g. "45:00") | Activity icon + activity type text | All blocks `cardio`, no GPS or cropped too short |
| **Swim** | Distance (e.g. "1,500m") | Lap splits bar chart (highlighted fastest in gold) | All blocks `swimming` |
| **Climb** | Hardest grade sent (e.g. "V7") | Top 3 sends list with send-type badges | All blocks `climbing` |
| **Hybrid** | Duration + total volume stacked | Compact exercise list | Mixed block categories or session.category === 'hybrid' |

Mini-stats row (common to all variants, 3 tiles):
- Gym: Sets / Exercises / Duration
- Cardio: Time / Pace /km / Activity
- Swim: Time / Pace /100m / Laps × pool length
- Climb: Routes / Flashes / Style

### Mapbox Static integration (cardio variant only)

**Polyline encoding** — standard Google polyline algorithm (30 lines of JS in `shared/mapbox.js`).

**URL template:**
```
https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/path-5+9ffb00-0.85(${encoded})/auto/900x500@2x?access_token=${MAPBOX_PUBLIC_TOKEN}
```

- Style `mapbox/dark-v11` matches Emersus's dark UI
- Path color `#9ffb00` (lime secondary), 5px wide, 85% opacity
- `auto` bounds = tight fit with padding
- `@2x` for retina

**Privacy crop** — before encoding:
1. Walk path forward, drop points until cumulative distance > `profiles.mapbox_privacy_radius_m` (default 100m)
2. Walk path backward, drop points until cumulative distance > radius
3. If < 2 points remain → skip map, fall back to Cardio time-only variant

**Token handling** — `MAPBOX_PUBLIC_TOKEN` served via `/api/config` alongside Supabase keys. URL-restricted in Mapbox dashboard to `https://emersus.ai/*`. Missing token → cardio variant falls back to time-only.

### Failure modes
- Font load timeout (3s) → draw with system-ui fallback
- Mapbox fetch fails → render card without map, keep share flow working
- Canvas export fails (memory) → retry at 720×900, show toast if still fails
- Navigator.share rejected → silent, user can Download instead
- All failures → session is already saved; the share flow never blocks completion

---

## Share Modal

### States
- `idle` → show spinner "Generating card..."
- `rendering` → font loading + canvas drawing + (cardio) Mapbox fetch
- `ready` → preview shown, buttons enabled
- `sharing` → Web Share API dialog open
- `shared` → success state, auto-dismiss 2s → redirect to planner
- `error` → error message + Retry button

### Buttons (in order of priority)
1. **Share** — `navigator.share({files: [pngBlob], title: session.title, text: shareText})`. Hidden if `navigator.canShare({files: [testFile]})` returns false.
2. **Download** — `<a download="${session.title}.png">` with object URL. Primary on desktop where Web Share API is unavailable.
3. **Copy to clipboard** — `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`. Shown only if the browser supports it.
4. **Close** — secondary. If nothing shared yet, confirms "Your session is saved. Close without sharing?"

### Share text template
```
${session.title} — ${hero_stat}. Logged on emersus.ai
```
(E.g., "Morning Run — 10.2km. Logged on emersus.ai")

### Performance budget
- Modal open → card visible: **< 800ms** target
- Font load ~200ms (cached after first use), Mapbox ~300ms, canvas draw ~50ms, blob encode ~50ms

---

## Data Model

### DB migrations (all additive)

**1. `supabase/20260412_workout_logs_cardio_columns.sql`**
```sql
ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS gps_path jsonb,
  ADD COLUMN IF NOT EXISTS activity_type text,
  ADD COLUMN IF NOT EXISTS detail jsonb;
```
- `gps_path` — nullable, array of `{lat, lng, t, alt?}` tuples
- `activity_type` — canonical string like `running`, `cycling`, `swimming_freestyle`, `bouldering`
- `detail` — flexible JSONB for category-specific fields (stores `routes[]` for climbing, `lap_splits[]` for swimming)

**2. `supabase/20260412_exercises_expanded_categories.sql`**
```sql
ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_category_check;
ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_category_check
  CHECK (category IN ('resistance', 'cardio', 'bodyweight', 'swimming', 'climbing', 'hybrid'));

INSERT INTO public.exercises (slug, name, aliases, muscle_groups, equipment, category, movement_type) VALUES
  ('swimming_freestyle',   'Freestyle Swim',   '{"Freestyle","Front Crawl","Free"}', '{}', 'pool',  'swimming', null),
  ('swimming_backstroke',  'Backstroke',       '{"Back"}',                           '{}', 'pool',  'swimming', null),
  ('swimming_breaststroke','Breaststroke',     '{"Breast"}',                         '{}', 'pool',  'swimming', null),
  ('swimming_butterfly',   'Butterfly',        '{"Fly","Butterfly Swim"}',           '{}', 'pool',  'swimming', null),
  ('swimming_im',          'Individual Medley','{"IM","Medley"}',                    '{}', 'pool',  'swimming', null),
  ('swimming_open_water',  'Open Water Swim',  '{"OWS"}',                            '{}', 'open',  'swimming', null),
  ('bouldering',           'Bouldering',       '{"Boulder"}',                        '{}', 'wall',  'climbing', null),
  ('sport_climbing',       'Sport Climbing',   '{"Lead","Sport Climb"}',             '{}', 'wall',  'climbing', null),
  ('top_rope_climbing',    'Top-rope Climbing','{"Top Rope","TR"}',                  '{}', 'wall',  'climbing', null),
  ('trad_climbing',        'Trad Climbing',    '{"Trad"}',                           '{}', 'wall',  'climbing', null)
ON CONFLICT (slug) DO NOTHING;
```

**3. `supabase/20260412_profile_share_settings.sql`**
```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name_public   text,
  ADD COLUMN IF NOT EXISTS mapbox_privacy_radius_m integer DEFAULT 100,
  ADD COLUMN IF NOT EXISTS default_pool_length_m smallint,
  ADD COLUMN IF NOT EXISTS default_grade_system  text
    CHECK (default_grade_system IS NULL OR default_grade_system IN ('V', 'YDS', 'Font', 'French')),
  ADD COLUMN IF NOT EXISTS preferred_sports      text[],
  ADD COLUMN IF NOT EXISTS distance_unit         text
    CHECK (distance_unit IS NULL OR distance_unit IN ('km', 'mi'));
```

### JSONB extensions (no schema changes, just conventions)

**Cardio block in `completed_blocks[]`:**
```json
{
  "block_id": "b_s_w1d1_0",
  "activity_type": "running",
  "gps_path": [{"lat": 40.7128, "lng": -74.006, "t": 1775862681000, "alt": 12.5}],
  "total_distance_m": 10234.5,
  "duration_seconds": 2891,
  "paused_seconds": 45,
  "avg_pace_sec_per_km": 282,
  "session_notes": ""
}
```

**Swimming block:**
```json
{
  "block_id": "b_s_w1d1_0",
  "pool_length_m": 25,
  "stroke_type": "freestyle",
  "lap_count": 60,
  "lap_splits": [32, 31, 33, 30, 29],
  "total_distance_m": 1500,
  "duration_seconds": 1692,
  "session_notes": ""
}
```

**Climbing block:**
```json
{
  "block_id": "b_s_w1d1_0",
  "style": "bouldering",
  "routes": [
    {"grade": "V4", "grade_system": "V", "attempts": 1, "send_type": "flash", "name": "The Nose"},
    {"grade": "V5", "grade_system": "V", "attempts": 3, "send_type": "send"},
    {"grade": "V6", "grade_system": "V", "attempts": 0, "send_type": "project"}
  ],
  "duration_seconds": 5400,
  "session_notes": ""
}
```

### `upsert_workout_logs` RPC updates

Branches by block category:
- **Resistance / bodyweight** — existing behavior (one row per set)
- **Cardio** — one row per block with `duration_seconds`, `distance_meters = total_distance_m`, `gps_path`, `activity_type`
- **Swimming** — one row per block with `duration_seconds`, `distance_meters = lap_count × pool_length_m`, `activity_type = "swimming_${stroke_type}"`, `detail = {pool_length_m, lap_count, lap_splits}`
- **Climbing** — one row per block with `duration_seconds`, `activity_type = style`, `detail = {routes: [...]}`. No distance/reps/load.
- **Hybrid** — iterate blocks and dispatch each to its category branch

### Analytics impact (implementation detail, not blocker)

Progress dashboard gains a category breakdown:
- Resistance volume (existing)
- Cardio total distance + duration
- Swim total distance + duration
- Climb routes sent + hardest grade

New PR types in `get_personal_records`:
- `longest_distance` per cardio activity
- `fastest_pace` per cardio activity
- `fastest_100m_swim` per stroke type
- `hardest_grade_sent` per climbing style

These are spec-level acknowledgments; exact SQL lands in the plan.

---

## LLM Workflow Updates

### System prompt additions (workout-plan fences)

Extend the WORKOUT-PLAN FENCES section in `api/emersus/workflow.js` with:

1. **Per-category block schemas:**
   - `resistance` / `bodyweight` — existing shape (sets, reps, load, rpe, rest_seconds)
   - `cardio` — `{name, category: "cardio", activity_type, duration_target_minutes?, distance_target_km?, pace_target?, rpe?, notes?}`
   - `swimming` — `{name, category: "swimming", stroke_type, distance_target_m?, pool_length_m?, notes?}`
   - `climbing` — `{name, category: "climbing", style, target_grades?, notes?}`

2. **Session-level `category` field** — optional, overrides block-level inference. Values: `resistance | cardio | swimming | climbing | hybrid`. Used by the frontend router.

3. **Activity type whitelist** — fixed string set:
   `running | cycling | walking | hiking | swimming_freestyle | swimming_backstroke | swimming_breaststroke | swimming_butterfly | swimming_im | swimming_open_water | bouldering | sport_climbing | top_rope_climbing | trad_climbing | yoga | boxing | other`

4. **Worked examples** — add 3-4 concrete plan examples to the system prompt:
   - 4-week 5k running build with cardio sessions
   - Pool swimming plan with distance + stroke variations
   - Bouldering session plan with projected grades
   - Hybrid CrossFit WOD (warmup + strength block + metcon)

5. **Profile context additions** — pass `user_profile.weight_unit`, `user_profile.distance_unit`, `user_profile.preferred_sports`, `user_profile.default_pool_length_m`, `user_profile.default_grade_system` into the system prompt so the LLM defaults values correctly.

### Onboarding flow

Add a new question to the onboarding conversation (`ONBOARDING_SYSTEM_PROMPT`):

> "What kind of training do you do? You can pick multiple: weights, running, cycling, swimming, climbing, mixed."

Follow-ups if user picks:
- Swimming → "Pool length? 25m / 50m / 25yd?"
- Climbing → "What grade system do you use? V-scale, YDS, Font, French?"

### `profile-update` fence whitelist

Extend `validColumns` in `upsertOnboardingProfile`:
```js
const validColumns = new Set([
  "goal", "experience_level", "dietary_preferences", "injuries_limitations",
  "equipment_access", "available_days_per_week", "available_minutes_per_session",
  "sleep_stress_context", "primary_use_case", "weight_unit", "distance_unit",
  "preferred_sports", "default_pool_length_m", "default_grade_system",
  "onboarding_completed",
]);
```

---

## Privacy, Settings, Edge Cases

### Profile settings panel additions (`/app/profile/`)

New editable section "Sharing & Tracking":
- **Display name on share cards** — text input, default empty (no name shown)
- **Path privacy radius** — dropdown 0 / 50 / 100 / 200 / 500m, default 100
- **Default pool length** — dropdown 25m / 50m / 25yd / 33⅓yd, empty default
- **Default grade system** — dropdown V / YDS / Font / French, empty default
- **Distance unit** — toggle km / mi

All persist via `upsertProfile` on change (same pattern as `weight_unit`).

### Edge cases

| Scenario | Behavior |
|---|---|
| Wake Lock API unavailable | Silent fallback, session works |
| GPS denied mid-session | Toast, continue time-only, skip map on share |
| Tab backgrounded | `watchPosition` continues where platform allows; > 5min gap inserts pause marker; warning toast on return |
| Crash/reload mid-session | localStorage resume prompt on mount |
| Cardio exercise not in catalog | Fuzzy match → auto-create via existing pipeline |
| Swimming lap mistap | Undo last lap button; 500-lap hard cap |
| Climbing route wrong grade | Tap route to reopen Add Route modal with current values |
| User shares then closes | Session `completion_status = 'completed'` already saved before modal opens |
| Mapbox token missing | Cardio variant falls back to time-only |
| Canvas crash | Retry at 720×900, then show "Session saved, card failed" toast |
| Share API rejected | Silent, user can Download instead |

### Privacy crop verification
- Test: 5km run starting and ending at same address → cropped path omits first 100m and last 100m, map shows only the middle loop
- Short workout (< 300m total) → skip map entirely, fall back to time-only layout

---

## File Plan

### New files
| File | Purpose |
|------|---------|
| `supabase/20260412_workout_logs_cardio_columns.sql` | gps_path, activity_type, detail columns |
| `supabase/20260412_exercises_expanded_categories.sql` | swim + climb categories and seeds |
| `supabase/20260412_profile_share_settings.sql` | profile sharing preferences |
| `shared/share-card.js` | Canvas 2D renderer for all 6 variants |
| `shared/mapbox.js` | Polyline encoder + static API URL builder |
| `shared/gps-tracker.js` | watchPosition wrapper, jitter filter, distance calc, pause handling |
| `shared/climbing-grades.js` | Grade system definitions (V, YDS, Font, French) + comparator |
| `shared/share-modal.js` | React component for the share modal (used by all session views) |
| `app/workout/cardio/index.html` | Cardio session HTML shell |
| `app/workout/cardio/cardio.js` | Cardio React component |
| `app/workout/swim/index.html` | Swim session HTML shell |
| `app/workout/swim/swim.js` | Swim React component |
| `app/workout/climb/index.html` | Climb session HTML shell |
| `app/workout/climb/climb.js` | Climb React component |

### Modified files
| File | Change |
|------|--------|
| `shared/supabase.js` | `upsertWorkoutLogs` handles new block categories |
| `app/workout/workout.js` | Route to correct session view by first block's category |
| `app/workout/session/session.js` | Add "Finish & share" button; hybrid session inline cardio handling |
| `app/profile/index.html` | New sharing & tracking settings section |
| `shared/app-pages.js` | Handle new profile fields (display_name_public, privacy_radius, etc.) |
| `api/emersus/workflow.js` | LLM system prompt updates; onboarding questions; validColumns whitelist |
| `api/config.js` | Expose `MAPBOX_PUBLIC_TOKEN` in client config response |
| `.env.example` | Add `MAPBOX_PUBLIC_TOKEN` placeholder |

---

## Assumptions & Open Questions

- **Mapbox free tier capacity** — 50k map loads / month. Assumption: initial user base is well within this. Monitor usage in Mapbox dashboard before opening to public.
- **Web Share API coverage** — iOS Safari ≥ 15, Chrome Android, Chrome/Edge desktop (partial). Firefox desktop has no support — falls back to Download.
- **Mobile GPS accuracy** — `enableHighAccuracy: true` typically gives ±5-10m accuracy outdoors. Indoor / tunnel / urban canyon are expected failure modes; we show pace/distance as "--" rather than bad data.
- **Canvas PNG size at 1080×1350** — roughly 300-600KB typical. Under the 2MB Instagram and iMessage attachment limits.
- **Climbing grade conversion** — we store grades as strings with explicit `grade_system`. No cross-system conversion for v1 (no "V5 ≈ 5.11d" lookups). Users can record in whatever system they climb in.
