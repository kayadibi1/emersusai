# Meal Edit Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline meal-edit modal to `/app/nutrition/` so users can view, edit amounts, change meal slots, delete items, and add new foods — all without leaving the page or routing to chat.

**Architecture:** Pure frontend feature — no backend changes. The modal fetches `GET /api/emersus/meal-journal/day` for full entry details with food joins, uses `PATCH /entries/:id` for auto-save, `DELETE /entries/:id` for removal, and `POST /entries` for adding new items. Food search uses `GET /api/emersus/foods/search`.

**Tech Stack:** React 18 (h() calls, no JSX), esm.sh imports, CSS custom properties from design-tokens.css

**Spec:** `docs/superpowers/specs/2026-04-15-meal-edit-modal-design.md`
**Mockup:** `.superpowers/brainstorm/8524-1776305341/content/meal-edit-full.html`

---

### Task 1: Add meal-edit modal CSS to nutrition-v2.css

**Files:**
- Modify: `shared/nutrition-v2.css` (append after the existing meal-row styles, before `/* Quick-log */`)

- [ ] **Step 1: Add clickable meal row styles**

After the existing `.nu-meal-row` styles (around line 336), before `/* Quick-log */` or `.nu-meals-cta`, add:

```css
/* Clickable meal rows */
[data-nutrition-v2="1"] .nu-meal-row.is-clickable { cursor: pointer; transition: border-color .14s; }
[data-nutrition-v2="1"] .nu-meal-row.is-clickable:hover { border-color: var(--line-strong); }
[data-nutrition-v2="1"] .nu-meal-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px; letter-spacing: 0.12em; color: var(--dim);
  background: var(--surface-faint); border: 1px solid var(--line);
  padding: 2px 7px; border-radius: 4px; flex-shrink: 0;
}
[data-nutrition-v2="1"] .nu-meal-chevron { color: var(--dim); font-size: 14px; flex-shrink: 0; }
```

- [ ] **Step 2: Add the modal styles**

Append the full modal CSS block:

```css
/* ===== Meal edit modal ===== */
[data-nutrition-v2="1"] .nu-modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.40);
  display: flex; align-items: center; justify-content: center;
  padding: 24px; z-index: 100;
}
[data-nutrition-v2="1"] .nu-modal {
  background: var(--surface, var(--bg));
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.22);
  width: 100%; max-width: 480px;
  overflow: hidden; display: flex; flex-direction: column;
  max-height: 85vh;
}
[data-nutrition-v2="1"] .nu-modal-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px 12px; border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
[data-nutrition-v2="1"] .nu-modal-head h3 { margin: 0; font-size: 16px; font-weight: 600; }
[data-nutrition-v2="1"] .nu-modal-close {
  background: transparent; border: 0; color: var(--muted);
  font-size: 20px; cursor: pointer; padding: 0 4px;
}
[data-nutrition-v2="1"] .nu-modal-subtitle {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px; letter-spacing: 0.14em; color: var(--dim);
  text-transform: uppercase; margin-top: 2px;
}
[data-nutrition-v2="1"] .nu-modal-body { overflow-y: auto; flex: 1; min-height: 0; }

/* Food item rows */
[data-nutrition-v2="1"] .nu-food-list { list-style: none; padding: 0; margin: 0; }
[data-nutrition-v2="1"] .nu-food-item {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 20px; border-bottom: 1px solid var(--line);
  transition: opacity .14s;
}
[data-nutrition-v2="1"] .nu-food-item:last-child { border-bottom: 0; }
[data-nutrition-v2="1"] .nu-food-item.is-deleting { opacity: 0.4; }
[data-nutrition-v2="1"] .nu-food-info { flex: 1; min-width: 0; }
[data-nutrition-v2="1"] .nu-food-name { font-size: 14px; font-weight: 500; color: var(--ink); }
[data-nutrition-v2="1"] .nu-food-meta-row {
  display: flex; align-items: center; gap: 6px; margin-top: 2px; flex-wrap: wrap;
}
[data-nutrition-v2="1"] .nu-food-slot-select {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px; letter-spacing: 0.10em; color: var(--dim);
  background: transparent; border: 1px solid var(--line); border-radius: 4px;
  padding: 1px 4px; cursor: pointer; outline: 0;
  -webkit-appearance: none; appearance: none;
}
[data-nutrition-v2="1"] .nu-food-slot-select:focus { border-color: var(--accent); }
[data-nutrition-v2="1"] .nu-food-macros {
  display: flex; gap: 8px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px; letter-spacing: 0.10em;
}
[data-nutrition-v2="1"] .nu-food-macro-p { color: var(--protein); }
[data-nutrition-v2="1"] .nu-food-macro-c { color: var(--carbs); }
[data-nutrition-v2="1"] .nu-food-macro-f { color: var(--fat); }
[data-nutrition-v2="1"] .nu-food-amount-wrap {
  display: flex; align-items: center; gap: 5px; flex-shrink: 0;
}
[data-nutrition-v2="1"] .nu-food-amount-input {
  width: 60px; text-align: right;
  background: var(--bg); border: 1px solid var(--line); border-radius: 6px;
  padding: 5px 8px; font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px; color: var(--ink); outline: 0;
  font-variant-numeric: tabular-nums;
}
[data-nutrition-v2="1"] .nu-food-amount-input:focus { border-color: var(--accent); }
[data-nutrition-v2="1"] .nu-food-amount-unit {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; color: var(--dim); letter-spacing: 0.10em;
}
[data-nutrition-v2="1"] .nu-food-kcal {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: var(--muted); font-weight: 500;
  width: 48px; text-align: right; flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
[data-nutrition-v2="1"] .nu-food-delete {
  background: transparent; border: 0; color: var(--dim);
  font-size: 16px; cursor: pointer; padding: 4px;
  border-radius: 4px; transition: color .14s, background .14s;
  flex-shrink: 0;
}
[data-nutrition-v2="1"] .nu-food-delete:hover { color: var(--danger, #ef4444); background: rgba(239,68,68,0.08); }

/* Meal total summary */
[data-nutrition-v2="1"] .nu-meal-summary {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 20px; background: var(--surface-faint);
  border-top: 1px solid var(--line); flex-shrink: 0;
}
[data-nutrition-v2="1"] .nu-meal-summary-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px; letter-spacing: 0.14em; color: var(--dim); text-transform: uppercase;
}
[data-nutrition-v2="1"] .nu-meal-summary-value {
  font-size: 16px; font-weight: 600; color: var(--ink);
  font-variant-numeric: tabular-nums;
}
[data-nutrition-v2="1"] .nu-meal-summary-macros {
  display: flex; gap: 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; letter-spacing: 0.10em;
}

/* Delete confirmation bar */
[data-nutrition-v2="1"] .nu-delete-confirm {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 20px; background: rgba(239,68,68,0.08);
  border-top: 1px solid var(--line); font-size: 13px; flex-shrink: 0;
}
[data-nutrition-v2="1"] .nu-delete-confirm span { flex: 1; color: var(--danger, #ef4444); }
[data-nutrition-v2="1"] .nu-delete-confirm-yes {
  background: var(--danger, #ef4444); color: #fff; border: 0;
  padding: 5px 12px; border-radius: 6px; font-family: inherit;
  font-size: 12px; cursor: pointer; font-weight: 600;
}
[data-nutrition-v2="1"] .nu-delete-confirm-no {
  background: transparent; border: 1px solid var(--line);
  color: var(--muted); padding: 5px 12px; border-radius: 6px;
  font-family: inherit; font-size: 12px; cursor: pointer;
}

/* Add food search */
[data-nutrition-v2="1"] .nu-add-food-row {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 20px; border-top: 1px solid var(--line); flex-shrink: 0;
}
[data-nutrition-v2="1"] .nu-add-food-input {
  flex: 1; background: var(--bg); border: 1px solid var(--line);
  border-radius: 6px; padding: 7px 10px; font-family: inherit;
  font-size: 13px; color: var(--ink); outline: 0;
}
[data-nutrition-v2="1"] .nu-add-food-input:focus { border-color: var(--accent); }
[data-nutrition-v2="1"] .nu-add-food-input::placeholder { color: var(--dim); }
[data-nutrition-v2="1"] .nu-search-results {
  list-style: none; padding: 0; margin: 0; max-height: 200px; overflow-y: auto;
}
[data-nutrition-v2="1"] .nu-search-result {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 20px; cursor: pointer; transition: background .14s;
  border-top: 1px solid var(--line);
}
[data-nutrition-v2="1"] .nu-search-result:hover { background: var(--accent-soft); }
[data-nutrition-v2="1"] .nu-search-result-name { font-size: 13px; color: var(--ink); }
[data-nutrition-v2="1"] .nu-search-result-meta {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px; color: var(--dim); letter-spacing: 0.10em; flex-shrink: 0;
}

/* Modal empty + error */
[data-nutrition-v2="1"] .nu-modal-empty {
  padding: 32px 20px; text-align: center; color: var(--dim); font-size: 13px;
}
[data-nutrition-v2="1"] .nu-modal-error {
  padding: 12px 16px; color: var(--danger, #ef4444); font-size: 13px;
  display: flex; align-items: center; gap: 10px;
}
[data-nutrition-v2="1"] .nu-modal-error button {
  background: transparent; border: 0; color: inherit; cursor: pointer; font-size: 16px;
}

/* Log food button */
[data-nutrition-v2="1"] .nu-log-food-btn {
  display: block; width: 100%; text-align: center;
  background: var(--accent); color: var(--accent-text); border: 0;
  padding: 10px 16px; border-radius: 8px;
  font-family: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer; margin-top: 8px;
  transition: filter .14s;
}
[data-nutrition-v2="1"] .nu-log-food-btn:hover { filter: brightness(1.08); }
```

- [ ] **Step 3: Commit**

```bash
git add shared/nutrition-v2.css
git commit -m "feat(nutrition): add meal-edit modal CSS"
```

---

### Task 2: Add MealEditModal component to nutrition-v2.js

**Files:**
- Modify: `app/nutrition/nutrition-v2.js`

This is the main task — add the modal component with all its subcomponents, state, and API interactions. It goes in the same file since the app follows the single-file SPA pattern.

- [ ] **Step 1: Add constants and helpers**

After the existing `QUICK_LOG_ITEMS` constant (line 27), add:

```js
const MEAL_SLOT_LABELS = {
  breakfast: "Breakfast", mid_morning: "Mid morning", lunch: "Lunch",
  afternoon: "Afternoon", dinner: "Dinner", evening: "Evening",
  pre_workout: "Pre-workout", post_workout: "Post-workout",
  supplements_am: "Supplements AM", supplements_pm: "Supplements PM",
};
const MEAL_SLOTS = Object.keys(MEAL_SLOT_LABELS);

function guessMealSlot() {
  const hour = new Date().getHours();
  const min = new Date().getMinutes();
  const t = hour + min / 60;
  if (t < 10) return "breakfast";
  if (t < 11.5) return "mid_morning";
  if (t < 14) return "lunch";
  if (t < 16.5) return "afternoon";
  if (t < 20) return "dinner";
  return "evening";
}

function smartDefaultAmount(food) {
  if (food.common_unit && food.common_unit_grams) return food.common_unit_grams;
  return food.base_amount || (food.base_unit === "serving" ? 1 : 100);
}

function smartDefaultUnit(food) {
  return food.base_unit === "serving" ? "serving" : "g";
}
```

- [ ] **Step 2: Add the MealEditModal component**

Before the `NutritionApp` function (around line 316), add the full `MealEditModal` component:

```js
function MealEditModal({ open, mealSlot, date, accessToken, onClose, onMutate }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const saveTimerRef = React.useRef({});

  const title = mealSlot ? (MEAL_SLOT_LABELS[mealSlot] || mealSlot) : "Log food";

  // Fetch journal entries when modal opens
  useEffect(() => {
    if (!open || !accessToken) return;
    setError(""); setSearchQuery(""); setSearchResults([]);
    setDeleteTarget(null);
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/emersus/meal-journal/day?date=${date}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error("fetch_failed");
        const body = await res.json();
        const all = body.entries || [];
        if (mealSlot) {
          setEntries(all.filter((e) => e.meal_slot === mealSlot));
        } else {
          setEntries([]);
        }
      } catch (err) {
        setError(err.message || "Could not load meal details.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, date, mealSlot, accessToken]);

  // Food search debounce
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(
          `/api/emersus/foods/search?q=${encodeURIComponent(searchQuery)}&kind=food&limit=8`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const body = await res.json();
        setSearchResults(body.results || []);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, accessToken]);

  const patchEntry = useCallback(async (entryId, patch) => {
    try {
      const res = await fetch(`/api/emersus/meal-journal/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("update_failed");
      const body = await res.json();
      if (patch.meal_slot && patch.meal_slot !== mealSlot && mealSlot) {
        setEntries((prev) => prev.filter((e) => e.id !== entryId));
      } else if (body.entry) {
        setEntries((prev) => prev.map((e) => e.id === entryId ? { ...e, ...body.entry } : e));
      }
      onMutate?.();
    } catch (err) {
      setError("Save failed. Try again.");
    }
  }, [accessToken, mealSlot, onMutate]);

  const handleAmountBlur = useCallback((entryId, newAmount) => {
    const num = parseFloat(newAmount);
    if (isNaN(num) || num <= 0) return;
    patchEntry(entryId, { amount: num });
  }, [patchEntry]);

  const handleSlotChange = useCallback((entryId, newSlot) => {
    patchEntry(entryId, { meal_slot: newSlot });
  }, [patchEntry]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/emersus/meal-journal/entries/${deleteTarget}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error("delete_failed");
      setEntries((prev) => prev.filter((e) => e.id !== deleteTarget));
      setDeleteTarget(null);
      onMutate?.();
    } catch {
      setError("Delete failed.");
      setDeleteTarget(null);
    }
  }, [deleteTarget, accessToken, onMutate]);

  const addFood = useCallback(async (food) => {
    const slot = mealSlot || guessMealSlot();
    const amount = smartDefaultAmount(food);
    const amountUnit = smartDefaultUnit(food);
    try {
      const res = await fetch("/api/emersus/meal-journal/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          entries: [{
            food_id: food.id,
            logged_date: date,
            meal_slot: slot,
            amount,
            amount_unit: amountUnit,
            source: "manual_search",
          }],
        }),
      });
      if (!res.ok) throw new Error("add_failed");
      const body = await res.json();
      const added = (body.entries || [])[0];
      if (added) {
        setEntries((prev) => [...prev, { ...added, food }]);
      }
      setSearchQuery("");
      setSearchResults([]);
      onMutate?.();
    } catch {
      setError("Could not add food.");
    }
  }, [accessToken, date, mealSlot, onMutate]);

  if (!open) return null;

  const totalKcal = entries.reduce((s, e) => s + (Number(e.kcal_snapshot) || 0), 0);
  const totalP = entries.reduce((s, e) => s + (Number(e.protein_g_snapshot) || 0), 0);
  const totalC = entries.reduce((s, e) => s + (Number(e.carbs_g_snapshot) || 0), 0);
  const totalF = entries.reduce((s, e) => s + (Number(e.fat_g_snapshot) || 0), 0);
  const dateDisplay = new Date(date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return h("div", { className: "nu-modal-backdrop", onClick: onClose },
    h("div", { className: "nu-modal", onClick: (e) => e.stopPropagation() },

      // Header
      h("div", { className: "nu-modal-head" },
        h("div", null,
          h("h3", null, title),
          h("div", { className: "nu-modal-subtitle" },
            `${dateDisplay} · ${entries.length} item${entries.length !== 1 ? "s" : ""} logged`,
          ),
        ),
        h("button", { className: "nu-modal-close", onClick: onClose, "aria-label": "Close" }, "\u00d7"),
      ),

      // Body
      h("div", { className: "nu-modal-body" },
        loading
          ? h("div", { className: "nu-modal-empty" }, "Loading...")
          : error && !entries.length
            ? h("div", { className: "nu-modal-error" },
                error,
                h("button", { onClick: () => setError("") }, "\u2715"),
              )
            : entries.length
              ? h("ul", { className: "nu-food-list" },
                  entries.map((e) => {
                    const foodName = e.food?.description || "Unknown food";
                    const kcal = Math.round(Number(e.kcal_snapshot) || 0);
                    const prot = Math.round(Number(e.protein_g_snapshot) || 0);
                    const carb = Math.round(Number(e.carbs_g_snapshot) || 0);
                    const fat = Math.round(Number(e.fat_g_snapshot) || 0);
                    const unit = e.amount_unit === "serving" ? "srv" : "g";
                    const isDeleting = deleteTarget === e.id;

                    return h("li", {
                      key: e.id,
                      className: `nu-food-item${isDeleting ? " is-deleting" : ""}`,
                    },
                      h("div", { className: "nu-food-info" },
                        h("div", { className: "nu-food-name" }, foodName),
                        h("div", { className: "nu-food-meta-row" },
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
                          h("div", { className: "nu-food-macros" },
                            h("span", { className: "nu-food-macro-p" }, `${prot}g P`),
                            h("span", { className: "nu-food-macro-c" }, `${carb}g C`),
                            h("span", { className: "nu-food-macro-f" }, `${fat}g F`),
                          ),
                        ),
                      ),
                      h("div", { className: "nu-food-amount-wrap" },
                        h("input", {
                          className: "nu-food-amount-input",
                          type: "number",
                          defaultValue: Math.round(Number(e.amount) || 0),
                          step: unit === "srv" ? 0.5 : 10,
                          min: 0,
                          onBlur: (ev) => handleAmountBlur(e.id, ev.target.value),
                          onKeyDown: (ev) => { if (ev.key === "Enter") ev.target.blur(); },
                        }),
                        h("span", { className: "nu-food-amount-unit" }, unit),
                      ),
                      h("span", { className: "nu-food-kcal" }, kcal),
                      h("button", {
                        className: "nu-food-delete",
                        onClick: () => setDeleteTarget(e.id),
                        title: "Delete",
                      }, "\u00d7"),
                    );
                  }),
                )
              : h("div", { className: "nu-modal-empty" }, "No items logged yet."),
      ),

      // Delete confirmation bar
      deleteTarget ? h("div", { className: "nu-delete-confirm" },
        h("span", null, `Remove "${(entries.find((e) => e.id === deleteTarget)?.food?.description) || "item"}"?`),
        h("button", { className: "nu-delete-confirm-yes", onClick: confirmDelete }, "Remove"),
        h("button", { className: "nu-delete-confirm-no", onClick: () => setDeleteTarget(null) }, "Cancel"),
      ) : null,

      // Meal total summary
      entries.length > 0 ? h("div", { className: "nu-meal-summary" },
        h("div", null,
          h("div", { className: "nu-meal-summary-label" }, "MEAL TOTAL"),
          h("div", { className: "nu-meal-summary-value" }, `${Math.round(totalKcal)} kcal`),
        ),
        h("div", { className: "nu-meal-summary-macros" },
          h("span", { className: "nu-food-macro-p" }, `${Math.round(totalP)}g P`),
          h("span", { className: "nu-food-macro-c" }, `${Math.round(totalC)}g C`),
          h("span", { className: "nu-food-macro-f" }, `${Math.round(totalF)}g F`),
        ),
      ) : null,

      // Add food search
      h("div", { className: "nu-add-food-row" },
        h("input", {
          className: "nu-add-food-input",
          type: "search",
          placeholder: "Search to add a food...",
          value: searchQuery,
          onChange: (e) => setSearchQuery(e.target.value),
        }),
      ),
      searchResults.length > 0 ? h("ul", { className: "nu-search-results" },
        searchResults.map((f) => h("li", {
          key: f.id,
          className: "nu-search-result",
          onClick: () => addFood(f),
        },
          h("span", { className: "nu-search-result-name" }, f.description),
          h("span", { className: "nu-search-result-meta" },
            f.brand_name ? `${f.brand_name}` : (f.source || "").replace(/_/g, " "),
          ),
        )),
      ) : null,
    ),
  );
}
```

- [ ] **Step 3: Rewrite MealsList to group by slot and add click handler**

Replace the existing `MealsList` function (lines 237-262) with:

```js
function MealsList({ data, onOpenSlot }) {
  const meals = data?.meals || [];
  if (!meals.length) {
    return h("div", { className: "nu-meals-empty" },
      h("p", null, "No meals logged or planned for this day."),
      h("a", { className: "nu-meals-cta", href: "/app/?prompt=Build me a meal plan" }, "Ask Emersus to plan a day \u2192"),
    );
  }

  // Group consumed meals by slot; keep planned meals individual
  const consumed = meals.filter((m) => m.eaten_at);
  const planned = meals.filter((m) => !m.eaten_at);
  const groups = new Map();
  for (const m of consumed) {
    const slot = m.type || "other";
    if (!groups.has(slot)) groups.set(slot, []);
    groups.get(slot).push(m);
  }

  const groupedRows = [...groups.entries()].map(([slot, items]) => {
    const totalKcal = items.reduce((s, m) => s + (m.kcal || 0), 0);
    const totalP = items.reduce((s, m) => s + (m.protein_g || 0), 0);
    const totalC = items.reduce((s, m) => s + (m.carbs_g || 0), 0);
    const totalF = items.reduce((s, m) => s + (m.fat_g || 0), 0);
    const earliest = items.reduce((t, m) => {
      const mt = (m.eaten_at || "").slice(11, 16);
      return !t || mt < t ? mt : t;
    }, "");
    return { slot, items, totalKcal, totalP, totalC, totalF, time: earliest || "\u2014" };
  }).sort((a, b) => a.time.localeCompare(b.time));

  return h("div", { className: "nu-meals-list" },
    groupedRows.map((g) => h("article", {
      key: g.slot,
      className: "nu-meal-row is-clickable",
      onClick: () => onOpenSlot?.(g.slot),
    },
      h("div", { className: "nu-meal-time" }, g.time),
      h("div", { className: "nu-meal-body" },
        h("div", { className: "nu-meal-head" },
          h("span", { className: "nu-meal-name" }, MEAL_SLOT_LABELS[g.slot] || g.slot),
          h("span", { className: "nu-meal-pill" }, "LOGGED"),
        ),
        h("div", { className: "nu-meal-macros" },
          `${g.totalKcal} kcal \u00b7 ${g.totalP}g P \u00b7 ${g.totalC}g C \u00b7 ${g.totalF}g F`,
        ),
      ),
      h("span", { className: "nu-meal-count" }, `${g.items.length} item${g.items.length !== 1 ? "s" : ""}`),
      h("span", { className: "nu-meal-chevron" }, ">"),
    )),
    planned.map((m) => h("article", {
      key: m.id,
      className: "nu-meal-row is-planned",
    },
      h("div", { className: "nu-meal-time" }, (m.planned_at || "").slice(11, 16) || "\u2014"),
      h("div", { className: "nu-meal-body" },
        h("div", { className: "nu-meal-head" },
          h("span", { className: "nu-meal-name" }, m.name || m.type),
          h("span", { className: "nu-meal-pill" }, "PLANNED"),
        ),
        h("div", { className: "nu-meal-macros" },
          `${m.kcal} kcal \u00b7 ${m.protein_g}g P \u00b7 ${m.carbs_g}g C \u00b7 ${m.fat_g}g F`,
        ),
      ),
    )),
  );
}
```

- [ ] **Step 4: Wire modal state + "+ Log food" button into NutritionApp**

Inside the `NutritionApp` function, after `const day = useNutritionDay(accessToken);` (line 327), add:

```js
  const [modalSlot, setModalSlot] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const openMealModal = useCallback((slot) => {
    setModalSlot(slot);
    setModalOpen(true);
  }, []);

  const openLogFood = useCallback(() => {
    setModalSlot(null);
    setModalOpen(true);
  }, []);

  const closeMealModal = useCallback(() => {
    setModalOpen(false);
    setModalSlot(null);
    day.reload();
  }, [day]);
```

- [ ] **Step 5: Update the render to pass onOpenSlot and add the modal + button**

In the render, update the `MealsList` usage to pass `onOpenSlot`:

Change:
```js
              h(MealsList, { data: day.data }),
```
To:
```js
              h(MealsList, { data: day.data, onOpenSlot: openMealModal }),
```

Replace the "Log a meal via chat" link:
```js
              h("a", {
                className: "nu-meals-cta nu-meals-cta-bottom",
                href: "/app/?prompt=Log a meal",
              }, "+ Log a meal via chat"),
```
With:
```js
              h("button", {
                type: "button",
                className: "nu-log-food-btn",
                onClick: openLogFood,
              }, "+ Log food"),
```

And at the very end of the `NutritionApp` return, just before the closing `)` of the outermost `h("div"`, add the modal:

```js
    h(MealEditModal, {
      open: modalOpen,
      mealSlot: modalSlot,
      date: day.date,
      accessToken,
      onClose: closeMealModal,
      onMutate: day.reload,
    }),
```

- [ ] **Step 6: Verify JavaScript syntax**

Run: `node --check app/nutrition/nutrition-v2.js`

- [ ] **Step 7: Commit**

```bash
git add app/nutrition/nutrition-v2.js
git commit -m "feat(nutrition): add meal-edit modal with inline CRUD and food search"
```

---

### Task 3: Update checkpoint and changelog

**Files:**
- Modify: `checkpoint.md`
- Modify: `changelog.md`

- [ ] **Step 1: Update checkpoint.md**

Find:
```
4. ⬜ **Phase 4 — Real meal-edit modal** — currently routes to chat; needs inline modal.
```
Replace with:
```
4. ✅ **Phase 4 — Real meal-edit modal** — shipped 2026-04-15. Inline CRUD modal with food search, auto-save, delete, meal slot reassignment.
```

- [ ] **Step 2: Update changelog.md**

Add at the top:
```
2026-04-15 — Meal-edit modal on /app/nutrition/ — tap a meal row to view/edit/delete items, add foods via search, auto-save amounts, change meal slots, standalone Log food button — app/nutrition/nutrition-v2.js, shared/nutrition-v2.css
```

- [ ] **Step 3: Commit**

```bash
git add checkpoint.md changelog.md
git commit -m "docs: mark meal-edit modal shipped, add changelog entry"
```
