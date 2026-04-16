# Progress Charts — Design Spec

**Date:** 2026-04-16
**Status:** Approved
**Mockups:** `.superpowers/brainstorm/8524-1776305341/content/progress-charts.html` (v1) · `.superpowers/brainstorm/8524-1776305341/content/progress-charts-alt.html` (v2)

## Summary

Replace the 4 "Coming Soon" placeholder cards on `/app/progress/` with real visualizations. Four distinct chart types, each chosen from the Ferdio data viz catalogue for a specific storytelling purpose:

| # | Chart | Source | What it answers |
|---|---|---|---|
| 1 | **Momentum Cards** | Original (hero number + ghost sparkline + benchmark tick) | "Am I getting stronger on the big lifts, and where do I stand vs. the research?" |
| 2 | **Beeswarm Plot** | Catalogue: `beeswarm-plot` (Distribution + Trend Over Time) | "What's my actual training volume and density, not the averages?" |
| 3 | **Zone River** | Stacked stream graph (catalogue: `stream-graph`) | "What aerobic training pattern am I running — polarized, threshold, zone-2-heavy?" |
| 4 | **Control Chart** | Catalogue: `control-chart` (Shewhart / SPC) | "Is my training load in control, or am I about to hurt myself?" |

All 4 charts are pure SVG — no new library dependency. All 4 work in both Paper and Mint themes. All 4 have explicit mobile treatments.

## Design principles

1. **Every chart has a one-glance takeaway** (momentum, density, pattern, safety).
2. **Annotations interpret data**, not just show it — we're the explanatory coach, not a dashboard.
3. **Research-grounded** — benchmarks, citations, and control limits show up in the charts themselves.
4. **Theme-aware** — all colors come from design tokens; both palettes look correct.
5. **Mobile-first responsive** — every chart has a narrow-viewport treatment defined below.

## New CSS tokens

Add to `shared/design-tokens.css` (both palettes):

```css
/* Progress chart zone palette */
--z1: #3b82f6; /* paper blue (z1 recovery) — mint: #60a5fa */
--z2: #22c55e; /* paper green (z2 endurance) — mint: #34d399 */
--z3: #f59e0b; /* paper amber (z3 tempo) — mint: #fbbf24 */
--z4: #f97316; /* paper orange (z4 threshold) — mint: #fb923c */
--z5: #dc2626; /* paper red (z5 vo2) — mint: #f87171 */
--gold: #b37214; /* PR markers — mint: #fbbf24 */
```

The existing `--success`, `--warning`, `--danger`, `--danger-soft` etc. tokens are reused as-is.

---

## Chart 1 — Momentum Cards (Lift 1RM progression)

### Layout
Three cards in a `grid-template-columns: repeat(3, 1fr)` grid. On phones (`max-width: 600px`), collapse to `1fr` single column.

Each card (min-height 140px, padding 16px):
- **Eyebrow label**: exercise name + period (`BENCH PRESS · 12 WK`), monospace 10px dim
- **Hero number**: current e1RM (40px, weight 700, tabular-nums, letter-spacing -0.02em)
- **Unit**: `KG` or `LB` (monospace 11px dim, baseline-aligned with hero)
- **Sub**: `est. 1RM · last set {load}×{reps} @{rpe}` (monospace 10px dim)
- **Ghost sparkline**: absolute-positioned behind hero number, opacity 0.20, bottom 0, height 70% of card, gradient fill underneath the line, gold dots at PR weeks
- **Momentum badge**: `+5.5 KG ↑ 12 WK` (monospace 10px 600, padding 3×7, radius 4)
  - Green (`--success` on `--success-soft`) if up
  - Amber (`--warning` on `--warning-soft`) if flat (|delta| < 2%)
  - Red (`--danger` on `--danger-soft`) if down
- **Benchmark bar**: 4px high, full-width rail with:
  - Dim track (`--line`)
  - Accent-line colored range showing the user's experience-level benchmark
  - 8px accent dot at user's current e1RM position
  - Right label: `INTERMEDIATE` or `ADVANCED` (monospace 8px)

### Data source

Needs new server computation:
- For each of `bench press`, `back squat`, `deadlift` (match by `exercises.slug`):
  - Query `workout_logs` for last 12 weeks
  - Compute weekly max e1RM via Epley: `load_kg × (1 + reps/30)`
  - Current e1RM = max of last 2 weeks
  - PR weeks = weeks where the e1RM hit a new all-time max
  - Momentum delta = current - 4-weeks-ago
- Benchmark range from `benchmarks` table filtered by `experience_level` (from profile) and `biological_sex` (from profile). If either is missing, use "intermediate" + "male" as defaults.

### Mobile treatment
- Cards stack vertically at `max-width: 600px`
- Hero number shrinks to 32px on phones (`max-width: 400px`)
- Ghost sparkline, benchmark bar, momentum badge all scale fluidly

### Fallback states
- No data for a lift (user hasn't logged it): show placeholder card with `—` for hero, "No {exercise} logged yet" as sub, hide sparkline/benchmark
- Missing profile fields: default to `intermediate` + `male` benchmarks, no UI affordance about it

---

## Chart 2 — Beeswarm Plot (Working weight distribution)

### Layout
Single card, full-width. 800×280 viewBox SVG on desktop, aspect-preserving scaling. Shows bench press only in v1 — add a small "exercise picker" dropdown at top-right for future (Squat/Deadlift) but wire bench first.

### Visual
- **Y-axis**: load (kg), range min-max of the user's last 8 weeks. 4 dashed grid lines.
- **X-axis**: 8 weekly columns, center positions evenly spaced.
- **Dots**: every logged set as a 4px radius circle, opacity 0.7, accent color.
  - Week 8 (current) dots get `opacity: 1`, `stroke: var(--bg)` for pop
  - PR sets (new all-time max) render as 5px gold dots with bg stroke
- **Jitter**: dots within a week cluster horizontally with slight offset to avoid overlap. On desktop, ±8px jitter range per week column. For dense weeks, use force-simulation via d3-force pattern or pre-compute via Poisson-disc. For the MVP, a deterministic sinusoidal jitter is acceptable.
- **PR threshold line**: horizontal dashed gold line at the all-time max, label `PR {max}` top-right
- **Annotation below chart**: `Loads drifting up-and-right = progressive overload working` — small surface-faint card with mono caption, 8px dot in accent color

### Data source
- Query `workout_logs` for last 8 weeks filtered by `exercise_id` for bench press
- Each row becomes a dot: `{ week_idx, load_kg, is_pr }`
- PR detection: `load_kg > max(all_logs_before_this_row.load_kg)` for that exercise
- No server aggregation needed — raw dots to the client

### Mobile treatment
**This chart's narrow-viewport handling is the most complex.**

- On phones (`max-width: 600px`):
  - Collapse x-axis to **4 columns** (pair adjacent weeks: W1+2, W3+4, W5+6, W7+8)
  - Dot radius shrinks to 3px (PR dots to 4px)
  - Axis labels reduce to 3 (earliest, middle, NOW)
  - SVG height drops from 280px to 220px
- Rationale: 8 dense dot columns at 375px width ends up with ~46px per column and overlapping dots. Pairing weeks halves the density.

### Fallback states
- Fewer than 5 sets total in last 8 weeks: show a text message "Log more sets to see your training density" with CTA link to `/app/train/`
- No sets at all: hide card entirely

---

## Chart 3 — Zone River (Cardio HR zones)

### Layout
Single card, full-width. 800×240 viewBox SVG on desktop. Five flowing colored streams (Z1 bottom → Z5 top) across 8 weekly columns, each stream's width = minutes in that zone.

### Visual
- **Streams**: each a single SVG `<path>` with `fill` of `var(--z1)..var(--z5)` (opacity 0.85)
- Path uses cubic Bezier curves between week-column edges for organic flow
- Zones stack from top (Z5 red) down to Z1 blue at the bottom — matches "intensity pyramid" mental model
- **Axis labels**: week markers W1–W8 below the chart (monospace 9px dim, current week "NOW" in accent)
- **Pattern badge** top-right of card header: `Polarized pattern` (or `Threshold` / `Zone-2-heavy`) in accent-soft pill
- **Legend below**: all 5 zones with swatches + names (`Z1 · Recovery`, `Z2 · Endurance`, etc.)

### Pattern classifier logic
Given the last 8 weeks of zone totals:
- **Polarized**: Z1 ≥ 55% AND (Z4 + Z5) ≥ 15% AND (Z2 + Z3) ≤ 20%
- **Threshold**: Z3 ≥ 30%
- **Zone-2-heavy**: Z2 ≥ 40%
- **Base building**: Z1 ≥ 80%
- Default: `Mixed` (no strong signal)

### Data source
- Query `workout_logs` for last 8 weeks where `activity_type` indicates cardio (running, cycling, rowing, swimming) OR `avg_heart_rate IS NOT NULL`
- For each log, compute zone from HR using Karvonen formula:
  - `%hrr = (avg_heart_rate - rest_hr) / (max_hr - rest_hr)` where `max_hr = 220 - age` (from profile DOB), `rest_hr = 60` (default, profile-configurable later)
  - Z1 < 60%, Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 ≥ 90%
- Sum `duration_seconds / 60` per zone per week
- Server response: `[{ week_idx: 1, z1: 120, z2: 18, z3: 14, z4: 22, z5: 8 }, ...]` (minutes)

### Mobile treatment
- On phones (`max-width: 600px`):
  - Reduce axis labels to 3: W1, W4, NOW
  - SVG height drops to 180px
  - Legend wraps onto 2 rows
  - Pattern badge moves below the header (not inline with it) for space

### Fallback states
- No cardio logs in last 8 weeks: hide card entirely (the progress page is modality-aware; zone river only shows when cardio has data)
- Missing `date_of_birth` in profile: default to `max_hr = 190` with a subtle "Age unknown — zones estimated" note in dim mono text
- Any week with total < 5 minutes cardio: its streams shrink to near-zero but still render

---

## Chart 4 — Control Chart (Training load ACWR)

### Layout
Single card, full-width. 800×260 viewBox SVG on desktop. Time-series line chart with horizontal reference lines.

### Visual
- **Background bands** (bottom to top in y-axis order):
  - Detraining zone (ACWR < 0.5): `--danger` fill, opacity 0.06
  - Lower warning (0.5–0.8): `--warning` fill, opacity 0.06
  - Safe zone (0.8–1.3): `--success` fill, opacity 0.08
  - Upper warning (1.3–1.5): `--warning` fill, opacity 0.06
  - Danger (≥ 1.5): `--danger` fill, opacity 0.06
- **Reference lines**:
  - `UCL · 1.5` (upper control limit) — `--danger` 1.5px dashed (`6 4`)
  - `UWL · 1.3` (upper warning limit) — `--warning` 1px dashed (`3 3`)
  - `MEAN · 1.0` — `--success` solid 1.5px (center line)
  - `LWL · 0.8` — `--warning` 1px dashed (`3 3`)
  - `UCL · 0.5` — `--danger` 1.5px dashed (`6 4`)
- **ACWR data line**: `--ink` stroke 2px, 12 weekly points
- **Points**: 4px `--ink` dots, with `--bg` stroke for pop
  - Out-of-control points (above UCL or below LCL): 6px `--danger`, highlighted
  - Current week (last point): 6px `--accent`
- **Line-end labels** (right side of chart): each reference line gets its label in matching color, monospace 9px
- **Y-axis values**: `0.5, 0.8, 1.1, 1.4, 1.7, 2.0` in monospace 9px dim
- **X-axis labels**: `W1, W4, W7, W10, NOW` (every 3 weeks)
- **Callout**: if any point in window is out-of-control, show `↓ SPIKE · WEEK {n}` at the top center in red mono
- **Stats row below chart**:
  - `Current` (current ACWR, 16px bold)
  - `12 wk mean` (mean across window)
  - `Excursions` (count of out-of-control points, red if > 0)
  - `Status` (`In control` in green, `Elevated` in amber, `Out of control` in red — all monospace 13px uppercase letter-spacing)

### Data source
- For each of last 12 weeks, compute ACWR:
  - **Acute load** = sum(`duration_seconds × rpe` or `load_kg × reps × rpe` if resistance) for the 7 days ending that week
  - **Chronic load** = mean of the 4 weekly acute loads ending that week (28-day rolling mean)
  - `ACWR = acute / chronic` (if chronic > 0, else null)
- Mean line = 12-week mean of ACWR
- Out-of-control flag: ACWR > 1.5 or ACWR < 0.5
- Server response: `[{ week_idx, date_start, acwr, acute_load, chronic_load, out_of_control }, ...]`

### Mobile treatment
- On phones (`max-width: 600px`):
  - SVG height drops from 260px to 220px
  - Line-end labels (UCL/UWL/MEAN/etc.) hide — user can still read y-axis tick values
  - Stats row: `grid-template-columns: 1fr 1fr` (2 columns, 2 rows instead of 4 columns)
  - X-axis labels reduce to 3: `W1, W6, NOW`

### Fallback states
- Fewer than 4 weeks of training data (can't compute chronic baseline): show placeholder card "Need 4+ weeks of training to compute your ACWR" with link to train page
- ACWR = null for some weeks (gap in training): interpolate the line but mark those points with a hollow style (`fill: var(--bg)`, `stroke: var(--muted)`)

### Research citation
Footer of card in dim mono text: `GABBETT · BR J SPORTS MED · 2016`

---

## API changes

### `GET /api/progress` response additions

The existing endpoint already has the 4 stub fields (`lift_1rm`, `lift_range`, `cardio_zones`, `training_load`). Rename and populate:

```jsonc
{
  // ... existing fields ...

  "momentum_cards": {
    "items": [
      {
        "slug": "bench-press",
        "name": "Bench Press",
        "current_e1rm_kg": 102,
        "period_weeks": 12,
        "last_set": { "load_kg": 100, "reps": 5, "rpe": 8.5 },
        "sparkline": [96.5, 97.0, 97.5, 98.0, 99.0, 100.0, 100.5, 101.0, 101.5, 102.0, 102.0, 102.0],
        "pr_weeks": [6, 11],
        "momentum_kg": 5.5,
        "momentum_label": "up",
        "benchmark": { "low_kg": 75, "high_kg": 105, "level": "intermediate" }
      }
      // ...squat, deadlift
    ]
  },

  "beeswarm": {
    "exercise_slug": "bench-press",
    "exercise_name": "Bench Press",
    "weeks": 8,
    "sets": [
      { "week_idx": 0, "load_kg": 80, "reps": 8, "rpe": 6, "is_pr": false }
      // ... up to hundreds
    ],
    "pr_load_kg": 115,
    "total_sets": 64
  },

  "zone_river": {
    "weeks": [
      { "week_idx": 0, "z1": 120, "z2": 18, "z3": 14, "z4": 22, "z5": 8 }
      // 8 weeks
    ],
    "pattern": "polarized",  // polarized | threshold | zone_2_heavy | base_building | mixed
    "pattern_label": "Polarized pattern",
    "hr_estimate_note": null  // or "Age unknown — zones estimated"
  },

  "control_chart": {
    "weeks": [
      { "week_idx": 0, "date_start": "2026-02-01", "acwr": 0.92, "acute_load": 1200, "chronic_load": 1305, "out_of_control": false }
      // 12 weeks
    ],
    "current_acwr": 1.08,
    "mean_acwr": 1.12,
    "excursions": 1,
    "status": "in_control"  // in_control | elevated | out_of_control
  }
}
```

### New RPCs (probable)
- `get_momentum_cards(user_id, exercise_slugs, weeks)` — returns 1RM sparklines + PR markers for 3 exercises
- `get_beeswarm_sets(user_id, exercise_slug, weeks)` — returns all logged sets with PR flags
- `get_hr_zone_weeks(user_id, weeks)` — returns weekly zone minutes using profile's age for HR estimation
- `get_acwr_series(user_id, weeks)` — returns weekly ACWR with mean and excursion flags

Client-side computation is also acceptable for simpler pieces (e.g. Epley formula, pattern classification) — pick whichever keeps the server endpoints clean.

## Files touched

| File | Change |
|---|---|
| `shared/design-tokens.css` | Add `--z1..--z5`, `--gold` tokens to both palettes |
| `shared/progress-charts.js` | Add `momentumCard()`, `beeswarmPlot()`, `zoneRiver()`, `controlChart()` SVG helpers |
| `app/progress/progress-v2.js` | Replace 4 `ComingSoon` stubs with real chart components wired to new API fields |
| `shared/progress-v2.css` | Add styles for all 4 charts + mobile media queries |
| `api/emersus/progress.js` | Populate the 4 fields (previously `coming_soon: true`) with real data |
| `supabase/2026XXXX_progress_rpcs.sql` | New RPCs for the computations that don't make sense client-side |

## Not in scope

- Exercise picker for Beeswarm (only bench press in v1 — squat/deadlift later)
- Custom zone boundaries per user (using default Karvonen zones only)
- Historical period selector beyond `week/month/3m/year` (existing pills) — charts always show their defined window
- Swim/climb modality-specific variants
- Chart tooltips with hover-detail (desktop-only polish for a follow-up)
- PNG/shareable export

## Acceptance criteria

1. All 4 charts render real data, no "Coming Soon" placeholders
2. Momentum cards show 3 lifts with current e1RM, sparkline, momentum badge, benchmark bar
3. Beeswarm shows every logged bench press set from last 8 weeks, PR dots in gold
4. Zone River shows 5 stacked streams with pattern classification (polarized / threshold / mixed)
5. Control Chart shows 12 weekly ACWR points with UCL/LCL/mean lines and out-of-control flags
6. All charts work in both Paper and Mint themes
7. All charts have mobile treatments that keep them legible at 375px viewport
8. Momentum cards fall back gracefully when an exercise has no data
9. Beeswarm hides when fewer than 5 sets in 8 weeks
10. Zone River hides when no cardio logged
11. Control Chart shows "need 4+ weeks" placeholder when chronic baseline can't be computed
12. Gabbett 2016 citation visible on Control Chart
