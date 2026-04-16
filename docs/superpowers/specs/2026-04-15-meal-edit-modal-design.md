# Meal Edit Modal — Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Mockup:** `.superpowers/brainstorm/8524-1776305341/content/meal-edit-full.html`

## Summary

Add an inline meal-edit modal to `/app/nutrition/`. Tapping a meal row on the Today tab opens a modal showing all food items in that meal slot with editable amounts, per-item macros, meal slot reassignment, delete with confirmation, and an inline food search to add new items. A standalone "+ Log food" button on the page lets users add food without pre-selecting a meal slot. Changes auto-save on blur. No backend changes required — all necessary API endpoints already exist.

## Decisions

| Question | Answer |
|---|---|
| What can you do in the modal? | Edit amount, change meal slot (move item via dropdown), delete item, add new item via search |
| Grouping | Tap a meal slot row (e.g. "Breakfast") → see all entries in that slot |
| Set detail rendering | List rows: food name, colored macro badges, editable amount input, per-item kcal, delete button |
| Adding new items | Inline search field at bottom of item list, dropdown results, tap to add |
| Save behavior | Auto-save per item on blur (PATCH). Delete is instant after confirmation. |
| Meal total | Summary bar at bottom showing total kcal + macro breakdown, updates live |

## Current State

The `MealsList` component in `nutrition-v2.js` (line 237) renders meal entries as read-only `<article>` cards. Each card shows time, meal slot name, LOGGED/PLANNED pill, and a macro string. There is no click handler, no edit action, no delete action. Editing happens entirely via chat.

The nutrition day API (`GET /api/nutrition/day`) returns meals as **individual entries** (one per `meal_journal_entries` row), each with `id, type (meal_slot), eaten_at, kcal, protein_g, carbs_g, fat_g`. But this endpoint lacks food names and amounts — it only has snapshot macros.

The meal journal API (`GET /api/emersus/meal-journal/day?date=YYYY-MM-DD`) returns **full entries with food joins** including `food.description`, `amount`, `amount_unit`, and all snapshot macros. This is the data source for the modal.

## Meal Row Changes

The existing `MealsList` component currently renders one row per entry. For the modal, we need to **group entries by `meal_slot`** so tapping "Breakfast" opens all breakfast items.

### Grouped meal row (collapsed)

```
┌───────────────────────────────────────────────────────┐
│ 7:30   Breakfast                          3 items  >  │
│        452 kcal · 17g P · 81g C · 12g F               │
└───────────────────────────────────────────────────────┘
```

- **Time**: earliest `eaten_at` in the group, formatted as HH:MM
- **Name**: meal slot label (capitalized)
- **Macros**: sum of all entries in the group
- **Item count**: chip showing `N items`
- **Chevron**: `>` to signal tappability
- **Click handler**: opens the modal for that meal slot
- **Planned meals**: still render individually (no grouping), non-tappable, keep the `is-planned` class and PLANNED pill

### Data flow

1. The nutrition page already fetches `GET /api/nutrition/day` on mount (provides the grouped meal row data)
2. When modal opens, fetch `GET /api/emersus/meal-journal/day?date=YYYY-MM-DD` for full entry details with food joins
3. Cache the journal response in component state for the page session
4. After any mutation (PATCH/DELETE/POST), re-fetch the journal day AND the nutrition day to update both the modal and the page totals

## Modal

### Header

```
┌──────────────────────────────────────┐
│ Breakfast                         x  │
│ TODAY, APR 15 · 3 ITEMS LOGGED       │
└──────────────────────────────────────┘
```

- Title: meal slot label (16px, weight 600)
- Subtitle: date + item count (monospace 9px, dim)
- Close button: `x` top-right

### Food item rows

Each entry in the meal slot gets a row:

```
┌─────────────────────────────────────────────────────┐
│ Oatmeal, cooked                    [250] g   242  x │
│ 8g P · 42g C · 4g F                                 │
└─────────────────────────────────────────────────────┘
```

- **Food name**: 14px, weight 500, from `food.description`
- **Meal slot select**: small inline `<select>` dropdown (monospace 9px, dim) showing the current slot (Breakfast, Lunch, etc.). Changing it PATCHes `meal_slot` immediately. If the item moves to a different slot, it disappears from the current modal view (since it's no longer in this meal slot). The slot labels come from the existing `MEAL_SLOT_LABELS` constant.
- **Macro badges**: monospace 9px, protein in `--protein` color, carbs in `--carbs`, fat in `--fat`
- **Amount input**: 60px wide, right-aligned, monospace 13px, editable number input. Step = 10 for grams, 0.5 for servings.
- **Unit label**: monospace 10px dim, shows `g` or `srv` based on `amount_unit`
- **Per-item kcal**: monospace 11px muted, computed from snapshot (read-only display)
- **Delete button**: `x`, dim by default, red on hover. Click shows inline delete confirmation.

### Auto-save behavior

When the user changes the amount input and blurs (or presses Enter):
1. Debounce 500ms
2. `PATCH /api/emersus/meal-journal/entries/:id` with `{ amount }`
3. Show brief "Saving..." indicator
4. On success: update the entry in local state with the returned data (new macro snapshots), recalculate meal total
5. On error: revert the input value, show inline error

### Macro recalculation

The PATCH RPC (`update_meal_journal_entry`) recomputes `kcal_snapshot`, `protein_g_snapshot`, etc. server-side based on the new amount. The response returns the updated entry with new snapshots. The modal updates the per-item kcal display and the meal total from these returned values.

### Meal total summary bar

```
┌─────────────────────────────────────────────────────┐
│ MEAL TOTAL              17g P · 81g C · 12g F       │
│ 452 kcal                                             │
└─────────────────────────────────────────────────────┘
```

- Background: `--surface-faint`
- Left: label (monospace 9px dim) + total kcal (16px weight 600)
- Right: macro breakdown (monospace 10px, colored)
- Updates live after each save or delete

### Delete confirmation

When the user clicks the delete button on a food item:
1. The item row fades to 40% opacity
2. An inline confirmation bar appears below the item list:
   ```
   ┌─────────────────────────────────────────────────────┐
   │ Remove "Oatmeal, cooked"?     [Remove]  [Cancel]   │
   └─────────────────────────────────────────────────────┘
   ```
3. Bar background: `--danger-bg`, text color: `--danger`
4. "Remove" button: solid danger background, white text
5. "Cancel" button: ghost style
6. On confirm: `DELETE /api/emersus/meal-journal/entries/:id`, remove from local state, update totals
7. On cancel: dismiss bar, restore item opacity
8. If deleting the last item, show the empty state

### Add food via search

Below the meal total, an inline search input:

```
┌─────────────────────────────────────────────────────┐
│ [Search to add a food...                          ] │
└─────────────────────────────────────────────────────┘
```

- Debounce 300ms after typing (min 2 characters)
- Fetch `GET /api/emersus/foods/search?q=...&kind=food&limit=8`
- Show results as a dropdown list below the input:
  ```
  ┌─────────────────────────────────────────────────────┐
  │ Greek yogurt, plain                  59 kcal / 100g │
  │ Greek yogurt, honey                  97 kcal / 100g │
  └─────────────────────────────────────────────────────┘
  ```
- Each result shows food name + kcal per base amount
- On click: `POST /api/emersus/meal-journal/entries` with:
  - `food_id`: selected food's ID
  - `logged_date`: current day's date
  - `meal_slot`: the modal's meal slot (or the slot picked in the standalone quick-log flow)
  - `amount`: smart default — if the food has `common_unit` and `common_unit_grams` (e.g. "1 large egg = 50g"), use `common_unit_grams` as the default amount. Otherwise fall back to `base_amount` (typically 100 for grams, 1 for servings).
  - `amount_unit`: `g` if food's `base_unit` is `100g`, `serving` if `serving`
  - `source`: `manual_search`
- On success: add the new entry to local state, clear search, update totals
- On error: show inline error below search

### Empty state

If a meal slot has zero items (e.g. user deleted everything):

```
┌─────────────────────────────────────────────────────┐
│              No items logged yet.                    │
└─────────────────────────────────────────────────────┘
```

The search input remains available below so the user can add items.

### Loading state

While fetching `GET /api/emersus/meal-journal/day`, show 3 skeleton rows inside the modal body. Reuse the existing `skel` classes.

### Error state

If the journal day fetch fails, show an inline error inside the modal body:
- "Could not load meal details." + dismiss button
- Same pattern as `tr-history-expand-error`

## Standalone "+ Log food" button

Below the meal list on the Today tab, a primary button: **"+ Log food"**. This opens the same modal but without a pre-selected meal slot. Differences from the meal-row-tap flow:

- **Modal title**: "Log food" instead of a meal slot name
- **Meal slot select**: each added item gets a slot dropdown defaulting to a smart guess based on current time of day:
  - Before 10:00 → Breakfast
  - 10:00–11:30 → Mid morning
  - 11:30–14:00 → Lunch
  - 14:00–16:30 → Afternoon
  - 16:30–20:00 → Dinner
  - After 20:00 → Evening
- **No existing items shown** — the modal opens with just the search input and empty state message
- **After adding items**: they appear in the item list with the guessed slot. User can change the slot per item via the dropdown.
- **On close**: page refreshes, new items appear under their respective meal slot rows

This replaces the current "Log a meal via chat" link at the bottom of the Today tab.

## Page refresh after mutations

After any mutation (PATCH, DELETE, POST), the nutrition page's day data needs to refresh so the FuelGauge and meal row totals update. Two options:

**Recommendation:** After the modal closes (or after each mutation), call the existing `refreshDay()` function that re-fetches `GET /api/nutrition/day`. This is the simplest approach — the page already has this refresh mechanism.

## Files touched

| File | Change |
|---|---|
| `app/nutrition/nutrition-v2.js` | Group meals by slot, add click handler, modal component, food search, auto-save, delete |
| `shared/nutrition-v2.css` | New styles for clickable meal rows, modal, food item rows, summary bar, search, delete confirm |

## Not in scope

- Editing planned meals (only logged/consumed entries)
- Changing the food itself (swapping chicken for beef) — delete + add covers this
- Editing notes inline (the API supports it, but it's a low-priority field — keep it for a follow-up if users ask)

## Acceptance criteria

1. Tapping a logged meal row on the Today tab opens a modal showing all food items in that meal slot
2. Each food item shows name, meal slot dropdown, colored macro badges (P/C/F), editable amount input, per-item kcal, delete button
3. Changing amount and blurring auto-saves via PATCH, updates macros and meal total
4. Changing meal slot via dropdown PATCHes immediately; item disappears from current modal view
5. Delete shows inline confirmation, removes item on confirm
6. Inline food search at bottom lets you add new items to the meal
7. Added items default to `common_unit_grams` when available, otherwise `base_amount`
8. Meal total summary bar updates live after each mutation
9. "+ Log food" button opens the modal without a pre-selected slot, with time-of-day smart default
10. Page totals (FuelGauge, meal rows) refresh after modal closes
11. Empty state shows when all items are deleted
12. Works in both Paper and Mint themes
13. Planned meals remain non-tappable (no modal for planned rows)
