# Landing Demo Live Widget Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single static Q&A in the landing hero demo with a rotating loop of three typed-in prompts, each producing a different live-built stylized widget, cycling every ~42 seconds.

**Architecture:** Pure HTML/CSS/JS additions to `index.html` and `shared/landing.css`. All three widgets live in the DOM at page load as sibling containers under `.demo-main`, toggled via a `data-rotation="a|b|c"` attribute. An inline `<script>` drives a state machine that awaits each animation phase serially. No external libs, no build step, no iframes — stylized SVG/CSS mockups only.

**Tech Stack:** Vanilla HTML, CSS, and ES module-less inline JavaScript. Uses existing design tokens from `/shared/design-tokens.css` via `shared/landing.css`.

**Spec:** `docs/superpowers/specs/2026-04-17-landing-demo-live-widget-rotation-design.md`

**Prerequisite already complete:** `index.html` backed up to `backups/index.html.2026-04-17-pre-demo-rotation.bak` (gitignored).

**Verification philosophy:** This is a purely visual feature — there is no automated test harness for CSS animation timing. Each task that produces visible output includes a **browser verification step**: run the local dev server, scroll to `#demo`, observe the described visual state for the described duration, check both palettes (dark + light via Profile→Appearance toggle or by setting `document.documentElement.setAttribute('data-theme','mint'|'paper')` in DevTools). If behavior does not match, debug before moving on.

**Commit cadence:** Commit after each task. `.md` files in `docs/` are gitignored by project convention (see `CLAUDE.md`) — do not attempt to stage this plan or the spec.

---

## File structure

**Modified files (no new files):**
- `index.html` — demo-wrap section (lines ~212-269) rewritten; inline animation script (lines ~672-744) rewritten
- `shared/landing.css` — new rules appended below existing demo-related rules (~line 249, before the `===== SECTIONS =====` comment)

**No new files.** A separate JS module was considered but rejected: the current landing demo script is inline, and keeping the new state machine inline preserves the "single-file landing page" posture. Total added LOC fits comfortably inline.

---

## Task 1: Replace demo sidebar + demo-main skeleton DOM

**Files:**
- Modify: `index.html:218-231` (sidebar `<aside class="demo-side">`)
- Modify: `index.html:232-267` (`<div class="demo-main">`)

Sets up the three-rotation container structure with all rotations pre-rendered but hidden, and updates the sidebar to include the new "Cut macros — 82 kg" item.

- [ ] **Step 1: Rewrite sidebar**

Replace `index.html:219-231` with:

```html
<aside class="demo-side">
  <div class="side-group">
    <div class="side-label">Today</div>
    <div class="side-item" data-slot="protein"><span class="mini-dot"></span>Protein intake</div>
    <div class="side-item" data-slot="creatine"><span class="mini-dot"></span>Creatine vs. beta-alanine</div>
    <div class="side-item" data-slot="cut-macros"><span class="mini-dot"></span>Cut macros — 82 kg</div>
  </div>
  <div class="side-group">
    <div class="side-label">Yesterday</div>
    <div class="side-item"><span class="mini-dot"></span>Hypertrophy volume</div>
    <div class="side-item"><span class="mini-dot"></span>Sleep &amp; recovery</div>
    <div class="side-item"><span class="mini-dot"></span>Zone 2 protocol</div>
  </div>
</aside>
```

Note: the `.active` class is no longer hard-coded — the state machine adds it based on `data-slot`. "Creatine loading" was relabeled to "Creatine vs. beta-alanine" to match the rotation B thread.

- [ ] **Step 2: Rewrite demo-main**

Replace `index.html:232-267` with:

```html
<div class="demo-main" data-rotation="a" data-phase="composer">
  <div class="demo-header">
    <div class="thread-title" id="demo-thread-title">Protein intake for hypertrophy</div>
    <div class="thread-meta" id="demo-thread-meta">EMERSUS · 1 WIDGET</div>
  </div>
  <div class="msgs">
    <div class="msg msg-user" id="demo-user-msg">
      <div class="msg-who">You</div>
      <div class="bubble" id="demo-user-bubble"></div>
    </div>
    <div class="msg msg-assist" id="demo-assist-msg">
      <div class="msg-who">Emersus</div>
      <div class="bubble" id="demo-intro-text"></div>
      <div class="demo-widget-slot">
        <!-- ROTATION A — dose-response curve (rotation B + C added in later tasks) -->
        <div class="demo-widget" data-widget="a" hidden></div>
        <div class="demo-widget" data-widget="b" hidden></div>
        <div class="demo-widget" data-widget="c" hidden></div>
      </div>
      <div class="cite-pill" id="demo-cite-pill"></div>
    </div>
  </div>
  <div class="composer">
    <div class="composer-input" id="demo-composer-input"><span class="composer-placeholder">Ask anything…</span></div>
    <div class="composer-hint" id="demo-composer-hint">⏎ SEND</div>
  </div>
</div>
```

The three `.demo-widget[data-widget=X]` divs are placeholder containers that tasks 3/4/5 fill in. `hidden` is used so none render before the state machine activates the first rotation. The chrome title block (`<div class="chrome-title">emersus.ai — protein intake</div>` at line 215) stays as-is; it will be updated via `textContent` by the state machine.

- [ ] **Step 3: Browser verification**

Run: `npm start` (or the existing local dev command), load `http://localhost:3000/`, scroll to the demo. Expected: chrome and sidebar render cleanly, sidebar shows three "Today" items (no active highlight yet), thread shows "Protein intake for hypertrophy" header, main area shows empty user bubble, empty assistant bubble, and an empty composer with placeholder "Ask anything…". No errors in DevTools console. Toggle palette — both dark and light render without layout shift.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(landing): restructure demo DOM for rotation (sidebar + rotation slots)"
```

---

## Task 2: Add base CSS for rotation state + composer caret + cite pill

**Files:**
- Modify: `shared/landing.css` — append new block after line ~248 (end of existing demo rules), before `/* ===== SECTIONS ===== */`

Establishes the new state-driven CSS primitives that all three rotations depend on: per-rotation widget visibility, composer placeholder styling, composer caret position, cite pill styling, and phase-based message visibility.

- [ ] **Step 1: Append the base rotation CSS**

Append to `shared/landing.css` immediately before the `/* ===== SECTIONS =====` comment:

```css
/* ===== DEMO ROTATION (2026-04-17) ===== */

/* Per-rotation widget visibility — only the widget whose data-widget
   matches the current data-rotation on .demo-main is visible. */
.demo-main .demo-widget { display: none; }
.demo-main[data-rotation="a"] .demo-widget[data-widget="a"] { display: block; }
.demo-main[data-rotation="b"] .demo-widget[data-widget="b"] { display: block; }
.demo-main[data-rotation="c"] .demo-widget[data-widget="c"] { display: block; }

/* Phase-based visibility for message rows. The state machine sets
   data-phase on .demo-main to drive which rows are shown. */
.demo-main[data-phase="composer"] #demo-user-msg,
.demo-main[data-phase="composer"] #demo-assist-msg { opacity: 0; pointer-events: none; }
.demo-main[data-phase="send"] #demo-user-msg { opacity: 1; transform: translateY(0); transition: opacity .35s ease, transform .35s ease; }
.demo-main[data-phase="send"] #demo-assist-msg { opacity: 0; }
.demo-main[data-phase="assist"] #demo-user-msg,
.demo-main[data-phase="assist"] #demo-assist-msg { opacity: 1; transform: translateY(0); transition: opacity .35s ease, transform .35s ease; }

/* Composer placeholder vs typed text */
.composer-placeholder { color: var(--dim); }
#demo-composer-input { min-height: 22px; display: flex; align-items: center; }
#demo-composer-input .typed { color: var(--ink); }
#demo-composer-input .caret {
  display: inline-block; width: 7px; height: 1.05em;
  background: var(--accent); vertical-align: -2px; margin-left: 2px;
  animation: caret-blink 1s steps(2) infinite;
}

/* Composer send pulse */
#demo-composer-hint { transition: transform .12s ease, color .12s ease, text-shadow .2s ease; }
#demo-composer-hint.pulse { transform: scale(1.18); color: var(--accent); text-shadow: 0 0 12px var(--accent-glow); }

/* Cite pill below the widget */
.cite-pill {
  display: inline-flex; align-items: center; gap: 8px;
  margin-top: 12px;
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--dim);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0; transform: translateY(4px);
  transition: opacity .35s ease, transform .35s ease;
}
.cite-pill.show { opacity: 1; transform: translateY(0); }
.cite-pill .grade {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid var(--accent-line);
  letter-spacing: 0.14em;
}
.cite-pill .grade.mod { background: color-mix(in oklab, var(--warning) 18%, transparent); color: var(--warning); border-color: color-mix(in oklab, var(--warning) 45%, transparent); }
.cite-pill .grade.std { background: var(--surface-faint); color: var(--muted); border-color: var(--line); }

/* Widget slot wrapper (provides spacing above widget relative to bubble) */
.demo-widget-slot { margin-top: 14px; min-height: 40px; }
```

If `--warning` is not defined in `/shared/design-tokens.css`, substitute a literal amber like `#f59e0b`. Verify before relying on it.

- [ ] **Step 2: Verify `--warning` token exists**

Run: `grep -n "\-\-warning" shared/design-tokens.css` (use Grep tool). If present, keep the `color-mix(...)` style. If absent, replace the `.cite-pill .grade.mod` block with:

```css
.cite-pill .grade.mod { background: rgba(245, 158, 11, 0.18); color: #f59e0b; border-color: rgba(245, 158, 11, 0.45); }
```

- [ ] **Step 3: Browser verification**

Reload the page. Expected: composer now shows "Ask anything…" in a dimmer color. Empty assistant bubble still invisible (phase starts as `composer`). No visual regression on the rest of the demo frame (chrome border, sidebar still readable). Both palettes still look correct.

- [ ] **Step 4: Commit**

```bash
git add shared/landing.css
git commit -m "feat(landing): base CSS for demo rotation (phase visibility, caret, cite pill)"
```

---

## Task 3: Implement widget A — dose-response curve (HTML + CSS, static)

**Files:**
- Modify: `index.html` — replace `<div class="demo-widget" data-widget="a" hidden></div>`
- Modify: `shared/landing.css` — append widget A styles

Builds the SVG dose-response chart in its *fully filled* state. Skeleton/fill transitions come in Task 7.

- [ ] **Step 1: Fill in widget A HTML**

Replace the `<div class="demo-widget" data-widget="a" hidden></div>` stub with:

```html
<div class="demo-widget wg-a" data-widget="a" hidden>
  <div class="wg-head">
    <span class="wg-label">DOSE-RESPONSE · MUSCLE MASS Δ</span>
    <span class="wg-sub">Protein intake (g/kg BW)</span>
  </div>
  <svg class="wg-a-chart" viewBox="0 0 380 180" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <!-- Axis grid -->
    <g class="wg-grid">
      <line x1="30" y1="30" x2="370" y2="30"/>
      <line x1="30" y1="80" x2="370" y2="80"/>
      <line x1="30" y1="130" x2="370" y2="130"/>
      <line x1="30" y1="30" x2="30" y2="150"/>
    </g>
    <!-- X-axis tick labels -->
    <g class="wg-ticks">
      <text x="30"  y="168">0.8</text>
      <text x="115" y="168">1.2</text>
      <text x="200" y="168">1.6</text>
      <text x="285" y="168">2.0</text>
      <text x="370" y="168">2.4 g/kg</text>
    </g>
    <!-- Dashed plateau marker -->
    <line class="wg-plateau" x1="200" y1="30" x2="200" y2="150"/>
    <text class="wg-plateau-label" x="206" y="42">PLATEAU</text>
    <!-- Main curve (rises steeply then flattens) -->
    <path class="wg-a-curve"
          d="M 30 130 Q 80 110, 115 90 T 200 55 Q 260 48, 330 46 T 370 46" />
    <!-- Callout dot at plateau -->
    <circle class="wg-a-dot" cx="200" cy="55" r="4.5"/>
    <text class="wg-a-callout" x="214" y="60">Diminishing returns</text>
  </svg>
</div>
```

The path `d` attribute uses `Q` (quadratic) + `T` (smooth continuation) so the curve rises steeply 0.8→1.6 then flattens. Exact coordinates are visual approximations — tune in the browser if the curve doesn't feel right, but stay within the 380×180 viewBox.

- [ ] **Step 2: Append widget A CSS**

Append to `shared/landing.css`:

```css
/* ===== WIDGET A — dose-response curve ===== */
.wg-a { border: 1px solid var(--line); border-radius: 12px; background: var(--surface-faint); padding: 16px 18px; }
.wg-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
.wg-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); }
.wg-sub { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; color: var(--dim); }
.wg-a-chart { width: 100%; height: auto; display: block; }
.wg-a-chart .wg-grid line { stroke: var(--line); stroke-width: 1; }
.wg-a-chart .wg-ticks text { font-family: var(--font-mono); font-size: 9.5px; fill: var(--dim); letter-spacing: 0.1em; text-anchor: middle; }
.wg-a-chart .wg-ticks text:last-child { text-anchor: end; }
.wg-a-chart .wg-plateau { stroke: var(--accent); stroke-width: 1.2; stroke-dasharray: 3 4; opacity: 0.55; }
.wg-a-chart .wg-plateau-label { font-family: var(--font-mono); font-size: 9px; fill: var(--accent); letter-spacing: 0.2em; }
.wg-a-chart .wg-a-curve { fill: none; stroke: var(--accent); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 4px var(--accent-glow)); }
.wg-a-chart .wg-a-dot { fill: var(--accent); stroke: var(--bg); stroke-width: 2; filter: drop-shadow(0 0 6px var(--accent-glow)); }
.wg-a-chart .wg-a-callout { font-family: var(--font-mono); font-size: 9.5px; fill: var(--muted); letter-spacing: 0.1em; }
```

- [ ] **Step 3: Browser verification — force widget A visible**

Temporarily remove the `hidden` attribute from `<div class="demo-widget" data-widget="a">` (or use DevTools to delete it). Expected: chart renders with axis grid, tick labels, dashed PLATEAU line at center, accent-colored curve rising then flattening, dot at plateau intersection, "Diminishing returns" callout. Both palettes look correct (curve stroke color switches appropriately). Restore the `hidden` attribute when done.

- [ ] **Step 4: Commit**

```bash
git add index.html shared/landing.css
git commit -m "feat(landing): widget A dose-response curve (static state)"
```

---

## Task 4: Implement widget B — evidence matrix (HTML + CSS, static)

**Files:**
- Modify: `index.html` — replace `<div class="demo-widget" data-widget="b" hidden></div>`
- Modify: `shared/landing.css` — append widget B styles

Two-column comparison card with evidence pills.

- [ ] **Step 1: Fill in widget B HTML**

Replace the `data-widget="b"` stub with:

```html
<div class="demo-widget wg-b" data-widget="b" hidden>
  <div class="wg-head">
    <span class="wg-label">EVIDENCE COMPARISON</span>
    <span class="wg-sub">Ergogenic aids · RCT synthesis</span>
  </div>
  <div class="wg-b-grid">
    <div class="wg-b-col">
      <div class="wg-b-col-head">CREATINE</div>
      <div class="wg-b-cell" data-row="effect"><span class="wg-b-k">EFFECT</span><span class="wg-b-v">d=0.20 strength</span></div>
      <div class="wg-b-cell" data-row="studies"><span class="wg-b-k">STUDIES</span><span class="wg-b-v">200+ RCTs</span></div>
      <div class="wg-b-cell" data-row="grade"><span class="wg-b-k">EVIDENCE</span><span class="wg-b-pill strong">HIGH</span></div>
      <div class="wg-b-cell" data-row="mech"><span class="wg-b-k">MECHANISM</span><span class="wg-b-v">Phosphocreatine resynthesis</span></div>
    </div>
    <div class="wg-b-col">
      <div class="wg-b-col-head">BETA-ALANINE</div>
      <div class="wg-b-cell" data-row="effect"><span class="wg-b-k">EFFECT</span><span class="wg-b-v">d=0.18 repeated sprint</span></div>
      <div class="wg-b-cell" data-row="studies"><span class="wg-b-k">STUDIES</span><span class="wg-b-v">40+ RCTs</span></div>
      <div class="wg-b-cell" data-row="grade"><span class="wg-b-k">EVIDENCE</span><span class="wg-b-pill moderate">MODERATE</span></div>
      <div class="wg-b-cell" data-row="mech"><span class="wg-b-k">MECHANISM</span><span class="wg-b-v">Carnosine buffering</span></div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Append widget B CSS**

Append to `shared/landing.css`:

```css
/* ===== WIDGET B — evidence matrix ===== */
.wg-b { border: 1px solid var(--line); border-radius: 12px; background: var(--surface-faint); padding: 16px 18px; }
.wg-b-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.wg-b-col { border: 1px solid var(--line); border-radius: 10px; background: var(--bg); padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.wg-b-col-head { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.22em; color: var(--ink); font-weight: 600; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.wg-b-cell { display: flex; justify-content: space-between; align-items: center; gap: 8px; opacity: 0; transform: translateY(4px) scale(0.98); }
.wg-b-cell.show { opacity: 1; transform: translateY(0) scale(1); transition: opacity .35s ease, transform .35s ease; }
.wg-b-k { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.16em; color: var(--dim); text-transform: uppercase; }
.wg-b-v { font-size: 12.5px; color: var(--ink); text-align: right; line-height: 1.3; }
.wg-b-pill {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 999px;
  font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.2em;
  border: 1px solid transparent;
}
.wg-b-pill.strong { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-line); }
.wg-b-pill.moderate { background: rgba(245, 158, 11, 0.18); color: #f59e0b; border-color: rgba(245, 158, 11, 0.45); }
```

If `--warning` token was confirmed to exist in Task 2 Step 2, substitute the moderate pill with `color-mix(in oklab, var(--warning) 18%, transparent)` equivalents for DRY.

- [ ] **Step 3: Browser verification — force widget B visible**

Temporarily set `<div class="demo-main" data-rotation="b" ...>` and remove the `hidden` attribute from widget B. Expected: two side-by-side columns (CREATINE, BETA-ALANINE). Each shows four rows: EFFECT, STUDIES, EVIDENCE (with colored pill), MECHANISM. HIGH pill is accent-colored. MODERATE pill is amber. Cells render at full opacity for now (we will wire `.show` class in task 7). Both palettes work. Restore `hidden` and `data-rotation="a"` when done.

Note: In this step, cells look invisible because `.wg-b-cell` defaults to `opacity: 0`. To verify statically, temporarily add `opacity: 1; transform: none;` inline or via DevTools, or add `.show` class to each cell.

- [ ] **Step 4: Commit**

```bash
git add index.html shared/landing.css
git commit -m "feat(landing): widget B evidence matrix (static state)"
```

---

## Task 5: Implement widget C — TDEE + cut macros (HTML + CSS, static)

**Files:**
- Modify: `index.html` — replace `<div class="demo-widget" data-widget="c" hidden></div>`
- Modify: `shared/landing.css` — append widget C styles

Stats card showing inputs, big kcal readouts, and three macro bars.

- [ ] **Step 1: Fill in widget C HTML**

Replace the `data-widget="c"` stub with:

```html
<div class="demo-widget wg-c" data-widget="c" hidden>
  <div class="wg-head">
    <span class="wg-label">TDEE + CUT MACROS</span>
    <span class="wg-sub">Mifflin-St Jeor · 1.55 × activity</span>
  </div>
  <div class="wg-c-inputs">
    <span class="wg-c-input" id="demo-wgc-weight">82 KG</span>
    <span class="wg-c-divider">·</span>
    <span class="wg-c-input" id="demo-wgc-height">178 CM</span>
    <span class="wg-c-divider">·</span>
    <span class="wg-c-input" id="demo-wgc-activity">MODERATELY ACTIVE</span>
  </div>
  <div class="wg-c-readout">
    <div class="wg-c-row">
      <span class="wg-c-k">TDEE</span>
      <span class="wg-c-kcal" id="demo-wgc-tdee" data-target="2630">0</span>
      <span class="wg-c-unit">kcal</span>
    </div>
    <div class="wg-c-row wg-c-cut">
      <span class="wg-c-k">CUT TARGET</span>
      <span class="wg-c-kcal" id="demo-wgc-cut" data-target="2100">0</span>
      <span class="wg-c-unit">kcal</span>
      <span class="wg-c-delta">−20%</span>
    </div>
  </div>
  <div class="wg-c-macros">
    <div class="wg-c-macro">
      <span class="wg-c-macro-k">PROTEIN</span>
      <div class="wg-c-bar-wrap"><div class="wg-c-bar protein" style="--fill: 82%;"></div></div>
      <span class="wg-c-macro-v">165g</span>
    </div>
    <div class="wg-c-macro">
      <span class="wg-c-macro-k">CARBS</span>
      <div class="wg-c-bar-wrap"><div class="wg-c-bar carbs" style="--fill: 66%;"></div></div>
      <span class="wg-c-macro-v">200g</span>
    </div>
    <div class="wg-c-macro">
      <span class="wg-c-macro-k">FAT</span>
      <div class="wg-c-bar-wrap"><div class="wg-c-bar fat" style="--fill: 52%;"></div></div>
      <span class="wg-c-macro-v">65g</span>
    </div>
  </div>
</div>
```

The bar widths are derived from 165/200g×100% ≈ 82%, 200/300g×100% ≈ 66%, 65/125g×100% ≈ 52% (approximate visual scaling against generous maxes, not nutritional percentages). The `--fill` custom property sets the target; `.wg-c.filled .wg-c-bar` animates from 0 to `--fill`.

- [ ] **Step 2: Append widget C CSS**

Append to `shared/landing.css`:

```css
/* ===== WIDGET C — TDEE + cut macros ===== */
.wg-c { border: 1px solid var(--line); border-radius: 12px; background: var(--surface-faint); padding: 16px 18px; }
.wg-c-inputs { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); letter-spacing: 0.16em; }
.wg-c-input { padding: 4px 8px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; }
.wg-c-divider { color: var(--dim); }
.wg-c-readout { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.wg-c-row { display: flex; align-items: baseline; gap: 8px; }
.wg-c-k { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.22em; color: var(--dim); min-width: 86px; }
.wg-c-kcal { font-family: var(--font-mono); font-size: 24px; color: var(--ink); font-weight: 600; letter-spacing: -0.01em; }
.wg-c-cut .wg-c-kcal { color: var(--accent); }
.wg-c-unit { font-family: var(--font-mono); font-size: 11px; color: var(--dim); letter-spacing: 0.12em; }
.wg-c-delta { font-family: var(--font-mono); font-size: 10px; color: var(--accent); letter-spacing: 0.14em; margin-left: auto; padding: 2px 8px; background: var(--accent-soft); border: 1px solid var(--accent-line); border-radius: 999px; }
.wg-c-macros { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--line); padding-top: 12px; }
.wg-c-macro { display: grid; grid-template-columns: 70px 1fr 48px; align-items: center; gap: 10px; }
.wg-c-macro-k { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.16em; color: var(--dim); }
.wg-c-macro-v { font-family: var(--font-mono); font-size: 11px; color: var(--ink); letter-spacing: 0.1em; text-align: right; }
.wg-c-bar-wrap { height: 6px; background: var(--line); border-radius: 4px; overflow: hidden; }
.wg-c-bar { height: 100%; width: 0%; border-radius: 4px; transition: width 1s cubic-bezier(.22,.8,.32,1); }
.wg-c-bar.protein { background: var(--accent); }
.wg-c-bar.carbs { background: color-mix(in oklab, var(--accent) 55%, var(--muted)); }
.wg-c-bar.fat { background: color-mix(in oklab, var(--accent) 30%, var(--muted)); }
.wg-c.filled .wg-c-bar { width: var(--fill); }
```

If `color-mix` is not supported or the result looks off in light palette, substitute literal hex values (dark: `#a7f3d0` carbs, `#94a3b8` fat; light: adjust similarly — tune in browser).

- [ ] **Step 3: Browser verification — force widget C visible**

Temporarily set `<div class="demo-main" data-rotation="c" ...>` and remove the `hidden` attribute from widget C. Expected: inputs row (`82 KG · 178 CM · MODERATELY ACTIVE`), two big kcal readouts (initially `0 kcal` because count-up hasn't run — that's OK for static test), three macro bars (initially empty because `.wg-c.filled` isn't set — that's OK). Add `.filled` class via DevTools to confirm bars grow to their target widths and colors differentiate. Restore `hidden` and `data-rotation="a"` when done.

- [ ] **Step 4: Commit**

```bash
git add index.html shared/landing.css
git commit -m "feat(landing): widget C TDEE + cut macros (static state)"
```

---

## Task 6: Add skeleton styles + value-fill animations per widget

**Files:**
- Modify: `shared/landing.css` — append skeleton and animation rules

Each widget has a "skeleton" state (muted placeholders) and a "filled" state (values animate in). The state machine sets `.skeleton` then `.filled` on `.demo-widget` to trigger transitions.

- [ ] **Step 1: Append skeleton + fill animations**

Append to `shared/landing.css`:

```css
/* ===== WIDGET STATES — skeleton + filled ===== */

/* Generic skeleton wash overlay */
.demo-widget.skeleton { position: relative; overflow: hidden; }
.demo-widget.skeleton::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(90deg, transparent 0%, var(--accent-glow) 50%, transparent 100%);
  transform: translateX(-100%);
  animation: skel-sweep 1.1s linear infinite;
  opacity: 0.35;
}
@keyframes skel-sweep { to { transform: translateX(100%); } }

/* --- Widget A: curve draws left-to-right on fill --- */
.wg-a .wg-a-curve { stroke-dasharray: 520; stroke-dashoffset: 520; }
.wg-a.skeleton .wg-a-curve,
.wg-a.skeleton .wg-a-dot,
.wg-a.skeleton .wg-a-callout,
.wg-a.skeleton .wg-plateau,
.wg-a.skeleton .wg-plateau-label { opacity: 0.18; }
.wg-a.skeleton .wg-a-curve { stroke-dashoffset: 520; }
.wg-a.filled .wg-a-curve { stroke-dashoffset: 0; transition: stroke-dashoffset .9s ease-out; }
.wg-a.filled .wg-a-dot { opacity: 1; transition: opacity .35s ease .85s; }
.wg-a.filled .wg-a-callout { opacity: 1; transition: opacity .35s ease .95s; }
.wg-a.filled .wg-plateau { opacity: 0.55; transition: opacity .35s ease .7s; }
.wg-a.filled .wg-plateau-label { opacity: 1; transition: opacity .35s ease .75s; }
.wg-a .wg-a-dot, .wg-a .wg-a-callout, .wg-a .wg-plateau, .wg-a .wg-plateau-label { opacity: 0; }

/* Stroke-dasharray is approximate — the Q/T path length is ~480-540 px.
   If the curve visibly lingers incomplete or snaps, retune to the real
   path length via getTotalLength() in DevTools console. */

/* --- Widget B: cells fade-scale in with stagger --- */
.wg-b.filled .wg-b-cell { opacity: 1; transform: translateY(0) scale(1); }
.wg-b.filled .wg-b-col:nth-child(1) .wg-b-cell[data-row="effect"]  { transition-delay: 0.00s; }
.wg-b.filled .wg-b-col:nth-child(1) .wg-b-cell[data-row="studies"] { transition-delay: 0.08s; }
.wg-b.filled .wg-b-col:nth-child(1) .wg-b-cell[data-row="grade"]   { transition-delay: 0.16s; }
.wg-b.filled .wg-b-col:nth-child(1) .wg-b-cell[data-row="mech"]    { transition-delay: 0.24s; }
.wg-b.filled .wg-b-col:nth-child(2) .wg-b-cell[data-row="effect"]  { transition-delay: 0.32s; }
.wg-b.filled .wg-b-col:nth-child(2) .wg-b-cell[data-row="studies"] { transition-delay: 0.40s; }
.wg-b.filled .wg-b-col:nth-child(2) .wg-b-cell[data-row="grade"]   { transition-delay: 0.48s; }
.wg-b.filled .wg-b-col:nth-child(2) .wg-b-cell[data-row="mech"]    { transition-delay: 0.56s; }

/* --- Widget C: inputs appear muted in skeleton, bars animate on fill --- */
.wg-c.skeleton .wg-c-input,
.wg-c.skeleton .wg-c-kcal,
.wg-c.skeleton .wg-c-macro-v { opacity: 0.2; }
.wg-c.filled .wg-c-input,
.wg-c.filled .wg-c-kcal,
.wg-c.filled .wg-c-macro-v { opacity: 1; transition: opacity .3s ease; }
/* wg-c-bar width transition already declared in Task 5 */
```

- [ ] **Step 2: Browser verification — manually toggle skeleton/filled on widget A**

Temporarily un-hide widget A. In DevTools console, run:

```js
document.querySelector('.wg-a').classList.add('skeleton');
// wait, observe: curve muted, skeleton shimmer sweeps across
setTimeout(() => {
  document.querySelector('.wg-a').classList.remove('skeleton');
  document.querySelector('.wg-a').classList.add('filled');
  // curve draws left-to-right, plateau + dot + callout fade in
}, 1500);
```

Expected: when `.skeleton` is set, curve is faint and a diagonal sweep shimmers across the SVG area. When `.filled` replaces `.skeleton`, the curve draws itself over ~0.9s, then plateau/dot/callout fade in. Repeat with widgets B and C by toggling `.skeleton`/`.filled` on their roots. Restore to initial state before committing.

- [ ] **Step 3: Commit**

```bash
git add shared/landing.css
git commit -m "feat(landing): skeleton + value-fill animations for demo widgets"
```

---

## Task 7: Add thread-swap transition CSS (sidebar highlight slide + title crossfade)

**Files:**
- Modify: `shared/landing.css` — append thread-swap styles

Sidebar highlight slides smoothly when `.active` moves; chrome title and thread title crossfade with a short opacity transition.

- [ ] **Step 1: Append thread-swap CSS**

Append to `shared/landing.css`:

```css
/* ===== THREAD SWAP TRANSITIONS ===== */

/* Sidebar item highlight transitions */
.demo-side .side-item {
  transition: background .3s ease, color .3s ease, border-color .3s ease, padding .3s ease;
}
/* existing .side-item.active already defined; ensure it transitions smoothly */

/* Chrome + thread title crossfade: set data-swapping on .demo-main to fade out,
   then update text, then remove the attribute to fade back in. */
.chrome-title, #demo-thread-title, #demo-thread-meta {
  transition: opacity .22s ease;
}
.demo-main[data-swapping="true"] ~ * .chrome-title,
.demo-main[data-swapping="true"] #demo-thread-title,
.demo-main[data-swapping="true"] #demo-thread-meta { opacity: 0.15; }

/* User bubble fly-up animation (send-flight) */
@keyframes demo-fly-up {
  0% { opacity: 0; transform: translateY(14px); }
  60% { opacity: 1; transform: translateY(-2px); }
  100% { opacity: 1; transform: translateY(0); }
}
.demo-main[data-phase="send"] #demo-user-msg,
.demo-main[data-phase="assist"] #demo-user-msg { animation: demo-fly-up .45s ease both; }

/* Thinking shimmer dots */
.thinking-dots { display: inline-flex; gap: 4px; }
.thinking-dots span {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--muted); opacity: 0.35;
  animation: thinking-pulse 1.1s ease-in-out infinite;
}
.thinking-dots span:nth-child(2) { animation-delay: 0.18s; }
.thinking-dots span:nth-child(3) { animation-delay: 0.36s; }
@keyframes thinking-pulse { 0%, 100% { opacity: 0.25; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.15); } }
```

The `.chrome-title` lives OUTSIDE `.demo-main` (it's in `.demo-chrome`), so the sibling-combinator rule `.demo-main[data-swapping=true] ~ * .chrome-title` won't work. Simpler: the state machine will toggle a separate `data-swapping` attribute on the frame itself or just directly set opacity via JS. Replace that line with a JS-driven approach instead — remove the `.chrome-title` sibling rule. Keep only the thread-title/meta rules (they're inside `.demo-main`). The state machine will handle `.chrome-title` by setting `.style.opacity` directly.

- [ ] **Step 2: Fix the selector**

Replace the problematic selector block with:

```css
/* The chrome title lives outside .demo-main; state machine controls its
   opacity directly via style. Thread-level titles are inside .demo-main
   and use the attribute below. */
.demo-main[data-swapping="true"] #demo-thread-title,
.demo-main[data-swapping="true"] #demo-thread-meta { opacity: 0.15; }
.chrome-title { transition: opacity .22s ease; }
```

- [ ] **Step 3: Browser verification**

Temporarily set `<div class="demo-main" data-rotation="a" data-swapping="true">` and observe thread title + meta fade to 15%. Remove `data-swapping` — they fade back to full opacity. The `.chrome-title` transition is in place and waits for JS.

- [ ] **Step 4: Commit**

```bash
git add shared/landing.css
git commit -m "feat(landing): thread-swap transitions (bubble fly-up, title crossfade, thinking dots)"
```

---

## Task 8: Rewrite the animation script — rotation state machine

**Files:**
- Modify: `index.html:672-744` — replace the entire `<script>` block

This is the largest task in the plan. Replaces the existing typing loop with a rotation-driven async state machine.

- [ ] **Step 1: Replace the script tag body**

Replace the entire contents between `<script>` and `</script>` at the end of `index.html` (currently lines ~672-744) with:

```html
<script>
  // Landing hero demo — three-rotation loop.
  // Phases per rotation: composer-typing → send-flight → thinking →
  // intro-stream → widget-skeleton → widget-filled → cite-pill → thread-swap.
  // Stylized only — widgets are pre-rendered DOM toggled via data-rotation.
  // Reduced-motion users see rotation A in its final state, no loop.
  (function () {
    const demoRoot   = document.getElementById('demo');
    const main       = document.querySelector('.demo-main');
    if (!demoRoot || !main) return;

    const composerInput = document.getElementById('demo-composer-input');
    const composerHint  = document.getElementById('demo-composer-hint');
    const userBubble    = document.getElementById('demo-user-bubble');
    const introText     = document.getElementById('demo-intro-text');
    const citePill      = document.getElementById('demo-cite-pill');
    const threadTitle   = document.getElementById('demo-thread-title');
    const threadMeta    = document.getElementById('demo-thread-meta');
    const chromeTitle   = document.querySelector('.chrome-title');
    const sideItems     = document.querySelectorAll('.demo-side .side-item[data-slot]');

    const ROTATIONS = [
      {
        id: 'a',
        slot: 'protein',
        prompt: 'How much protein per day for hypertrophy?',
        threadTitle: 'Protein intake for hypertrophy',
        chromeTitle: 'emersus.ai — protein intake',
        intro: 'The evidence centers on <strong>1.6–2.2 g/kg/day</strong>. Above ~1.6, gains plateau.',
        cite: { tag: 'Morton et al · Br J Sports Med · 2018', grade: 'HIGH', gradeClass: 'strong' }
      },
      {
        id: 'b',
        slot: 'creatine',
        prompt: 'Creatine vs. beta-alanine — which actually works?',
        threadTitle: 'Creatine vs. beta-alanine',
        chromeTitle: 'emersus.ai — creatine vs beta-alanine',
        intro: 'Both work, but not equally. Creatine has the broader, stronger literature.',
        cite: { tag: 'Kreider et al · J Int Soc Sports Nutr · 2017', grade: 'HIGH', gradeClass: 'strong' }
      },
      {
        id: 'c',
        slot: 'cut-macros',
        prompt: "I'm 82 kg and want to cut. What's my TDEE?",
        threadTitle: 'Cutting calories on 82 kg',
        chromeTitle: 'emersus.ai — cut macros',
        intro: 'Mifflin-St Jeor + 1.55 activity multiplier. A 20% cut lands here:',
        cite: { tag: 'Mifflin-St Jeor · Am J Clin Nutr · 1990', grade: 'STANDARD', gradeClass: 'std' }
      }
    ];

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function typeComposer(text, speed, jitter) {
      composerInput.innerHTML = '<span class="typed"></span><span class="caret"></span>';
      const typedEl = composerInput.querySelector('.typed');
      for (let i = 0; i < text.length; i++) {
        typedEl.textContent += text[i];
        await sleep(speed + (Math.random() * jitter * 2 - jitter));
      }
    }

    async function streamText(el, html, speed) {
      el.innerHTML = '';
      const tokens = html.split(/(<[^>]+>)/).filter(Boolean);
      let plain = '';
      for (const tok of tokens) {
        if (tok.startsWith('<')) { plain += tok; el.innerHTML = plain; continue; }
        for (const ch of tok) {
          plain += ch;
          el.innerHTML = plain;
          await sleep(speed);
        }
      }
    }

    // Linearly tweens a number in an element over `duration` ms.
    async function countTo(el, target, duration) {
      const start = Number(el.textContent.replace(/[^\d-]/g, '')) || 0;
      const t0 = performance.now();
      return new Promise((resolve) => {
        function frame(t) {
          const k = Math.min(1, (t - t0) / duration);
          const eased = 1 - Math.pow(1 - k, 2);
          const val = Math.round(start + (target - start) * eased);
          el.textContent = val.toLocaleString();
          if (k < 1) requestAnimationFrame(frame); else resolve();
        }
        requestAnimationFrame(frame);
      });
    }

    function setActiveSidebar(slot) {
      sideItems.forEach((el) => {
        el.classList.toggle('active', el.dataset.slot === slot);
      });
    }

    function renderCite(cite) {
      citePill.innerHTML =
        `<span class="tag">${cite.tag}</span>` +
        `<span class="grade ${cite.gradeClass}">${cite.grade}</span>`;
    }

    function showThinkingDots() {
      introText.innerHTML = '<span class="thinking-dots"><span></span><span></span><span></span></span>';
    }

    function clearBubbleContents() {
      userBubble.textContent = '';
      introText.innerHTML = '';
      citePill.innerHTML = '';
      citePill.classList.remove('show');
    }

    async function animateWidgetC() {
      // Count up TDEE, then down to cut target, then bars fill.
      const tdeeEl = document.getElementById('demo-wgc-tdee');
      const cutEl  = document.getElementById('demo-wgc-cut');
      if (!tdeeEl || !cutEl) return;
      tdeeEl.textContent = '0';
      cutEl.textContent = '0';
      await countTo(tdeeEl, 2630, 700);
      await sleep(200);
      await countTo(cutEl, 2100, 600);
      // Bars transition via CSS when .filled is present — already set by caller.
    }

    async function runRotation(cfg) {
      // Phase 0: reset
      main.dataset.rotation = cfg.id;
      main.dataset.phase = 'composer';
      clearBubbleContents();
      document.querySelectorAll('.demo-widget').forEach((w) => w.classList.remove('skeleton', 'filled'));
      setActiveSidebar(cfg.slot);
      threadTitle.textContent = cfg.threadTitle;
      threadMeta.textContent = 'EMERSUS · 1 WIDGET';
      chromeTitle.textContent = cfg.chromeTitle;

      // Phase 1: type prompt into composer
      await typeComposer(cfg.prompt, 40, 10);
      await sleep(1200);

      // Phase 2: send-flight — user bubble appears, composer clears, hint pulses
      userBubble.textContent = cfg.prompt;
      composerHint.classList.add('pulse');
      main.dataset.phase = 'send';
      await sleep(250);
      composerInput.innerHTML = '<span class="composer-placeholder">Ask anything…</span>';
      composerHint.classList.remove('pulse');
      main.dataset.phase = 'assist';

      // Phase 3: thinking dots (0.4 s)
      showThinkingDots();
      await sleep(400);

      // Phase 4: intro text streams
      await streamText(introText, cfg.intro, 14);

      // Phase 5: widget skeleton (0.2 s)
      const widget = document.querySelector(`.demo-widget[data-widget="${cfg.id}"]`);
      widget.classList.add('skeleton');
      await sleep(200);

      // Phase 6: widget filled — values animate in (CSS transitions)
      widget.classList.remove('skeleton');
      widget.classList.add('filled');
      if (cfg.id === 'c') { await animateWidgetC(); }
      await sleep(1400);

      // Phase 7: cite pill
      renderCite(cfg.cite);
      citePill.classList.add('show');
      await sleep(1800);

      // Phase 8: thread-swap fade-out before next rotation
      main.dataset.swapping = 'true';
      chromeTitle.style.opacity = '0.15';
      await sleep(350);
      // The next rotation's Phase 0 will reset; just remove the transition marker.
      main.removeAttribute('data-swapping');
      chromeTitle.style.opacity = '';
    }

    async function loop() {
      let i = 0;
      while (true) {
        await runRotation(ROTATIONS[i % ROTATIONS.length]);
        i++;
      }
    }

    const reduced = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function renderStaticA() {
      // Rotation A, fully filled, no animation. Used for reduced-motion users.
      const cfg = ROTATIONS[0];
      main.dataset.rotation = 'a';
      main.dataset.phase = 'assist';
      setActiveSidebar(cfg.slot);
      threadTitle.textContent = cfg.threadTitle;
      threadMeta.textContent = 'EMERSUS · 1 WIDGET';
      chromeTitle.textContent = cfg.chromeTitle;
      userBubble.textContent = cfg.prompt;
      introText.innerHTML = cfg.intro;
      const widget = document.querySelector('.demo-widget[data-widget="a"]');
      widget.classList.add('filled');
      renderCite(cfg.cite);
      citePill.classList.add('show');
      composerInput.innerHTML = '<span class="composer-placeholder">Ask anything…</span>';
    }

    if (reduced) { renderStaticA(); return; }

    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { loop(); obs.disconnect(); }
      });
    }, { threshold: 0.3 });
    obs.observe(demoRoot);
  })();
</script>
```

Also append a small extra CSS rule to `shared/landing.css` to style the cite pill inner spans, since `renderCite()` generates them:

```css
.cite-pill .tag { color: var(--dim); }
```

- [ ] **Step 2: Browser verification — full loop**

Reload the landing page. Scroll to `#demo`. Expected sequence (watch for ~45 s):

1. Composer types "How much protein per day for hypertrophy?" char by char
2. After a pause, the typed string appears as a user bubble at the top; composer clears; SEND pulses
3. Three-dot thinking animation in the assistant bubble (~0.4 s)
4. Intro text streams in ("The evidence centers on...")
5. Widget A fades in as skeleton (muted), then curve draws left-to-right, plateau line + dot + callout fade in
6. Citation pill "MORTON ET AL · BR J SPORTS MED · 2018 · HIGH" fades in below
7. Thread + chrome titles fade, sidebar highlight slides to "Creatine vs. beta-alanine", new thread title fades in
8. Rotation B plays (evidence matrix). Cells fade-scale in column by column.
9. Rotation C plays (TDEE + macros). Numbers count up, then cut target counts up, then macro bars grow.
10. Loop returns to rotation A.

Check DevTools console for errors — none expected. Let it loop twice to catch any stuck states.

- [ ] **Step 3: Commit**

```bash
git add index.html shared/landing.css
git commit -m "feat(landing): rotation state machine for live-widget demo"
```

---

## Task 9: Reduced-motion fallback verification

**Files:**
- No file changes — verification only

The state machine already branches on `prefers-reduced-motion: reduce` in Task 8. This task is pure verification.

- [ ] **Step 1: Simulate reduced motion in DevTools**

Open DevTools → Rendering panel (Cmd/Ctrl+Shift+P → "Show Rendering") → set "Emulate CSS media feature prefers-reduced-motion" to "reduce". Reload the page and scroll to `#demo`.

Expected: rotation A renders fully on first paint — user bubble shows "How much protein per day for hypertrophy?", intro text fully visible, widget A curve fully drawn with plateau + callout + dot visible, citation pill showing MORTON ET AL... HIGH. No animation loops, no typing, no rotation. Composer shows "Ask anything…" placeholder.

- [ ] **Step 2: Restore and commit (no changes needed)**

Restore reduced-motion emulation to "no preference" and reload to confirm animations work again. No commit if behavior is correct — the earlier task's commit covers this. If behavior is broken, debug the `renderStaticA()` function in the Task 8 script and re-commit.

---

## Task 10: Mobile breakpoint for evidence matrix + overall mobile pass

**Files:**
- Modify: `shared/landing.css` — add mobile media query

On narrow screens, the evidence matrix's two columns need to stack. Also confirm nothing else breaks at narrow widths.

- [ ] **Step 1: Append mobile breakpoint**

Append to `shared/landing.css`:

```css
/* ===== DEMO WIDGET MOBILE ===== */
@media (max-width: 520px) {
  .wg-b-grid { grid-template-columns: 1fr; gap: 10px; }
  .wg-c-macro { grid-template-columns: 60px 1fr 44px; }
  .wg-a-chart .wg-ticks text:nth-child(2),
  .wg-a-chart .wg-ticks text:nth-child(4) { display: none; }
  .wg-c-inputs { font-size: 9.5px; }
  .wg-c-kcal { font-size: 20px; }
}
```

- [ ] **Step 2: Browser verification — mobile viewport**

In DevTools, switch to mobile device emulation (iPhone 12 or similar, 390×844). Reload and scroll to `#demo`. Expected:

- Sidebar is hidden (already handled by existing `@media (max-width: 720px)` at `shared/landing.css:538`)
- Rotation A: chart still readable, tick labels thin but legible, curve draws cleanly
- Rotation B: columns stack vertically, each full-width
- Rotation C: inputs row wraps gracefully, kcal readouts slightly smaller, macro bars fit within the card
- Composer typing still readable; no horizontal overflow
- Nothing clips outside `.demo-frame`

Widen back to desktop (~1440px) and confirm no regression.

- [ ] **Step 3: Commit**

```bash
git add shared/landing.css
git commit -m "feat(landing): mobile breakpoint for demo widgets"
```

---

## Task 11: Final pass — both palettes + long-loop observation + cleanup

**Files:**
- No file changes — final verification

This is the "ship it" gate. Run the demo through both palettes for a full minute each and look for stuck states, flicker, or orphaned elements.

- [ ] **Step 1: Dark palette (Graphite·Jade) full-loop watch**

In DevTools console: `document.documentElement.setAttribute('data-theme', 'mint');` then reload and scroll to `#demo`. Watch for 90 s (two full loops). Expected: all three rotations play cleanly, transitions feel smooth, no visual regressions, cite pills readable, matrix pills clearly distinguishable (green HIGH vs amber MODERATE).

- [ ] **Step 2: Light palette (Paper·Royal) full-loop watch**

In DevTools console: `document.documentElement.setAttribute('data-theme', 'paper');` then reload and scroll to `#demo`. Watch for 90 s. Same expectations — check especially that skeleton shimmer contrast is visible (dark glow on light background may need adjustment) and that amber pill still reads well.

If either palette has a visual issue, debug inline — likely fixes involve swapping `var(--accent-glow)` for a higher-contrast token, or adjusting `.wg-c-bar.carbs/fat` color-mix ratios.

- [ ] **Step 3: Check console + network tab**

DevTools Console: zero errors, zero warnings from the new script. Network tab: no new requests vs. before (all widgets are inline DOM). Performance tab (optional): initial paint time unchanged.

- [ ] **Step 4: Final commit if any tweaks were made**

If step 1 or 2 required CSS tweaks:

```bash
git add shared/landing.css
git commit -m "fix(landing): palette contrast tweaks for demo rotation"
```

Otherwise skip this step.

- [ ] **Step 5: Prompt user before pushing**

Per `CLAUDE.md`, pushing to `main` auto-deploys via webhook. Before pushing, summarize changes to the user and ask for explicit go-ahead. Do not push autonomously even if the loop completed cleanly.

Once user approves:

```bash
git push origin main
```

Then verify deploy:

```bash
ssh hetzner 'pm2 logs webhook --lines 40 --nostream'
ssh hetzner 'pm2 logs emersus-api --lines 20 --nostream'
```

Expect: webhook triggered, `git pull` succeeded, `npm install` no errors, `npm run build` no errors, `pm2 restart emersus-api` success. Open `https://emersus.ai/` and scroll to the demo — confirm the rotation plays live.

---

## Self-review checklist

- **Spec coverage:** rotations A/B/C all have dedicated tasks (3, 4, 5), per-rotation animation sequence mapped to Task 8 state machine phases, sidebar + chrome title updates handled in Task 8, reduced-motion in Task 9, mobile in Task 10, palettes in Task 11. Composer typing + send-flight in Tasks 2 + 8. Skeleton→fill covered in Task 6. ✓
- **Placeholder scan:** no TBD / "implement later" / bare "handle errors". The only "tune in browser" notes (path `d`, bar color-mix fallback, palette contrast tweaks) are explicit calibration steps, not deferred work. ✓
- **Type consistency:** DOM IDs (`demo-user-bubble`, `demo-intro-text`, `demo-cite-pill`, `demo-thread-title`, `demo-thread-meta`, `demo-composer-input`, `demo-composer-hint`, `demo-wgc-tdee`, `demo-wgc-cut`) used identically in HTML (Tasks 1, 5) and JS (Task 8). `data-rotation` values `a|b|c` match between HTML, CSS, and JS. `.demo-widget[data-widget=X]` selectors consistent. Citation pill class structure (`.grade.strong`, `.grade.mod`, `.grade.std`) matches between CSS (Task 2) and JS `renderCite()` (Task 8). One note: Task 2 defines `.grade.mod` but Task 8 uses `.grade.std` for rotation C — `.std` is defined in Task 2's final CSS block, so consistent. ✓
- **Gotcha check:** Task 7 Step 1 includes a broken sibling-combinator selector; Step 2 explicitly fixes it. Task 8 Step 1 explicitly notes the cite pill tag needs a small extra CSS rule (handled inline). Reduced-motion path (`renderStaticA`) manually applies all end-state classes that normally get applied by the loop — verified visually in Task 9. ✓

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-04-17-landing-demo-live-widget-rotation.md`.

**Two execution options:**

1. **Subagent-driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline execution** — I execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
