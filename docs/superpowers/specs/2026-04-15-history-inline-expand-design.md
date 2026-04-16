# History Inline-Expand — Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Mockup:** `.superpowers/brainstorm/8524-1776305341/content/full-design-v2.html`

## Summary

Add inline expand/collapse to the History tab on `/app/train/`. Users can expand a session row to see all exercises and their logged sets rendered as grid tiles — directly answering "what did I do last time?" without navigating away.

Also: remove the deferred C.1 "Ask Emersus" drawer item from the project backlog entirely (rejected — the AI chat is a full-page experience, not a sidebar).

## Decisions

| Question | Answer |
|---|---|
| Primary use case | "What did I lift last time?" — quick recall of exercises, sets, loads |
| Collapsed row | Summary chips: title + date + duration + exercise count + set count + total volume (accent chip) |
| Expanded body | All exercises visible immediately with set tiles — no second drill-down |
| Set detail rendering | **Grid tiles** — load as hero number (20px bold), RPE color stripe at bottom, top set accent-highlighted |
| Accordion behavior | One session open at a time; expanding a new row auto-collapses the previous |
| Session note | Shown at bottom of expanded body with accent left-border stripe, italic |

## Collapsed Session Row

```
┌─────────────────────────────────────────────────────────────────┐
│ Upper Body Push                                            ›   │
│ Apr 14 · 10:30 AM · 58 min · [5 exercises] [18 sets] [4,280 kg]│
└─────────────────────────────────────────────────────────────────┘
```

- **Title**: 15px, font-weight 500
- **Meta row**: date + duration in monospace 10px dim, followed by chips
- **Chips**: monospace 9px, `exercises` and `sets` in default muted style, `volume` in accent-soft background with accent text and accent-line border
- **Chevron**: `›` character, rotates 90° on expand
- **Hover**: border-color transitions to `--line-strong`
- **Expanded state**: border-color transitions to `--accent-line`

### Data source

The list API (`GET /api/workout-sessions?modality=X&limit=50`) already returns all fields needed for the collapsed row. The `exercises` JSONB array length gives exercise count. Set count and total volume require either:

- **(A) Compute client-side on expand** from the detail fetch, then cache in component state so subsequent collapses still show chips. This avoids changing the list API.
- **(B) Add computed fields to the list API** (`set_count`, `total_volume_kg`) via a Postgres view or subquery join.

**Recommendation: (A)** — no backend changes.

- **Exercise count chip**: always visible (from `exercises.length` on the list response)
- **Set count + volume chips**: shown only after the session has been expanded at least once (computed from the detail fetch, cached in component state). Before first expand, these two chips are simply absent — the row still looks fine with just the exercise count chip.

If set count + volume on first render (before any expand) becomes important later, add computed fields to the list query.

## Expanded Session Body

When a session row is clicked:
1. If another session is expanded, collapse it (remove `is-expanded` class)
2. If this session hasn't been fetched yet, call `GET /api/workout-sessions/:id` to get the full session + joined `workout_logs` sets
3. Cache the response in component state keyed by session ID (don't re-fetch on re-expand)
4. Render the expanded body

### Exercise blocks

Each exercise in the session gets a block containing:
- **Header**: exercise name (13.5px, weight 500) + "top: {load} kg × {reps}" summary (monospace 10px muted), separated by `justify-content: space-between`
- **Set tiles grid**: `grid-template-columns: repeat(auto-fill, minmax(90px, 1fr))`, gap 4px
- **Divider**: 1px `--line` border between exercise blocks

### Exercise name resolution

The `workout_logs` rows contain `exercise_id` UUIDs. Names must be resolved via the exercises API. The component already maintains an `exerciseLookup` map (used by the Active tab). On expand:
1. Collect unique `exercise_id` values from the fetched sets
2. Filter out IDs already in `exerciseLookup`
3. If any remain, fetch them (the existing `GET /api/exercises` endpoint with `?ids=...` or the recent-exercises fallback)
4. Merge into `exerciseLookup`

### Grouping sets by exercise

The detail endpoint returns a flat `sets[]` array ordered by `created_at`. Group by `exercise_id`, preserving order of first appearance.

## Set Tile

```
┌──────────┐
│ 1        │   ← set number (monospace 8px, absolute top-left)
│    100   │   ← load (20px, weight 700, tabular-nums)
│    KG    │   ← unit label (monospace 8px)
│  × 5  @8 │   ← reps (12px weight 500) + RPE (monospace 9px, color-coded)
│ ████████ │   ← RPE stripe (3px, full width, absolute bottom)
└──────────┘
```

### RPE color coding

| RPE range | Stripe color | RPE text color | Token |
|---|---|---|---|
| ≤ 6 | `--rpe-low` | `--rpe-low` | green (#22c55e light / #34d399 dark) |
| 7–7.5 | `--rpe-med` | `--rpe-med` | amber (#f59e0b light / #fbbf24 dark) |
| ≥ 8 | `--rpe-high` | `--rpe-high` | red (#ef4444 light / #f87171 dark) |
| missing | `--line` | `--dim` | neutral |

### Top set highlight

The set with the highest `load_kg` in each exercise gets:
- `border-color: var(--accent-line)`
- `background: var(--accent-soft)`
- Load number color: `var(--accent)`

Tie-breaking: if multiple sets share the max load, pick the one with more reps. If still tied, first one wins.

### Weight unit

Respect the user's `weight_unit` preference (already resolved in the component as `weightUnit` from profile). Display load in user's unit, show unit label accordingly (KG or LB). Convert from canonical `load_kg` stored in `workout_logs`.

### Missing data

- **No RPE logged**: hide RPE text, show neutral `--line` stripe
- **No load logged**: show reps only, no unit label, tile still renders (bodyweight exercises)
- **No sets at all**: show exercise name with "No sets logged" in dim text instead of tile grid

## Session Note

If `session.note` is non-null and non-empty, render below the last exercise block:

```
│ "Bench felt good, shoulder was a bit tight on OHP."
```

- Left border: 2px solid `--accent-line`
- Padding: 8px 11px
- Font: 12.5px, italic, color `--muted`

## Loading State

While `GET /api/workout-sessions/:id` is in-flight, show a skeleton inside the expanded body:
- 3 skeleton blocks mimicking exercise headers + tile grids
- Reuse existing `skel` / `skel-block` classes from `train-v2.css`

## Error State

If the detail fetch fails, show an inline error inside the expanded body (not a toast):
- "Could not load session details." + dismiss button
- Style matches existing `tr-error` pattern

## New CSS tokens

Add to `shared/design-tokens.css` inside both palette blocks:

```css
--rpe-low: #22c55e;   /* mint: #34d399 */
--rpe-med: #f59e0b;   /* mint: #fbbf24 */
--rpe-high: #ef4444;  /* mint: #f87171 */
--rpe-low-bg: rgba(34,197,94,0.08);
--rpe-med-bg: rgba(245,158,11,0.08);
--rpe-high-bg: rgba(239,68,68,0.08);
```

## Files touched

| File | Change |
|---|---|
| `app/train/train.js` | Expand/collapse state, detail fetch + cache, exercise grouping, tile rendering, accordion logic |
| `shared/train-v2.css` | New styles for expanded body, exercise blocks, set tiles, chips, note, loading skeleton |
| `shared/design-tokens.css` | Add RPE color tokens to both palettes |

## Not in scope

- C.1 "Ask Emersus" drawer — **removed from backlog** (rejected)
- Cardio/swim/climb history detail (different set shapes — separate spec if needed)
- Session editing or deletion from history
- Comparing two sessions side-by-side
- PR detection / historical comparison badges on tiles

## Acceptance criteria

1. History tab shows collapsed rows with title, date, duration, exercise count chip, set count chip, volume chip (accent)
2. Clicking a row fetches session detail and expands to show all exercises with set tiles
3. Clicking another row collapses the first and expands the new one (accordion)
4. Set tiles show load as hero number, reps, RPE with color stripe, top set highlighted
5. Weight unit respects user preference (kg/lb)
6. Session note renders with accent left-border when present
7. Works in both Paper and Mint themes
8. Loading skeleton shown during fetch
9. Error shown inline if fetch fails
