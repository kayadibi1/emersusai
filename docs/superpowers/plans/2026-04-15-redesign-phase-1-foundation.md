# Frontend Redesign · Phase 1 · Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the design tokens, theme switcher, and shared chrome CSS (sidebar, top bar, tabs, buttons, forms, cards) that every subsequent phase (chat, train, nutrition, progress, profile, auth, static) consumes.

**Architecture:** A single `shared/design-tokens.css` file defines both palettes (Graphite · Jade for dark, Paper · Royal for light) as CSS custom properties scoped under `[data-theme="mint"]` / `[data-theme="paper"]`. A new `shared/theme.js` ES module handles theme resolution + persistence. All existing page-level CSS files import the tokens file. Subsequent phases will add page-specific CSS on top of this foundation.

**Tech Stack:** Vanilla CSS custom properties. ES modules. Node's built-in test runner (`node --test`, already in `package.json`). No bundler, no TypeScript, no JSDOM — `theme.js` is factored so pure logic is unit-tested and DOM effects are in a thin wrapper.

**Prerequisite:** The 2026-04-14 UI strip was approved but hasn't been implemented yet (`shared/site.css` still exists). This plan **does not** depend on the strip being done — it adds new files and appends to existing CSS. The strip can happen independently before or after.

**Spec reference:** `docs/superpowers/specs/2026-04-15-frontend-redesign-design.md` — sections "Design System" (colors, typography, components) and "Behaviors → Global patterns".

---

## File Structure

- **Create:** `shared/design-tokens.css` — palette + typography + spacing + base reset (consumed by every other CSS file)
- **Create:** `shared/theme.js` — theme resolver + DOM applier + localStorage persistence
- **Create:** `shared/chrome.css` — shared component patterns (sidebar, top bar, tabs, buttons, forms, cards) used by every authenticated page
- **Create:** `tests/unit/shared/theme.test.js` — pure-logic tests for `theme.js`
- **Modify:** `index.html` — load `design-tokens.css` + `theme.js` at the page's current locations (incremental; landing redesign happens in its own phase)
- **Modify:** `chat/index.html` — load `design-tokens.css` + `chrome.css` + `theme.js`
- **Modify:** `app/index.html`, `app/profile/index.html`, `app/nutrition/index.html`, `app/workout/index.html`, `app/progress/index.html` — load `design-tokens.css` + `chrome.css` + `theme.js`
- **Modify:** `auth/login/index.html`, `auth/signup/index.html`, `auth/forgot-password/index.html`, `auth/reset-password/index.html` — load `design-tokens.css` + `theme.js`
- **Modify:** `contact/index.html`, `privacy/index.html`, `terms/index.html` — load `design-tokens.css` + `theme.js`

Files are loaded via `<link rel="stylesheet">` / `<script type="module">`. No bundler, no build step.

---

## Task 1: Scaffold the theme.js test file

**Files:**
- Create: `tests/unit/shared/theme.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/shared/theme.test.js`:

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInitialTheme, validateTheme, VALID_THEMES } from '../../../shared/theme.js';

describe('theme.js — pure logic', () => {
  test('VALID_THEMES is the canonical list', () => {
    assert.deepEqual(VALID_THEMES, ['mint', 'paper']);
  });

  test('validateTheme returns the theme when valid', () => {
    assert.equal(validateTheme('mint'), 'mint');
    assert.equal(validateTheme('paper'), 'paper');
  });

  test('validateTheme returns null for unknown themes', () => {
    assert.equal(validateTheme('neon'), null);
    assert.equal(validateTheme(''), null);
    assert.equal(validateTheme(null), null);
    assert.equal(validateTheme(undefined), null);
  });

  test('resolveInitialTheme prefers saved value when valid', () => {
    const result = resolveInitialTheme({ saved: 'paper', systemPrefersLight: false });
    assert.equal(result, 'paper');
  });

  test('resolveInitialTheme falls back to system preference when saved is invalid', () => {
    assert.equal(resolveInitialTheme({ saved: 'neon', systemPrefersLight: true }), 'paper');
    assert.equal(resolveInitialTheme({ saved: 'neon', systemPrefersLight: false }), 'mint');
  });

  test('resolveInitialTheme defaults to mint when nothing is known', () => {
    assert.equal(resolveInitialTheme({ saved: null, systemPrefersLight: false }), 'mint');
    assert.equal(resolveInitialTheme({ saved: undefined, systemPrefersLight: undefined }), 'mint');
  });

  test('resolveInitialTheme picks paper when system prefers light and no saved value', () => {
    assert.equal(resolveInitialTheme({ saved: null, systemPrefersLight: true }), 'paper');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern=theme`
Expected: FAIL with "Cannot find module '../../../shared/theme.js'"

---

## Task 2: Create theme.js with pure logic

**Files:**
- Create: `shared/theme.js`

- [ ] **Step 1: Write the minimal implementation**

Create `shared/theme.js`:

```javascript
// shared/theme.js — palette resolver + DOM applier.
// Pure functions (resolveInitialTheme, validateTheme) are unit-tested.
// DOM effects (applyTheme, bindSwitcher) are thin, tested manually.

export const VALID_THEMES = ['mint', 'paper'];
const STORAGE_KEY = 'emersus-theme';

/**
 * @param {string | null | undefined} theme
 * @returns {string | null} the theme if valid, else null
 */
export function validateTheme(theme) {
  return VALID_THEMES.includes(theme) ? theme : null;
}

/**
 * @param {{ saved: string | null | undefined, systemPrefersLight: boolean | undefined }} ctx
 * @returns {'mint' | 'paper'}
 */
export function resolveInitialTheme({ saved, systemPrefersLight }) {
  const validSaved = validateTheme(saved);
  if (validSaved) return validSaved;
  return systemPrefersLight === true ? 'paper' : 'mint';
}

/**
 * Apply a theme to the document root. DOM effect.
 * @param {string} theme
 */
export function applyTheme(theme) {
  const valid = validateTheme(theme) || 'mint';
  document.documentElement.setAttribute('data-theme', valid);
  try { localStorage.setItem(STORAGE_KEY, valid); } catch (_) {}
  document.dispatchEvent(new CustomEvent('emersus:themechange', { detail: { theme: valid } }));
}

/**
 * Read saved theme from localStorage. DOM effect (storage access).
 * @returns {string | null}
 */
export function readSavedTheme() {
  try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
}

/**
 * Detect system preference. DOM effect.
 * @returns {boolean}
 */
export function systemPrefersLight() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

/**
 * Bootstrap: set the initial theme on page load.
 * Call once, early (before first paint ideally).
 */
export function bootTheme() {
  const theme = resolveInitialTheme({
    saved: readSavedTheme(),
    systemPrefersLight: systemPrefersLight(),
  });
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

/**
 * Bind click handlers for palette swatches.
 * Expects swatches with `data-theme-swatch="mint"` or `data-theme-swatch="paper"`.
 * Marks the active one with `.active`.
 */
export function bindSwitcher(root = document) {
  const swatches = root.querySelectorAll('[data-theme-swatch]');
  const mark = (theme) => {
    swatches.forEach((s) => s.classList.toggle('active', s.dataset.themeSwatch === theme));
  };
  const current = document.documentElement.getAttribute('data-theme') || 'mint';
  mark(current);

  swatches.forEach((s) => {
    s.addEventListener('click', () => {
      const theme = s.dataset.themeSwatch;
      applyTheme(theme);
      mark(theme);
    });
  });

  document.addEventListener('emersus:themechange', (e) => mark(e.detail.theme));
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test:unit -- --test-name-pattern=theme`
Expected: PASS — all 7 tests green.

- [ ] **Step 3: Commit**

```bash
git add shared/theme.js tests/unit/shared/theme.test.js
git commit -m "feat(theme): pure theme resolver + DOM applier (tdd)"
```

---

## Task 3: Create design-tokens.css

**Files:**
- Create: `shared/design-tokens.css`

- [ ] **Step 1: Create the file with both palettes + base reset**

Create `shared/design-tokens.css`:

```css
/* shared/design-tokens.css
 * Canonical source for the Emersus redesign palettes + typography.
 * Consumed by every other stylesheet via @import at top of file.
 * Two palettes, runtime-switchable via data-theme on <html>.
 */

/* ---------- FONT LOADING ---------- */
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap');

/* ---------- PALETTE: GRAPHITE · JADE (dark, default) ---------- */
[data-theme="mint"] {
  --bg: #0a0a0b;
  --sidebar-bg: #0c0c0e;
  --surface: #141417;
  --surface-faint: rgba(255,255,255,0.02);
  --recessed: rgba(0,0,0,0.20);
  --composer-bg: rgba(255,255,255,0.015);
  --ink: #ededee;
  --muted: #8a8a8f;
  --dim: #55555a;
  --line: rgba(255,255,255,0.06);
  --line-strong: rgba(255,255,255,0.10);
  --grid-line: rgba(255,255,255,0.018);
  --nav-bg: rgba(10,10,11,0.72);
  --switch-bg: rgba(15,15,17,0.92);
  --accent: #34d399;
  --accent-text: #04221a;
  --accent-soft: rgba(52,211,153,0.10);
  --accent-line: rgba(52,211,153,0.34);
  --accent-glow: rgba(52,211,153,0.10);
  --citation: #8ab4f8;
  --warning: #fbbf24;
  --danger: #f87171;
  --info: #60a5fa;
  --protein: #4d8df5;
  --carbs: #78dc14;
  --fat: #e8a838;
  --frame-from: #141416;
  --frame-to: #0d0d10;
  --head-from: #ffffff;
  --head-to: #b4b4b8;
}

/* ---------- PALETTE: PAPER · ROYAL (light) ---------- */
[data-theme="paper"] {
  --bg: #f4efe5;
  --sidebar-bg: #ece5d6;
  --surface: #ece5d6;
  --surface-faint: rgba(26,24,19,0.025);
  --recessed: rgba(0,0,0,0.025);
  --composer-bg: rgba(26,24,19,0.02);
  --ink: #1a1813;
  --muted: #5e564a;
  --dim: #8f8676;
  --line: rgba(26,24,19,0.10);
  --line-strong: rgba(26,24,19,0.18);
  --grid-line: rgba(26,24,19,0.035);
  --nav-bg: rgba(244,239,229,0.82);
  --switch-bg: rgba(250,246,237,0.94);
  --accent: #3b82f6;
  --accent-text: #ffffff;
  --accent-soft: rgba(59,130,246,0.10);
  --accent-line: rgba(59,130,246,0.36);
  --accent-glow: rgba(59,130,246,0.11);
  --citation: #b37214;
  --warning: #c78a0a;
  --danger: #c53030;
  --info: #2563eb;
  --protein: #2d5bda;
  --carbs: #4a7c0f;
  --fat: #a66a14;
  --frame-from: #faf6ee;
  --frame-to: #ece5d6;
  --head-from: #1a1813;
  --head-to: #6e6557;
}

/* ---------- BASE RESET + TYPOGRAPHY ---------- */
*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--ink);
  transition: background .4s, color .4s;
}

body {
  font-family: 'Space Grotesk', -apple-system, system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  letter-spacing: -0.005em;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Utility: opt-in monospace */
.mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

/* Tabular-nums for numeric displays */
.nums { font-variant-numeric: tabular-nums; }
```

- [ ] **Step 2: Commit**

```bash
git add shared/design-tokens.css
git commit -m "feat(design-tokens): add palette vars + base reset + font loading"
```

---

## Task 4: Create chrome.css with palette switcher

**Files:**
- Create: `shared/chrome.css`

- [ ] **Step 1: Create the file with palette-switch widget styles**

Create `shared/chrome.css`:

```css
/* shared/chrome.css
 * Shared component patterns used by authenticated app pages.
 * Depends on design-tokens.css (must be loaded first).
 * Subsequent redesign phases add page-specific styles on top.
 */
@import url('./design-tokens.css');

/* ========== PALETTE SWITCHER ========== */
.palette-switch {
  position: fixed; top: 16px; right: 16px; z-index: 100;
  background: var(--switch-bg);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  padding: 8px;
  display: flex; gap: 6px;
  box-shadow: 0 8px 24px -12px rgba(0,0,0,0.4);
}
.palette-swatch {
  width: 28px; height: 22px; border-radius: 5px;
  background: var(--sw-bg);
  border: 1px solid rgba(128,128,128,0.25);
  cursor: pointer; position: relative;
  outline: 2px solid transparent;
  outline-offset: 2px;
  transition: transform .15s;
}
.palette-swatch:hover { transform: scale(1.06); }
.palette-swatch.active { outline-color: var(--accent); }
.palette-swatch::after {
  content: ""; position: absolute;
  bottom: 3px; right: 3px;
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--sw-accent);
  box-shadow: 0 0 4px var(--sw-accent);
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/chrome.css
git commit -m "feat(chrome): palette switcher widget styles"
```

---

## Task 5: Add app-shell grid + sidebar base styles to chrome.css

**Files:**
- Modify: `shared/chrome.css` (append)

- [ ] **Step 1: Append sidebar base styles**

Append to `shared/chrome.css`:

```css

/* ========== APP SHELL (authenticated pages) ========== */
.app-shell {
  display: grid;
  grid-template-columns: 280px 1fr;
  height: 100vh;
  overflow: hidden;
}

/* ========== SIDEBAR ========== */
.sidebar {
  background: var(--sidebar-bg);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: background .4s;
}

.side-head {
  padding: 18px 18px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  font-family: 'JetBrains Mono';
  font-weight: 600;
  font-size: 12.5px;
  letter-spacing: 0.28em;
  color: var(--ink);
  text-decoration: none;
  transition: color .14s;
}
.brand:hover { color: var(--accent); }

/* Primary CTA inside sidebar (label varies per section) */
.side-actions { padding: 6px 12px 12px; }

.side-primary-btn {
  width: 100%;
  display: flex;
  align-items: center; justify-content: center;
  gap: 8px;
  background: transparent;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  color: var(--ink);
  padding: 9px 12px;
  font-family: 'Space Grotesk';
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all .14s;
}
.side-primary-btn:hover {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.side-primary-btn .plus { color: var(--accent); font-weight: 600; }

/* Search input */
.side-search { padding: 0 12px 14px; }
.side-search input {
  width: 100%;
  background: var(--surface-faint);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 12px;
  font-family: 'Space Grotesk';
  font-size: 13px;
  color: var(--muted);
}
.side-search input::placeholder { color: var(--dim); }

/* Section nav (Chat / Train / Nutrition / Progress / Profile) */
.sections { padding: 0 8px 8px; }
.section-label {
  font-family: 'JetBrains Mono';
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--dim);
  padding: 8px 10px 6px;
}
.section-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px;
  border-radius: 7px;
  font-family: 'Space Grotesk';
  font-size: 13.5px;
  color: var(--muted);
  cursor: pointer;
  transition: all .12s;
  border: 1px solid transparent;
  text-decoration: none;
}
.section-item:hover { background: var(--surface-faint); color: var(--ink); }
.section-item.active {
  background: var(--accent-soft);
  color: var(--ink);
  border-color: var(--accent-line);
  border-left: 2px solid var(--accent);
  padding-left: 9px;
  font-weight: 500;
}
.section-item .s-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--muted);
  flex-shrink: 0;
}
.section-item.active .s-dot {
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
}

/* Thread list (scrollable) */
.thread-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 14px;
}
.thread-scroll::-webkit-scrollbar { width: 8px; }
.thread-scroll::-webkit-scrollbar-track { background: transparent; }
.thread-scroll::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }

.thread-group { margin-bottom: 12px; }
.thread-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px;
  border-radius: 7px;
  font-family: 'Space Grotesk';
  font-size: 12.5px;
  color: var(--muted);
  cursor: pointer;
  transition: all .12s;
  line-height: 1.3;
}
.thread-item:hover { background: var(--surface-faint); color: var(--ink); }
.thread-item .title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.thread-item .dot {
  width: 4px; height: 4px; border-radius: 50%;
  background: var(--muted);
  flex-shrink: 0;
}
.thread-item.active {
  background: var(--accent-soft);
  color: var(--ink);
  border-left: 2px solid var(--accent);
  padding-left: 9px;
}

/* User card at bottom */
.user-card {
  border-top: 1px solid var(--line);
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: background .14s;
}
.user-card:hover { background: var(--surface-faint); }
.user-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
  font-family: 'Space Grotesk';
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.user-meta { flex: 1; min-width: 0; }
.user-name { font-size: 13px; color: var(--ink); font-weight: 500; }
.user-plan {
  font-family: 'JetBrains Mono';
  font-size: 9.5px;
  color: var(--dim);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin-top: 2px;
}
.user-card .menu { color: var(--dim); font-size: 16px; }

/* ========== MAIN PANE ========== */
.main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* Mobile: sidebar hidden, main full width */
@media (max-width: 900px) {
  .app-shell { grid-template-columns: 1fr; }
  .sidebar { display: none; }
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/chrome.css
git commit -m "feat(chrome): app-shell grid + sidebar base styles"
```

---

## Task 6: Add top-bar + tabs + buttons to chrome.css

**Files:**
- Modify: `shared/chrome.css` (append)

- [ ] **Step 1: Append top-bar + tabs + buttons**

Append to `shared/chrome.css`:

```css

/* ========== TOP BAR (inside .main) ========== */
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 28px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
  gap: 16px;
}

/* ========== TAB BARS ========== */
/* Centered tabs (modality/filter tabs on Train/Nutrition/Progress) */
.tabs {
  display: flex;
  justify-content: center;
  gap: 40px;
  border-bottom: 1px solid var(--line);
  padding: 0 28px;
  background: var(--bg);
}
.tab {
  background: transparent;
  border: 0;
  padding: 18px 2px 16px;
  font-family: 'JetBrains Mono';
  font-size: 11px;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: var(--muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color .14s, border-color .14s;
  font-weight: 500;
}
.tab:hover { color: var(--ink); }
.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.tab.soon::after {
  content: "SOON";
  font-size: 8.5px; letter-spacing: 0.2em;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
  padding: 2px 5px;
  border-radius: 3px;
  font-weight: 600;
  margin-left: 6px;
}

/* Sub-tabs (smaller, inside a page, e.g., Active/History) */
.sub-tabs {
  display: flex; gap: 6px;
  padding: 12px 28px;
  border-bottom: 1px solid var(--line);
}
.sub-tab {
  background: transparent;
  border: 1px solid transparent;
  padding: 6px 12px;
  border-radius: 6px;
  font-family: 'Space Grotesk';
  font-size: 12.5px;
  color: var(--muted);
  cursor: pointer;
  font-weight: 500;
  transition: all .14s;
}
.sub-tab:hover { color: var(--ink); background: var(--surface-faint); }
.sub-tab.active {
  color: var(--ink);
  background: var(--surface-faint);
  border-color: var(--line);
}

/* Period pill group (Week · Month · 3M · Year) */
.period-group {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-faint);
}
.period-group button {
  background: transparent;
  border: 0;
  padding: 7px 14px;
  font-family: 'JetBrains Mono';
  font-size: 10.5px;
  letter-spacing: 0.18em;
  color: var(--muted);
  cursor: pointer;
  transition: all .14s;
  font-weight: 500;
  text-transform: uppercase;
}
.period-group button:not(:last-child) {
  border-right: 1px solid var(--line);
}
.period-group button:hover { color: var(--ink); }
.period-group button.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

/* ========== BUTTONS ========== */
.btn {
  background: transparent;
  border: 1px solid var(--line-strong);
  color: var(--ink);
  padding: 8px 14px;
  border-radius: 7px;
  font-family: 'Space Grotesk';
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all .14s;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  text-decoration: none;
}
.btn:hover {
  background: var(--surface-faint);
  border-color: var(--accent-line);
}
.btn-sm  { padding: 6px 10px; font-size: 12px; }
.btn-icon { padding: 8px 10px; }
.btn-accent {
  background: var(--accent);
  color: var(--accent-text);
  border-color: var(--accent);
  font-weight: 600;
}
.btn-accent:hover {
  filter: brightness(1.08);
  background: var(--accent);
}
.btn-danger {
  border-color: rgba(248,113,113,0.3);
  color: var(--danger);
}
.btn-danger:hover {
  background: rgba(248,113,113,0.08);
  border-color: rgba(248,113,113,0.5);
}

/* Auto-save indicator */
.autosave-hint {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: 'JetBrains Mono';
  font-size: 10px;
  letter-spacing: 0.22em;
  color: var(--dim);
}
.autosave-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: emersus-pulse 2.5s infinite;
}
@keyframes emersus-pulse {
  0%   { box-shadow: 0 0 0 0 var(--accent-line); }
  70%  { box-shadow: 0 0 0 8px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/chrome.css
git commit -m "feat(chrome): top-bar + tabs + buttons + autosave indicator"
```

---

## Task 7: Add form controls to chrome.css

**Files:**
- Modify: `shared/chrome.css` (append)

- [ ] **Step 1: Append form control styles**

Append to `shared/chrome.css`:

```css

/* ========== FORM CONTROLS ========== */

/* Field wrapper */
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-family: 'JetBrains Mono';
  font-size: 10px;
  letter-spacing: 0.22em;
  color: var(--muted);
  text-transform: uppercase;
  font-weight: 500;
  display: flex;
  justify-content: space-between;
}
.field-label .hint {
  color: var(--dim);
  letter-spacing: 0.14em;
  font-size: 9.5px;
}
.field-helper {
  font-family: 'JetBrains Mono';
  font-size: 9.5px;
  letter-spacing: 0.14em;
  color: var(--dim);
  margin-top: 2px;
}
.field-helper.accent { color: var(--accent); }

/* Text input wrapper (supports suffix icons) */
.field-input {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--composer-bg);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  transition: border-color .14s, box-shadow .14s;
}
.field-input:focus-within {
  border-color: var(--accent-line);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.field-input input, .field-input textarea {
  flex: 1;
  background: transparent;
  border: 0;
  outline: 0;
  padding: 11px 14px;
  font-family: 'Space Grotesk';
  font-size: 14.5px;
  color: var(--ink);
  letter-spacing: -0.005em;
}
.field-input input::placeholder, .field-input textarea::placeholder {
  color: var(--dim);
}

/* Numeric input with unit suffix (weight, reps, kg, cm) */
.num-input {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  background: var(--bg);
  overflow: hidden;
  transition: border-color .14s;
}
.num-input:focus-within { border-color: var(--accent-line); }
.num-input input {
  background: transparent;
  border: 0;
  padding: 8px 10px;
  width: 80px;
  font-family: 'Space Grotesk';
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  text-align: center;
  outline: 0;
}
.num-input .unit {
  font-family: 'JetBrains Mono';
  font-size: 10.5px;
  color: var(--muted);
  letter-spacing: 0.14em;
  padding: 0 12px 0 4px;
}

/* Pill group (segmented control) */
.pill-group {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--recessed);
  flex-wrap: wrap;
}
.pill-group button {
  background: transparent;
  border: 0;
  padding: 8px 14px;
  font-family: 'Space Grotesk';
  font-size: 12.5px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  transition: all .14s;
  letter-spacing: -0.005em;
}
.pill-group button:not(:last-child) {
  border-right: 1px solid var(--line);
}
.pill-group button:hover { color: var(--ink); }
.pill-group button.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

/* Toggle switch */
.toggle {
  position: relative;
  width: 40px; height: 22px;
  border-radius: 11px;
  background: var(--line);
  border: 1px solid var(--line);
  cursor: pointer;
  transition: background .18s;
}
.toggle::after {
  content: "";
  position: absolute;
  top: 2px; left: 2px;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: var(--muted);
  transition: transform .18s, background .18s;
}
.toggle.on {
  background: var(--accent-soft);
  border-color: var(--accent-line);
}
.toggle.on::after {
  transform: translateX(18px);
  background: var(--accent);
}

/* Card (used as form container + as content card everywhere) */
.card {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface-faint);
  overflow: hidden;
}
.card-head {
  padding: 18px 24px 14px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid var(--line);
  background: var(--recessed);
  gap: 16px;
}
.card-title {
  font-family: 'Space Grotesk';
  font-size: 15.5px;
  font-weight: 500;
  color: var(--ink);
  letter-spacing: -0.01em;
}
.card-sub {
  font-family: 'JetBrains Mono';
  font-size: 9.5px;
  letter-spacing: 0.18em;
  color: var(--dim);
}
.card-body { padding: 8px 24px; }
```

- [ ] **Step 2: Commit**

```bash
git add shared/chrome.css
git commit -m "feat(chrome): form controls (inputs, pills, toggles, cards)"
```

---

## Task 8: Wire theme.js into an existing public page (landing)

**Files:**
- Modify: `index.html` (landing)

- [ ] **Step 1: Locate the head tag and existing stylesheet links**

Run: `sed -n '1,20p' index.html` to see the current head.

- [ ] **Step 2: Add design-tokens.css link + theme.js module**

Using Edit (not Bash), modify `index.html`: find the existing `<link rel="stylesheet" ...>` tag(s) and ADD the two lines below just **before** it (so tokens load first):

```html
  <link rel="stylesheet" href="/shared/design-tokens.css?v=redesign-1">
  <script type="module">
    import { bootTheme } from '/shared/theme.js?v=redesign-1';
    bootTheme();
  </script>
```

The inline module sets `data-theme` on `<html>` before first paint.

- [ ] **Step 3: Verify by loading the page**

Run: `node server.js` in one terminal, then `curl -s http://127.0.0.1:3001/ | grep -E "design-tokens|theme.js"`
Expected output: both references present.

- [ ] **Step 4: Manually test in browser**

Open `http://127.0.0.1:3001/` in a browser. In devtools, run:

```javascript
document.documentElement.getAttribute('data-theme')
```

Expected: `"mint"` (or `"paper"` if your OS is in light mode).

Then in devtools:

```javascript
localStorage.setItem('emersus-theme', 'paper'); location.reload();
```

Expected after reload: `data-theme="paper"` on html.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(landing): load design-tokens.css + bootstrap theme.js"
```

---

## Task 9: Wire theme.js into `/chat/index.html`

**Files:**
- Modify: `chat/index.html`

- [ ] **Step 1: Confirm current head structure**

Run: `sed -n '1,30p' chat/index.html`

- [ ] **Step 2: Add tokens + chrome + theme.js**

Using Edit, add the following **before** the existing `<link>` to `shared/chat.css`:

```html
  <link rel="stylesheet" href="/shared/design-tokens.css?v=redesign-1">
  <link rel="stylesheet" href="/shared/chrome.css?v=redesign-1">
  <script type="module">
    import { bootTheme } from '/shared/theme.js?v=redesign-1';
    bootTheme();
  </script>
```

- [ ] **Step 3: Smoke-test in browser**

Load `http://127.0.0.1:3001/chat/`. Confirm the page still renders (the new files don't override existing styles yet — they just add new tokens/classes). Inspect `<html>` — it should now have `data-theme="mint"` or `"paper"`.

- [ ] **Step 4: Commit**

```bash
git add chat/index.html
git commit -m "feat(chat): load design-tokens.css + chrome.css + theme.js"
```

---

## Task 10: Wire theme.js into all `/app/**` pages

**Files:**
- Modify: `app/index.html`
- Modify: `app/profile/index.html`
- Modify: `app/nutrition/index.html`
- Modify: `app/workout/index.html`
- Modify: `app/progress/index.html`
- Modify: `app/workout/session/index.html`
- Modify: `app/workout/cardio/index.html`
- Modify: `app/workout/swim/index.html`
- Modify: `app/workout/climb/index.html`
- Modify: `app/progress/session/index.html`
- Modify: `app/progress/exercise/index.html`
- Modify: `app/_debug/index.html` (if still present — it was deleted in 7166bcf3; skip if missing)

- [ ] **Step 1: Inventory existing app pages**

Run: `find app -name 'index.html' -type f | sort`

- [ ] **Step 2: Add tokens + chrome + theme.js to each**

For **each** file listed above, use Edit to add the same three lines before the first existing stylesheet link:

```html
  <link rel="stylesheet" href="/shared/design-tokens.css?v=redesign-1">
  <link rel="stylesheet" href="/shared/chrome.css?v=redesign-1">
  <script type="module">
    import { bootTheme } from '/shared/theme.js?v=redesign-1';
    bootTheme();
  </script>
```

Do this one file at a time; each is a separate Edit call.

- [ ] **Step 3: Smoke-test each page loads**

Run: for each URL path, `curl -s http://127.0.0.1:3001/app/profile/ | grep design-tokens` → expect 1 match.

- [ ] **Step 4: Commit**

```bash
git add app/
git commit -m "feat(app): load design-tokens.css + chrome.css + theme.js across /app/**"
```

---

## Task 11: Wire theme.js into all `/auth/**` pages

**Files:**
- Modify: `auth/login/index.html`
- Modify: `auth/signup/index.html`
- Modify: `auth/forgot-password/index.html`
- Modify: `auth/reset-password/index.html`
- Modify: `auth/callback/index.html` (if present — it's a redirect page; can skip if it has no `<head>`)

- [ ] **Step 1: Add tokens + theme.js to each**

For each file, use Edit to add before the first existing stylesheet link:

```html
  <link rel="stylesheet" href="/shared/design-tokens.css?v=redesign-1">
  <script type="module">
    import { bootTheme } from '/shared/theme.js?v=redesign-1';
    bootTheme();
  </script>
```

Note: auth pages don't need `chrome.css` (they have their own split-screen layout — added in a later phase).

- [ ] **Step 2: Smoke-test**

Run: `curl -s http://127.0.0.1:3001/auth/login/ | grep design-tokens` → expect 1 match.

- [ ] **Step 3: Commit**

```bash
git add auth/
git commit -m "feat(auth): load design-tokens.css + theme.js across /auth/**"
```

---

## Task 12: Wire theme.js into legal + contact pages

**Files:**
- Modify: `contact/index.html`
- Modify: `privacy/index.html`
- Modify: `terms/index.html`
- Modify: `demo/index.html` (if still meant to exist post-strip; confirm)

⚠️ **Warning:** `privacy/index.html` and `terms/index.html` have uncommitted local WIP. Before modifying, confirm with the user whether to commit their WIP first or operate on their WIP version. Default: pause and ask.

- [ ] **Step 1: Confirm state**

Run: `git status` — if `privacy/index.html` or `terms/index.html` are in "Changes not staged for commit", stop and ask the user whether to commit the WIP first.

- [ ] **Step 2: Add tokens + theme.js**

For each file, use Edit to add before the first existing stylesheet link:

```html
  <link rel="stylesheet" href="/shared/design-tokens.css?v=redesign-1">
  <script type="module">
    import { bootTheme } from '/shared/theme.js?v=redesign-1';
    bootTheme();
  </script>
```

- [ ] **Step 3: Smoke-test each URL renders**

Run: `for path in contact privacy terms; do curl -s -o /dev/null -w "/$path/ %{http_code}\n" http://127.0.0.1:3001/$path/; done`
Expected: all `200`.

- [ ] **Step 4: Commit**

```bash
git add contact/index.html privacy/index.html terms/index.html
git commit -m "feat(static): load design-tokens.css + theme.js on contact/privacy/terms"
```

---

## Task 13: Add a server route test for the new CSS/JS files

**Files:**
- Modify: `tests/unit/server.routes.test.js`

- [ ] **Step 1: Inspect the existing test**

Run: `cat tests/unit/server.routes.test.js`

- [ ] **Step 2: Add tests asserting the new shared files are served**

Append three tests to the file (inside the existing `describe` if there is one; otherwise add a new describe block):

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

describe('redesign phase 1 — static files present', () => {
  test('design-tokens.css exists and defines both palettes', () => {
    const content = readFileSync('shared/design-tokens.css', 'utf8');
    assert.ok(content.includes('[data-theme="mint"]'), 'mint palette missing');
    assert.ok(content.includes('[data-theme="paper"]'), 'paper palette missing');
    assert.ok(content.includes('--accent'), '--accent custom property missing');
  });

  test('theme.js exports the public API', async () => {
    const mod = await import('../../shared/theme.js');
    assert.ok(typeof mod.bootTheme === 'function');
    assert.ok(typeof mod.applyTheme === 'function');
    assert.ok(typeof mod.validateTheme === 'function');
    assert.ok(typeof mod.resolveInitialTheme === 'function');
    assert.deepEqual(mod.VALID_THEMES, ['mint', 'paper']);
  });

  test('chrome.css defines sidebar + top-bar classes', () => {
    const content = readFileSync('shared/chrome.css', 'utf8');
    assert.ok(content.includes('.app-shell'));
    assert.ok(content.includes('.sidebar'));
    assert.ok(content.includes('.section-item'));
    assert.ok(content.includes('.tab'));
    assert.ok(content.includes('.btn'));
    assert.ok(content.includes('.field-input'));
  });
});
```

- [ ] **Step 3: Run the new tests**

Run: `npm run test:unit -- --test-name-pattern="redesign phase 1"`
Expected: PASS — all 3 tests green.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/server.routes.test.js
git commit -m "test(redesign): assert phase-1 shared files shipped"
```

---

## Task 14: Final integration smoke test

**Files:**
- None (manual verification)

- [ ] **Step 1: Start the server**

Run: `node server.js` (port 3001).

- [ ] **Step 2: Visit every route with the palette switcher working**

Open each URL in a browser, run this in devtools console on each:

```javascript
// Verify tokens load
const style = getComputedStyle(document.documentElement);
console.assert(style.getPropertyValue('--accent').trim() !== '', 'Missing --accent');
console.assert(style.getPropertyValue('--bg').trim() !== '', 'Missing --bg');

// Verify theme is set
console.assert(['mint', 'paper'].includes(document.documentElement.dataset.theme), 'No theme');

// Test theme toggle
const { applyTheme } = await import('/shared/theme.js?v=redesign-1');
applyTheme('paper');
console.assert(document.documentElement.dataset.theme === 'paper');
applyTheme('mint');
console.assert(document.documentElement.dataset.theme === 'mint');

console.log('✓ Tokens + theme.js working on', location.pathname);
```

URLs to test:
- `/`
- `/contact/`
- `/privacy/`
- `/terms/`
- `/auth/login/`
- `/auth/signup/`
- `/auth/forgot-password/`
- `/chat/`
- `/app/`
- `/app/profile/`
- `/app/nutrition/`
- `/app/workout/`
- `/app/progress/`

Expected: no console errors, `✓ Tokens + theme.js working on ...` logged on each.

- [ ] **Step 2: Run full test suite**

Run: `npm run test:unit`
Expected: all tests PASS (including the new theme + route tests).

- [ ] **Step 3: Final commit if needed**

If smoke test required fixes, commit them. Otherwise proceed.

---

## Task 15: Tag the phase-1 completion

**Files:**
- None (git tag only)

- [ ] **Step 1: Verify git status is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean` (other than any unrelated WIP like privacy/terms the user is drafting).

- [ ] **Step 2: Create a tag**

Run:

```bash
git tag -a redesign-phase-1-foundation -m "Frontend redesign Phase 1 · Foundation complete

Delivered:
- shared/design-tokens.css (palette + typography + base reset)
- shared/theme.js (resolver + persistence + switcher bindings)
- shared/chrome.css (sidebar + top-bar + tabs + buttons + forms + cards)
- All authenticated and public pages load the new shared files
- Theme switcher works via localStorage + prefers-color-scheme
- Full test coverage for theme.js pure logic + file-presence tests

Spec: docs/superpowers/specs/2026-04-15-frontend-redesign-design.md
Plan: docs/superpowers/plans/2026-04-15-redesign-phase-1-foundation.md
"
```

- [ ] **Step 3: Done**

Phase 1 is shippable. The visual changes are invisible to users at this point — no page has adopted the new chrome yet. The foundation is ready for Phase 2 (Chat).

---

## Spec coverage check

This plan covers these sections of `docs/superpowers/specs/2026-04-15-frontend-redesign-design.md`:

- ✓ **Design System · Palettes** (Tasks 3)
- ✓ **Design System · Typography** (Task 3)
- ✓ **Design System · Component patterns · Cards / Tabs / Pills / Toggles / Inputs / Sliders / Buttons** (Tasks 5, 6, 7)
- ✓ **Behaviors · Global patterns · Theme switching** (Tasks 1, 2, 8–12)
- ✓ **Behaviors · Global patterns · Auto-save indicator (visual class only)** (Task 6)
- ✓ **Information Architecture · Persistent sidebar** (Task 5 — visual only; HTML wiring is per-page in later phases)

**Not in this plan (deferred to later phases, as designed):**

- Phase 2 (Chat) — the chat-specific UI, widgets, streaming, model selector — see `2026-04-xx-redesign-phase-2-chat.md` (to be written)
- Phase 3 (Train) — modality tabs, set logger, rest timer
- Phase 4 (Nutrition) — time-aware fuel gauge, meal widgets, quick-log
- Phase 5 (Progress) — benchmark bars, small multiples, training load, streak
- Phase 6 (Profile) — all 5 tabs + danger zone
- Phase 7 (Auth) — split-screen + 4 panels + Google OAuth integration
- Phase 8 (Public/legal) — landing bento + marquee + spotlights
- Phase 9 (Conversational onboarding) — first-run system-prompt + extract_profile tool

Each subsequent phase needs its own plan written when you're ready to ship it.

---

## Next phase plan checklist

When the user is ready to ship Phase 2 (Chat), run this to scope:

1. Read the spec's `### 1. Chat (/app)` section.
2. Inventory existing code: `chat/index.html`, `shared/react-chat-app.js`, `shared/emersus-renderer.js`, `shared/chat-blocks.js`, `api/emersus/workflow.js`, `api/emersus/pipeline/**`.
3. Identify what the refactor at `7166bcf3` already simplified vs what's still to do.
4. Plan the visual replacement (sidebar + top bar + messages + composer) against the existing React app's state management.
5. Plan each behavior in `Behaviors · 1. Chat` as a separate feature with test + integration + commit.

Rough phase-2 scope estimate: ~30 tasks including tests.
