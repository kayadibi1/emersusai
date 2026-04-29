# UX Audit Fixes — Nutrition + Workout Pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all actionable UX issues from the Laws-of-UX / web.dev audit of the Nutrition and Train pages.

**Architecture:** Nine independent tasks across two live pages (`/app/nutrition/` and `/app/train/`). Each task is a standalone commit. All changes are CSS tweaks or small JS edits — no new files, no API changes, no DB migrations.

**Tech Stack:** React 18 (via esm.sh, no build step), vanilla CSS, `React.createElement` (no JSX).

**Scope note — already resolved / legacy:**
- `prefers-reduced-motion` is handled globally by `shared/design-tokens.css:192-199` (`!important` on all animations/transitions). No per-page work needed.
- `/app/workout/session/` is a legacy redirect to `/app/train/`. Session-view-only issues (swipe nav, progress stepper, auto-advance timing) are skipped — the code is unreachable.

---

### Task 1: Touch targets — nutrition.css

**Files:**
- Modify: `shared/nutrition.css`

Fitts's Law: multiple interactive elements are below the 44×44 px mobile minimum.

- [ ] **Step 1: Increase date arrow size from 32 → 44 px**

In `shared/nutrition.css`, replace the `.nu-date-arrow` rule:

```css
.nu-date-arrow {
  background: transparent; border: 1px solid var(--line);
  color: var(--muted); width: 44px; height: 44px;
  border-radius: 6px; cursor: pointer; font-size: 18px;
  display: inline-flex; align-items: center; justify-content: center;
}
```

- [ ] **Step 2: Add min-height to strip buttons**

In `shared/nutrition.css`, replace the `.nu-strip-btn` rule:

```css
.nu-strip-btn {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--muted);
  padding: 6px 12px;
  min-height: 44px;
  border-radius: 6px;
  font-family: inherit; font-size: 12px;
  cursor: pointer;
  transition: all .14s;
  display: inline-flex; align-items: center; justify-content: center;
}
```

- [ ] **Step 3: Increase supplement chip tap area**

In `shared/nutrition.css`, replace the `.nu-supp-chip` rule:

```css
.nu-supp-chip {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--muted);
  padding: 8px 12px;
  min-height: 44px;
  border-radius: 999px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all .12s;
  display: inline-flex; align-items: center;
}
```

- [ ] **Step 4: Increase food delete button tap area**

In `shared/nutrition.css`, replace the `.nu-food-delete` rule:

```css
.nu-food-delete {
  background: transparent; border: 0; color: var(--dim);
  font-size: 16px; cursor: pointer;
  min-height: 44px; min-width: 44px;
  border-radius: 4px; transition: color .14s, background .14s;
  flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
```

- [ ] **Step 5: Verify in browser**

Run: `node server.js` (or the existing dev process)
Open `/app/nutrition/` on a mobile viewport (375px).
Check: date arrows, water/supplement strip buttons, supplement chips, and food delete buttons are all comfortably tappable. No layout breakage.

- [ ] **Step 6: Commit**

```bash
git add shared/nutrition.css
git commit -m "fix(nutrition): increase touch targets to 44px minimum (Fitts's Law)"
```

---

### Task 2: Touch targets — train.css

**Files:**
- Modify: `shared/train.css`

Same principle as Task 1, applied to the Train page.

- [ ] **Step 1: Increase session menu button tap area**

In `shared/train.css`, replace the `.tr-session-menu-btn` rule:

```css
.tr-session-menu-btn {
  background: transparent; border: 1px solid var(--line);
  border-radius: 6px; padding: 8px 12px;
  min-height: 44px; min-width: 44px;
  font-size: 14px; cursor: pointer; color: var(--muted);
  display: inline-flex; align-items: center; justify-content: center;
}
```

- [ ] **Step 2: Increase rest timer adjustment buttons**

In `shared/train.css`, replace the `.tr-rest-btn` rule:

```css
.tr-rest-btn {
  background: transparent; border: 1px solid var(--line);
  color: var(--muted); padding: 8px 12px; border-radius: 4px;
  min-height: 44px; min-width: 44px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
```

- [ ] **Step 3: Increase sub-tab tap area**

In `shared/train.css`, replace the `.tr-subtab` rule:

```css
.tr-subtab {
  background: transparent;
  border: 1px solid transparent;
  padding: 10px 14px;
  min-height: 44px;
  border-radius: 6px;
  font-family: 'Space Grotesk', system-ui, sans-serif;
  font-size: 12.5px;
  color: var(--muted);
  cursor: pointer;
  font-weight: 500;
  transition: background .14s, color .14s;
  display: inline-flex; align-items: center;
}
```

- [ ] **Step 4: Verify in browser**

Open `/app/train/` on a mobile viewport (375px).
Check: session ⋯ menu button, rest timer −30s/+30s buttons, and Active/History sub-tabs are all comfortably tappable. Start a lift session to verify the rest timer buttons aren't cramped when the timer is visible.

- [ ] **Step 5: Commit**

```bash
git add shared/train.css
git commit -m "fix(train): increase touch targets to 44px minimum (Fitts's Law)"
```

---

### Task 3: Escape key dismiss — nutrition MealEditModal

**Files:**
- Modify: `app/nutrition/nutrition.js`

The modal closes on backdrop click but has no keyboard dismiss. WCAG requires Escape to close modals.

- [ ] **Step 1: Add Escape key handler to MealEditModal**

In `app/nutrition/nutrition.js`, inside the `MealEditModal` function, add this `useEffect` immediately after the existing `useEffect` block that runs on `[open, date, mealSlot, accessToken]` (after line 426):

```js
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);
```

- [ ] **Step 2: Verify in browser**

Open `/app/nutrition/`, click a meal row to open the modal, press Escape.
Expected: modal closes. Pressing Escape when modal is not open should do nothing.

- [ ] **Step 3: Commit**

```bash
git add app/nutrition/nutrition.js
git commit -m "fix(nutrition): dismiss meal modal on Escape key (a11y)"
```

---

### Task 4: Escape key dismiss — train modals

**Files:**
- Modify: `app/train/train.js`

Two modals need the same fix: `ExercisePickerModal` and `FinishSessionSheet`.

- [ ] **Step 1: Add Escape handler to ExercisePickerModal**

In `app/train/train.js`, inside `ExercisePickerModal`, add this `useEffect` immediately after the existing `useEffect` that fires on `[open]` (after line 119):

```js
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);
```

- [ ] **Step 2: Add Escape handler to FinishSessionSheet**

In `app/train/train.js`, inside `FinishSessionSheet`, add this `useEffect` immediately after the state declarations (`const [note, setNote] = ...`, `const [busy, setBusy] = ...`) around line 167:

```js
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (e) => { if (e.key === "Escape") onCancel?.(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);
```

- [ ] **Step 3: Verify in browser**

Open `/app/train/`, start a session, click "+ Add exercise" to open the picker, press Escape. Then click "Finish session" to open the sheet, press Escape. Both should dismiss on Escape.

- [ ] **Step 4: Commit**

```bash
git add app/train/train.js
git commit -m "fix(train): dismiss modals on Escape key (a11y)"
```

---

### Task 5: Fix popstate reload in train.js

**Files:**
- Modify: `app/train/train.js`

The global `popstate` handler does `window.location.reload()` — a full page reload on browser back/forward. This violates the Doherty Threshold (400ms response target) and destroys React state.

- [ ] **Step 1: Move popstate handler into TrainApp as a useEffect**

In `app/train/train.js`, inside the `TrainApp` function, add this `useEffect` after the existing `updateUrl` callback (after line 263):

```js
  useEffect(() => {
    const handlePop = () => {
      setState(parseTrainUrl(window.location.search));
      setExpandedSessionId(null);
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);
```

- [ ] **Step 2: Remove the global popstate handler**

Delete lines 656-660 at the bottom of `app/train/train.js`:

```js
window.addEventListener("popstate", () => {
  // Soft refresh on browser nav.
  // The component reads URL on mount; for popstate just reload to keep code simple.
  window.location.reload();
});
```

- [ ] **Step 3: Verify in browser**

Open `/app/train/`, switch between Lift/Cardio tabs, then use browser back/forward. The tab should switch without a full page reload — no white flash, no skeleton re-render, no network requests. The history list should re-fetch if the modality changed.

- [ ] **Step 4: Commit**

```bash
git add app/train/train.js
git commit -m "fix(train): handle popstate in React instead of full reload (Doherty)"
```

---

### Task 6: Fix history expand animation — train.css + train.js

**Files:**
- Modify: `shared/train.css`
- Modify: `app/train/train.js`

The expand animation uses `max-height: 0` → `max-height: 4000px`, which causes incorrect animation timing (short content expands too slowly, long content clips). Replace with the CSS `grid-template-rows: 0fr → 1fr` technique.

- [ ] **Step 1: Replace max-height with grid animation in CSS**

In `shared/train.css`, replace the two `.tr-history-body` rules (lines 348-349):

Old:
```css
.tr-history-body { max-height: 0; overflow: hidden; transition: max-height .3s ease; }
.tr-history-row.is-expanded .tr-history-body { max-height: 4000px; }
```

New:
```css
.tr-history-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows .3s ease;
}
.tr-history-row.is-expanded .tr-history-body {
  grid-template-rows: 1fr;
}
.tr-history-body-inner {
  overflow: hidden;
}
```

- [ ] **Step 2: Add inner wrapper div in train.js**

In `app/train/train.js`, find the `h("div", { className: "tr-history-body" },` render block inside the history list (around line 541). Wrap all its children in a new inner div:

Old (lines 541-611):
```js
h("div", { className: "tr-history-body" },
  isExpanded && expandLoading && !detail
    ? h(HistoryExpandSkeleton)
    : isExpanded && expandError && !detail
      ? h("div", { className: "tr-history-expand-error", role: "alert" },
          ...
        )
      : isExpanded && detail
        ? h("div", { className: "tr-history-exercises" },
            ...
          )
        : null,
),
```

New:
```js
h("div", { className: "tr-history-body" },
  h("div", { className: "tr-history-body-inner" },
    isExpanded && expandLoading && !detail
      ? h(HistoryExpandSkeleton)
      : isExpanded && expandError && !detail
        ? h("div", { className: "tr-history-expand-error", role: "alert" },
            expandError,
            h("button", { onClick: (e) => { e.stopPropagation(); setExpandError(""); } }, "\u2715"),
          )
        : isExpanded && detail
          ? h("div", { className: "tr-history-exercises" },
              groups.map((g, gi) => {
                const ex = exerciseLookup[g.exerciseId];
                const exName = ex?.name || "Unknown exercise";
                const topIdx = findTopSetIndex(g.sets);
                const topSet = topIdx >= 0 ? g.sets[topIdx] : null;
                const topLoad = topSet ? (weightUnit === "lbs" ? Math.round(fromKg(parseFloat(topSet.load_kg) || 0, "lbs")) : Math.round(parseFloat(topSet.load_kg) || 0)) : null;
                const topReps = topSet ? (parseInt(topSet.reps, 10) || 0) : 0;
                const topSummary = topLoad != null && topLoad > 0
                  ? `top: ${topLoad} ${volLabel} \u00d7 ${topReps}`
                  : topReps > 0 ? `top: ${topReps} reps` : "";

                return h(React.Fragment, { key: g.exerciseId },
                  gi > 0 ? h("hr", { className: "tr-history-ex-divider" }) : null,
                  h("div", null,
                    h("div", { className: "tr-history-ex-head" },
                      h("span", { className: "tr-history-ex-name" }, exName),
                      topSummary ? h("span", { className: "tr-history-ex-summary" }, topSummary) : null,
                    ),
                    g.sets.length === 0
                      ? h("div", { className: "tr-history-ex-empty" }, "No sets logged")
                      : h("div", { className: "tr-history-tiles" },
                          g.sets.map((set, si) => {
                            const loadKg = parseFloat(set.load_kg) || 0;
                            const displayLoad = loadKg > 0 ? (weightUnit === "lbs" ? Math.round(fromKg(loadKg, "lbs")) : Math.round(loadKg)) : null;
                            const reps = parseInt(set.reps, 10) || 0;
                            const rpe = set.rpe != null && set.rpe !== "" ? parseFloat(set.rpe) : null;
                            const level = rpeLevel(rpe);
                            const isTop = si === topIdx;

                            return h("div", {
                              key: set.id || si,
                              className: `tr-history-tile${isTop ? " is-top" : ""}`,
                              onClick: (e) => e.stopPropagation(),
                            },
                              h("span", { className: "tr-history-tile-num" }, si + 1),
                              displayLoad != null
                                ? h("div", { className: "tr-history-tile-load" }, displayLoad)
                                : (reps > 0 ? h("div", { className: "tr-history-tile-load" }, reps) : null),
                              displayLoad != null
                                ? h("div", { className: "tr-history-tile-unit" }, volLabel.toUpperCase())
                                : (reps > 0 ? h("div", { className: "tr-history-tile-unit" }, "REPS") : null),
                              h("div", { className: "tr-history-tile-bottom" },
                                displayLoad != null && reps > 0
                                  ? h("span", { className: "tr-history-tile-reps" }, `\u00d7 ${reps}`)
                                  : null,
                                rpe != null
                                  ? h("span", { className: `tr-history-tile-rpe tr-history-tile-rpe-${level}` }, `@${rpe}`)
                                  : null,
                              ),
                              h("div", { className: `tr-history-tile-stripe tr-history-tile-stripe-${level}` }),
                            );
                          }),
                        ),
                  ),
                );
              }),
              detail.note
                ? h("div", { className: "tr-history-note" }, `"${detail.note}"`)
                : null,
            )
          : null,
  ),
),
```

- [ ] **Step 3: Verify in browser**

Open `/app/train/`, go to History tab, click a session row to expand. The content should smoothly animate open proportional to its actual height. Click again to collapse — it should shrink smoothly, not snap.

- [ ] **Step 4: Commit**

```bash
git add shared/train.css app/train/train.js
git commit -m "fix(train): use grid-rows animation instead of max-height hack for history expand"
```

---

### Task 7: Group meal slot options — nutrition.js

**Files:**
- Modify: `app/nutrition/nutrition.js`

Hick's Law: the meal slot `<select>` in MealEditModal has 10 flat options, exceeding the 7±2 working memory threshold. Group them with `<optgroup>`.

- [ ] **Step 1: Add slot groups constant**

In `app/nutrition/nutrition.js`, after the `MEAL_SLOTS` definition (after line 36), add:

```js
const MEAL_SLOT_GROUPS = [
  { label: "Meals", slots: ["breakfast", "lunch", "dinner"] },
  { label: "Snacks", slots: ["mid_morning", "afternoon", "evening"] },
  { label: "Training", slots: ["pre_workout", "post_workout"] },
  { label: "Supplements", slots: ["supplements_am", "supplements_pm"] },
];
```

- [ ] **Step 2: Replace flat options with grouped options in the select**

In the MealEditModal render (around line 576-584), replace the `<select>` children:

Old:
```js
h("select", {
  className: "nu-food-slot-select",
  value: e.meal_slot,
  onChange: (ev) => handleSlotChange(e.id, ev.target.value),
  onClick: (ev) => ev.stopPropagation(),
},
  MEAL_SLOTS.map((s) =>
    h("option", { key: s, value: s }, MEAL_SLOT_LABELS[s]),
  ),
),
```

New:
```js
h("select", {
  className: "nu-food-slot-select",
  value: e.meal_slot,
  onChange: (ev) => handleSlotChange(e.id, ev.target.value),
  onClick: (ev) => ev.stopPropagation(),
},
  MEAL_SLOT_GROUPS.map((g) =>
    h("optgroup", { key: g.label, label: g.label },
      g.slots.map((s) =>
        h("option", { key: s, value: s }, MEAL_SLOT_LABELS[s]),
      ),
    ),
  ),
),
```

- [ ] **Step 3: Verify in browser**

Open `/app/nutrition/`, click a logged meal to open the modal, click the meal slot dropdown on any food item. The options should appear grouped under "Meals", "Snacks", "Training", "Supplements" headers. The selected value should still work correctly.

- [ ] **Step 4: Commit**

```bash
git add app/nutrition/nutrition.js
git commit -m "fix(nutrition): group meal slot options into categories (Hick's Law)"
```

---

### Task 8: Improve stub tab content — nutrition.js

**Files:**
- Modify: `app/nutrition/nutrition.js`

Plans and Log tabs show raw developer placeholders ("MEAL PLANS LIVE IN /CHAT", "PAGINATED RECENT-DAYS LIST SHIPS IN A FOLLOW-UP"). These create an unfinished impression (Tesler's Law) — replace with polished empty states that guide the user.

- [ ] **Step 1: Replace Plans tab content**

In `app/nutrition/nutrition.js`, replace the Plans tab render block (lines 746-749):

Old:
```js
tab === "plans" ? h("div", { className: "nu-tab-body" },
  h("p", { className: "nu-helper" }, "MEAL PLANS LIVE IN /CHAT \u2014 saved plans appear here automatically."),
  h("a", { className: "nu-primary", href: "/app/?prompt=Build me a meal plan for today" }, "Build a plan in chat \u2192"),
) : null,
```

New:
```js
tab === "plans" ? h("div", { className: "nu-tab-body" },
  h("div", { className: "nu-meals-empty" },
    h("p", { style: { fontWeight: 500, color: "var(--ink)", margin: "0 0 6px" } }, "Meal plans are built in chat"),
    h("p", { style: { margin: "0 0 14px" } }, "Ask Emersus to create a plan tailored to your goals \u2014 it\u2019ll save here automatically."),
    h("a", { className: "nu-primary", href: "/app/?prompt=Build me a meal plan for today" }, "Create a meal plan \u2192"),
  ),
) : null,
```

- [ ] **Step 2: Replace Log tab content**

In `app/nutrition/nutrition.js`, replace the Log tab render block (lines 751-753):

Old:
```js
tab === "log" ? h("div", { className: "nu-tab-body" },
  h("p", { className: "nu-helper" }, "PAGINATED RECENT-DAYS LIST SHIPS IN A FOLLOW-UP. For now, navigate via the date arrows above."),
) : null,
```

New:
```js
tab === "log" ? h("div", { className: "nu-tab-body" },
  h("div", { className: "nu-meals-empty" },
    h("p", { style: { fontWeight: 500, color: "var(--ink)", margin: "0 0 6px" } }, "Browse by date"),
    h("p", { style: { margin: 0 } }, "Switch to the Today tab and use the date arrows to view any day\u2019s meals and macros."),
  ),
) : null,
```

- [ ] **Step 3: Verify in browser**

Open `/app/nutrition/`, click "Plans" tab and "Log" tab. Both should show clean empty-state cards instead of raw uppercase developer text. The Plans tab CTA should link to chat.

- [ ] **Step 4: Commit**

```bash
git add app/nutrition/nutrition.js
git commit -m "fix(nutrition): replace stub tab placeholders with polished empty states"
```

---

### Task 9: Replace window.prompt with inline supplement form — nutrition.js + nutrition.css

**Files:**
- Modify: `app/nutrition/nutrition.js`
- Modify: `shared/nutrition.css`

Jakob's Law violation: the QuickLogDropdown uses `window.prompt()` for supplement entry — a jarring native dialog that breaks theming and loses muscle memory from the inline form pattern already used in WaterSupplementsStrip.

- [ ] **Step 1: Add supplement form state to QuickLogDropdown**

In `app/nutrition/nutrition.js`, inside the `QuickLogDropdown` function, add state after the existing `open` state (after line 345):

```js
  const [suppMode, setSuppMode] = useState(false);
  const [suppName, setSuppName] = useState("");
```

- [ ] **Step 2: Reset supplement state when dropdown closes**

After the existing `useEffect` that handles `mousedown` (after line 352), add:

```js
  useEffect(() => {
    if (!open) { setSuppMode(false); setSuppName(""); }
  }, [open]);
```

- [ ] **Step 3: Add submitSupp helper**

Before the `handlePick` function (before line 353), add:

```js
  const submitSupp = async (rawName) => {
    const name = (rawName || "").trim();
    if (!name) return;
    setOpen(false);
    try {
      await fetch("/api/nutrition/supplements", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ items: [{ name }] }),
      });
      onToast?.(`${name.toUpperCase()} LOGGED`);
    } catch (err) { console.error(err); }
    onLog?.();
  };
```

- [ ] **Step 4: Modify handlePick to open inline form instead of window.prompt**

Replace the `handlePick` function body. Find the existing function (around line 353-375):

Old:
```js
  const handlePick = async (id) => {
    setOpen(false);
    if (id === "water_250" || id === "water_500") {
      const ml = id === "water_250" ? 250 : 500;
      await fetch("/api/nutrition/water", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ ml }),
      });
      onToast?.(`WATER + ${ml} ML LOGGED`);
    } else if (id === "supplement") {
      const name = window.prompt("Supplement name:", "Creatine");
      if (name) {
        await fetch("/api/nutrition/supplements", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ items: [{ name }] }),
        });
        onToast?.(`${String(name).toUpperCase()} LOGGED`);
      }
    }
    onLog?.();
  };
```

New:
```js
  const handlePick = async (id) => {
    if (id === "supplement") {
      setSuppMode(true);
      setSuppName("");
      return;
    }
    setOpen(false);
    if (id === "water_250" || id === "water_500") {
      const ml = id === "water_250" ? 250 : 500;
      await fetch("/api/nutrition/water", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ ml }),
      });
      onToast?.(`WATER + ${ml} ML LOGGED`);
    }
    onLog?.();
  };
```

- [ ] **Step 5: Render inline supplement form inside the dropdown**

Replace the dropdown menu render (around line 380-388):

Old:
```js
    open ? h("ul", { className: "nu-quick-menu" },
      QUICK_LOG_ITEMS.map((it) => h("li", { key: it.id },
        h("button", { type: "button", onClick: () => handlePick(it.id) },
          h("span", null, it.label),
          h("span", { className: "nu-quick-hint" }, it.hint),
        ),
      )),
    ) : null,
```

New:
```js
    open ? h("ul", { className: `nu-quick-menu${suppMode ? " is-supp" : ""}` },
      suppMode
        ? h("li", { className: "nu-quick-supp-form" },
            h("form", {
              onSubmit: (e) => { e.preventDefault(); submitSupp(suppName); },
            },
              h("input", {
                className: "nu-supp-input",
                type: "text",
                value: suppName,
                onChange: (e) => setSuppName(e.target.value),
                placeholder: "Supplement name",
                autoFocus: true,
                maxLength: 80,
              }),
              h("div", { className: "nu-supp-presets" },
                SUPPLEMENT_PRESETS.map((name) =>
                  h("button", {
                    key: name,
                    type: "button",
                    className: "nu-supp-chip",
                    onClick: () => submitSupp(name),
                  }, name),
                ),
              ),
              h("div", { className: "nu-strip-actions", style: { marginTop: 4 } },
                h("button", { type: "submit", className: "nu-strip-btn nu-strip-btn-primary", disabled: !suppName.trim() }, "Log"),
                h("button", {
                  type: "button",
                  className: "nu-strip-btn",
                  onClick: () => setSuppMode(false),
                }, "Cancel"),
              ),
            ),
          )
        : QUICK_LOG_ITEMS.map((it) => h("li", { key: it.id },
            h("button", { type: "button", onClick: () => handlePick(it.id) },
              h("span", null, it.label),
              h("span", { className: "nu-quick-hint" }, it.hint),
            ),
          )),
    ) : null,
```

- [ ] **Step 6: Add CSS for expanded supplement form state**

In `shared/nutrition.css`, after the `.nu-quick-hint` rule (after line 428), add:

```css
.nu-quick-menu.is-supp {
  min-width: 280px;
  max-width: calc(100vw - 48px);
  padding: 12px;
}
.nu-quick-supp-form {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

- [ ] **Step 7: Verify in browser**

Open `/app/nutrition/`, click "+ Quick log ▾" in the bottom bar, then pick "Supplement". The dropdown should expand to show an inline form with a text input, six preset chips (Creatine, Whey, etc.), and Log/Cancel buttons. Tapping a preset chip should log it immediately and show a toast. Typing a name and pressing Log should log it. Cancel should return to the regular menu items. Clicking outside should close everything.

- [ ] **Step 8: Commit**

```bash
git add app/nutrition/nutrition.js shared/nutrition.css
git commit -m "fix(nutrition): replace window.prompt with inline supplement form in quick-log (Jakob's Law)"
```

---

## Summary

| Task | Page | Principle | Risk |
|---|---|---|---|
| 1 | Nutrition | Fitts's Law — touch targets | Low (CSS only) |
| 2 | Train | Fitts's Law — touch targets | Low (CSS only) |
| 3 | Nutrition | a11y — Escape key | Low (additive JS) |
| 4 | Train | a11y — Escape key | Low (additive JS) |
| 5 | Train | Doherty — popstate | Medium (behavior change) |
| 6 | Train | Animation — grid expand | Medium (CSS + JS structural) |
| 7 | Nutrition | Hick's Law — slot grouping | Low (additive JS) |
| 8 | Nutrition | Tesler's — stub tabs | Low (copy only) |
| 9 | Nutrition | Jakob's — inline supplement | Medium (JS refactor) |

All 9 tasks are independent — any ordering works. Suggested order above is smallest → largest for fast early commits.
