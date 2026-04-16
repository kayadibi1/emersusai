# History Inline-Expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline expand/collapse to the History tab on `/app/train/` so users can see all exercises and sets from a past session without navigating away.

**Architecture:** Pure frontend feature — no backend changes. Clicking a session row fetches `GET /api/workout-sessions/:id` (already returns joined sets), groups sets by exercise, resolves exercise names via the existing lookup, and renders grid tiles with load as the hero number and RPE color coding. One session open at a time (accordion).

**Tech Stack:** React 18 (h() calls, no JSX), esm.sh imports, CSS custom properties from design-tokens.css

**Spec:** `docs/superpowers/specs/2026-04-15-history-inline-expand-design.md`
**Mockup:** `.superpowers/brainstorm/8524-1776305341/content/full-design-v2.html`

---

### Task 1: Add RPE color tokens to design-tokens.css

**Files:**
- Modify: `shared/design-tokens.css:16-47` (mint palette block)
- Modify: `shared/design-tokens.css:50-81` (paper palette block)

- [ ] **Step 1: Add RPE tokens to the mint (dark) palette**

In `shared/design-tokens.css`, inside the `:root[data-theme="mint"]` block, add these lines after the `--fat` token (before the `--frame-from` line):

```css
  --rpe-low: #34d399;
  --rpe-med: #fbbf24;
  --rpe-high: #f87171;
  --rpe-low-bg: rgba(52,211,153,0.08);
  --rpe-med-bg: rgba(251,191,36,0.08);
  --rpe-high-bg: rgba(248,113,113,0.08);
```

- [ ] **Step 2: Add RPE tokens to the paper (light) palette**

In the same file, inside the `:root[data-theme="paper"]` block, add these lines after the `--fat` token (before `--frame-from`):

```css
  --rpe-low: #22c55e;
  --rpe-med: #f59e0b;
  --rpe-high: #ef4444;
  --rpe-low-bg: rgba(34,197,94,0.08);
  --rpe-med-bg: rgba(245,158,11,0.08);
  --rpe-high-bg: rgba(239,68,68,0.08);
```

- [ ] **Step 3: Verify tokens load**

Open `http://127.0.0.1:3001/app/train/` in both themes. Open DevTools → Computed Styles on `<html>` and confirm `--rpe-low`, `--rpe-med`, `--rpe-high` resolve to the expected hex values.

- [ ] **Step 4: Commit**

```bash
git add shared/design-tokens.css
git commit -m "feat(train): add RPE color tokens to both palettes"
```

---

### Task 2: Add history expand CSS to train-v2.css

**Files:**
- Modify: `shared/train-v2.css` (append after the existing `/* ===== History ===== */` section, line ~317)

- [ ] **Step 1: Replace the existing history CSS block**

The existing history CSS (lines 304–317 of `train-v2.css`) is:

```css
/* ===== History ===== */
[data-train-v2="1"] .tr-history-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
[data-train-v2="1"] .tr-history-row {
  background: var(--surface-faint);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 14px;
}
[data-train-v2="1"] .tr-history-title { font-size: 14px; color: var(--ink); }
[data-train-v2="1"] .tr-history-meta {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; letter-spacing: 0.14em; color: var(--dim);
  margin-top: 2px;
}
```

Replace it with the full expanded history styles:

```css
/* ===== History ===== */
[data-train-v2="1"] .tr-history-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
[data-train-v2="1"] .tr-history-row {
  background: var(--surface-faint);
  border: 1px solid var(--line);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color .18s;
  overflow: hidden;
}
[data-train-v2="1"] .tr-history-row:hover { border-color: var(--line-strong); }
[data-train-v2="1"] .tr-history-row.is-expanded { border-color: var(--accent-line); cursor: default; }

[data-train-v2="1"] .tr-history-header { display: flex; align-items: center; padding: 12px 16px; gap: 12px; }
[data-train-v2="1"] .tr-history-left { flex: 1; min-width: 0; }
[data-train-v2="1"] .tr-history-title { font-size: 15px; font-weight: 500; color: var(--ink); }
[data-train-v2="1"] .tr-history-meta-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
[data-train-v2="1"] .tr-history-date {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; letter-spacing: 0.12em; color: var(--dim);
}
[data-train-v2="1"] .tr-history-dot { color: var(--dim); font-size: 10px; }
[data-train-v2="1"] .tr-history-chip {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px; letter-spacing: 0.12em;
  padding: 2px 7px; border-radius: 4px;
  background: var(--surface-faint); border: 1px solid var(--line); color: var(--muted);
}
[data-train-v2="1"] .tr-history-chip-vol {
  color: var(--accent); border-color: var(--accent-line);
  background: var(--accent-soft); font-weight: 600;
}
[data-train-v2="1"] .tr-history-chevron {
  color: var(--dim); font-size: 16px; flex-shrink: 0;
  transition: transform .2s ease;
}
[data-train-v2="1"] .tr-history-row.is-expanded .tr-history-chevron { transform: rotate(90deg); }

/* History expanded body */
[data-train-v2="1"] .tr-history-body { max-height: 0; overflow: hidden; transition: max-height .3s ease; }
[data-train-v2="1"] .tr-history-row.is-expanded .tr-history-body { max-height: 4000px; }

/* Exercise blocks inside expanded */
[data-train-v2="1"] .tr-history-exercises { display: flex; flex-direction: column; gap: 10px; padding: 4px 12px 12px; }
[data-train-v2="1"] .tr-history-ex-head {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 6px; padding: 0 2px;
}
[data-train-v2="1"] .tr-history-ex-name { font-size: 13.5px; font-weight: 500; color: var(--ink); }
[data-train-v2="1"] .tr-history-ex-summary {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; letter-spacing: 0.10em; color: var(--muted); flex-shrink: 0;
}
[data-train-v2="1"] .tr-history-ex-divider { border: none; border-top: 1px solid var(--line); margin: 0; }
[data-train-v2="1"] .tr-history-ex-empty { font-size: 12px; color: var(--dim); padding: 4px 2px; }

/* Set tiles grid */
[data-train-v2="1"] .tr-history-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 4px; }
[data-train-v2="1"] .tr-history-tile {
  background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
  padding: 8px 10px; text-align: center;
  position: relative; overflow: hidden;
}
[data-train-v2="1"] .tr-history-tile.is-top { border-color: var(--accent-line); background: var(--accent-soft); }
[data-train-v2="1"] .tr-history-tile-num {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px; letter-spacing: 0.14em; color: var(--dim);
  position: absolute; top: 4px; left: 6px;
}
[data-train-v2="1"] .tr-history-tile-load {
  font-size: 20px; font-weight: 700; color: var(--ink);
  font-variant-numeric: tabular-nums; line-height: 1.1; margin-top: 2px;
}
[data-train-v2="1"] .tr-history-tile.is-top .tr-history-tile-load { color: var(--accent); }
[data-train-v2="1"] .tr-history-tile-unit {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8px; letter-spacing: 0.12em; color: var(--dim);
}
[data-train-v2="1"] .tr-history-tile-bottom {
  display: flex; justify-content: center; align-items: baseline; gap: 6px; margin-top: 4px;
}
[data-train-v2="1"] .tr-history-tile-reps { font-size: 12px; font-weight: 500; color: var(--muted); }
[data-train-v2="1"] .tr-history-tile-rpe {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px; letter-spacing: 0.10em;
}
[data-train-v2="1"] .tr-history-tile-rpe-low  { color: var(--rpe-low); }
[data-train-v2="1"] .tr-history-tile-rpe-med  { color: var(--rpe-med); }
[data-train-v2="1"] .tr-history-tile-rpe-high { color: var(--rpe-high); }
[data-train-v2="1"] .tr-history-tile-rpe-none { color: var(--dim); }
[data-train-v2="1"] .tr-history-tile-stripe {
  position: absolute; bottom: 0; left: 0; right: 0; height: 3px;
}
[data-train-v2="1"] .tr-history-tile-stripe-low  { background: var(--rpe-low); }
[data-train-v2="1"] .tr-history-tile-stripe-med  { background: var(--rpe-med); }
[data-train-v2="1"] .tr-history-tile-stripe-high { background: var(--rpe-high); }
[data-train-v2="1"] .tr-history-tile-stripe-none { background: var(--line); }

/* Session note */
[data-train-v2="1"] .tr-history-note {
  margin: 4px 2px 0;
  padding: 8px 11px;
  border-left: 2px solid var(--accent-line);
  font-size: 12.5px; color: var(--muted);
  font-style: italic; line-height: 1.4;
}

/* History expand loading skeleton */
[data-train-v2="1"] .tr-history-expand-skel { padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
[data-train-v2="1"] .tr-history-expand-skel-block { display: flex; flex-direction: column; gap: 6px; }

/* History expand error */
[data-train-v2="1"] .tr-history-expand-error {
  padding: 12px 16px; color: var(--danger, #ef4444); font-size: 13px;
  display: flex; align-items: center; gap: 10px;
}
[data-train-v2="1"] .tr-history-expand-error button {
  background: transparent; border: 0; color: inherit; cursor: pointer; font-size: 16px;
}
```

- [ ] **Step 2: Verify CSS loads without errors**

Open `http://127.0.0.1:3001/app/train/` and check DevTools console for CSS parse errors. The history tab should still render (unstyled rows will get updated classes in later tasks).

- [ ] **Step 3: Commit**

```bash
git add shared/train-v2.css
git commit -m "feat(train): add history inline-expand CSS (tiles, chips, accordion)"
```

---

### Task 3: Add helper functions and state to train.js

**Files:**
- Modify: `app/train/train.js`

This task adds the new imports, helper functions, state variables, and data-fetching logic without changing the render output yet.

- [ ] **Step 1: Add imports for unit conversion and profile**

At the top of `app/train/train.js`, after the existing imports (line 16), add:

```js
import { getProfile } from "/shared/supabase.js";
import { resolveWeightUnit, fromKg } from "/shared/unit-conversion.js";
```

- [ ] **Step 2: Add helper functions after the `api()` function (after line 44)**

```js
function rpeLevel(rpe) {
  if (rpe == null || rpe === "") return "none";
  const n = parseFloat(rpe);
  if (isNaN(n)) return "none";
  if (n <= 6) return "low";
  if (n <= 7.5) return "med";
  return "high";
}

function groupSetsByExercise(sets) {
  const groups = [];
  const seen = new Map();
  for (const s of sets) {
    const eid = s.exercise_id;
    if (!eid) continue;
    if (seen.has(eid)) {
      seen.get(eid).push(s);
    } else {
      const arr = [s];
      seen.set(eid, arr);
      groups.push({ exerciseId: eid, sets: arr });
    }
  }
  return groups;
}

function findTopSetIndex(sets) {
  let bestIdx = -1;
  let bestLoad = -1;
  let bestReps = -1;
  for (let i = 0; i < sets.length; i++) {
    const load = parseFloat(sets[i].load_kg) || 0;
    const reps = parseInt(sets[i].reps, 10) || 0;
    if (load > bestLoad || (load === bestLoad && reps > bestReps)) {
      bestLoad = load;
      bestReps = reps;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function formatDuration(startedAt, endedAt) {
  if (!startedAt) return "";
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const mins = Math.max(0, Math.round((end - start) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatDate(iso) {
  const d = new Date(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = months[d.getMonth()];
  const day = d.getDate();
  const hours = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${month} ${day} · ${h12}:${mins} ${ampm}`;
}
```

- [ ] **Step 3: Add new state variables inside TrainApp (after line 169, after `finishOpen` state)**

```js
  const [expandedSessionId, setExpandedSessionId] = useState(null);
  const [sessionDetailCache, setSessionDetailCache] = useState({});
  const [expandLoading, setExpandLoading] = useState(false);
  const [expandError, setExpandError] = useState("");
  const [weightUnit, setWeightUnit] = useState("kg");
```

- [ ] **Step 4: Add profile fetch effect (after the existing `useAuthSession` hook usage)**

After the `const accessToken = ...` line (line 159), add a useEffect for loading the user's weight unit:

```js
  useEffect(() => {
    if (!session?.user?.id) return;
    getProfile(session.user.id).then((p) => {
      if (p?.weight_unit) setWeightUnit(resolveWeightUnit(p.weight_unit));
    }).catch(() => {});
  }, [session?.user?.id]);
```

- [ ] **Step 5: Add the expandSession handler (after the `cancelSession` callback)**

```js
  const expandSession = useCallback(async (sessionId) => {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      return;
    }
    setExpandedSessionId(sessionId);
    setExpandError("");
    if (sessionDetailCache[sessionId]) return;
    setExpandLoading(true);
    try {
      const detail = await api(`/api/workout-sessions/${sessionId}`, { accessToken });
      setSessionDetailCache((prev) => ({ ...prev, [sessionId]: detail }));
      const sets = detail.sets || [];
      const exerciseIds = [...new Set(sets.map((s) => s.exercise_id).filter(Boolean))];
      const missing = exerciseIds.filter((id) => !exerciseLookup[id]);
      if (missing.length) {
        try {
          const list = await api(`/api/exercises?recent=true&limit=100`, { accessToken });
          const map = {};
          for (const ex of (list.items || [])) map[ex.id] = ex;
          setExerciseLookup((prev) => ({ ...prev, ...map }));
        } catch {}
      }
    } catch (err) {
      setExpandError(err.message || "Could not load session details.");
    } finally {
      setExpandLoading(false);
    }
  }, [expandedSessionId, sessionDetailCache, accessToken, exerciseLookup]);
```

- [ ] **Step 6: Reset expanded state when modality changes**

In the existing `setModality` callback (around line 178), add `setExpandedSessionId(null);` after `setActiveSets([]);`:

```js
  const setModality = useCallback((modality) => {
    if (!MODALITIES.includes(modality)) return;
    const next = { ...state, modality, sessionId: "" };
    setState(next); updateUrl(next);
    setActiveSession(null); setActiveSets([]);
    setExpandedSessionId(null);
  }, [state, updateUrl]);
```

- [ ] **Step 7: Verify no runtime errors**

Open `http://127.0.0.1:3001/app/train/`, switch to History tab. The rows should still render with the old markup (no visual change yet). Check console for import or runtime errors.

- [ ] **Step 8: Commit**

```bash
git add app/train/train.js
git commit -m "feat(train): add history expand state, helpers, and data fetch logic"
```

---

### Task 4: Replace history tab render with expandable rows

**Files:**
- Modify: `app/train/train.js` (the history render block, lines 379-393)

- [ ] **Step 1: Add the HistoryExpandSkeleton component**

Add this component before the `TrainApp` function (after the `TrainHistorySkeleton` component, around line 154):

```js
function HistoryExpandSkeleton() {
  return h("div", { className: "tr-history-expand-skel" },
    Array.from({ length: 3 }).map((_, i) =>
      h("div", { key: i, className: "tr-history-expand-skel-block" },
        h("div", { className: "skel skel-line lg w-40" }),
        h("div", { className: "skel skel-block h-80" }),
      )),
  );
}
```

- [ ] **Step 2: Replace the history tab render block**

Find the history tab render block (lines 379-393 in the original file). This is the `else` branch of the `state.tab === "active"` ternary, starting with `: h("div", { className: "tr-tab-body" },`. Replace the entire block:

```js
      : h("div", { className: "tr-tab-body" },
          history.loading
            ? h(TrainHistorySkeleton)
            : history.items.length
              ? h("ul", { className: "tr-history-list" },
                  history.items.map((s) => {
                    const isExpanded = expandedSessionId === s.id;
                    const detail = sessionDetailCache[s.id];
                    const sets = detail?.sets || [];
                    const groups = isExpanded && detail ? groupSetsByExercise(sets) : [];
                    const totalSets = sets.length;
                    const totalVolume = sets.reduce((acc, set) => acc + ((parseFloat(set.load_kg) || 0) * (parseInt(set.reps, 10) || 0)), 0);
                    const displayVolume = weightUnit === "lbs" ? Math.round(fromKg(totalVolume, "lbs")) : Math.round(totalVolume);
                    const volLabel = weightUnit === "lbs" ? "lb" : "kg";
                    const duration = formatDuration(s.started_at, s.ended_at);
                    const dateStr = formatDate(s.started_at);
                    const status = s.ended_at ? "" : " · IN PROGRESS";

                    return h("li", {
                      key: s.id,
                      className: `tr-history-row${isExpanded ? " is-expanded" : ""}`,
                      onClick: () => expandSession(s.id),
                    },
                      h("div", { className: "tr-history-header" },
                        h("div", { className: "tr-history-left" },
                          h("div", { className: "tr-history-title" }, s.title || "Untitled session"),
                          h("div", { className: "tr-history-meta-row" },
                            h("span", { className: "tr-history-date" }, `${dateStr}${duration ? ` · ${duration}` : ""}${status}`),
                            (s.exercises || []).length > 0 ? h("span", { className: "tr-history-dot" }, "·") : null,
                            (s.exercises || []).length > 0
                              ? h("span", { className: "tr-history-chip" }, `${(s.exercises || []).length} exercises`)
                              : null,
                            detail && totalSets > 0
                              ? h("span", { className: "tr-history-chip" }, `${totalSets} sets`)
                              : null,
                            detail && totalVolume > 0
                              ? h("span", { className: `tr-history-chip tr-history-chip-vol` }, `${displayVolume.toLocaleString()} ${volLabel}`)
                              : null,
                          ),
                        ),
                        h("span", { className: "tr-history-chevron" }, "›"),
                      ),

                      h("div", { className: "tr-history-body" },
                        isExpanded && expandLoading && !detail
                          ? h(HistoryExpandSkeleton)
                          : isExpanded && expandError && !detail
                            ? h("div", { className: "tr-history-expand-error", role: "alert" },
                                expandError,
                                h("button", { onClick: (e) => { e.stopPropagation(); setExpandError(""); } }, "✕"),
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
                                      ? `top: ${topLoad} ${volLabel} × ${topReps}`
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
                                                      ? h("span", { className: "tr-history-tile-reps" }, `× ${reps}`)
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
                    );
                  }))
              : h("p", { className: "tr-empty-state" }, "No history yet."),
        ),
```

- [ ] **Step 3: Verify the feature works end-to-end**

1. Open `http://127.0.0.1:3001/app/train/`
2. Switch to the History tab
3. Verify collapsed rows show title, date, duration, exercise count chip
4. Click a session — it should expand showing all exercises with set tiles
5. Click another session — first one should collapse, second one expands (accordion)
6. Verify set tiles show load as hero number, RPE color stripe, top set highlighted
7. Verify session note shows at bottom when present
8. Toggle theme — verify both Paper and Mint look correct
9. Check loading skeleton appears briefly during first expand

- [ ] **Step 4: Commit**

```bash
git add app/train/train.js
git commit -m "feat(train): render history rows with inline expand, grid tiles, accordion"
```

---

### Task 5: Remove C.1 "Ask Emersus" drawer from deferred backlog

**Files:**
- Modify: `checkpoint.md`

- [ ] **Step 1: Update checkpoint.md**

In `checkpoint.md`, find the line:

```
1. ⬜ **Phase 3 — "Ask Emersus" right-side drawer** (440px slide-in chat reuse on `/app/train/`).
```

Replace it with:

```
1. ❌ **Phase 3 — "Ask Emersus" right-side drawer** — REJECTED (AI chat is a full-page experience, not a sidebar).
```

- [ ] **Step 2: Update the history inline-expand item to mark it done**

In `checkpoint.md`, find the line:

```
2. ⬜ **Phase 3 — History tab inline-expand** on `/app/train/`.
```

Replace it with:

```
2. ✅ **Phase 3 — History tab inline-expand** on `/app/train/` — shipped 2026-04-15.
```

- [ ] **Step 3: Commit**

```bash
git add checkpoint.md
git commit -m "docs: mark drawer rejected, history expand shipped in checkpoint"
```

---

### Task 6: Update memory and changelog

**Files:**
- Modify: `changelog.md`

- [ ] **Step 1: Append to changelog.md**

Add a new bullet at the top of `changelog.md`:

```
2026-04-15 — History inline-expand on /app/train/ — click a session to see all exercises + set tiles with RPE color coding, top set highlight, accordion behavior — app/train/train.js, shared/train-v2.css, shared/design-tokens.css
```

- [ ] **Step 2: Commit**

```bash
git add changelog.md
git commit -m "docs: changelog entry for history inline-expand"
```
