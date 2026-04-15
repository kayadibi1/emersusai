# UI Strip — Pre-Redesign Cleanup

**Date:** 2026-04-14
**Status:** Approved for implementation

## Goal

Strip the current UI from all non-`/app/`, non-`/auth/`, non-`/chat/` pages so a planned frontend overhaul starts from a clean, semantic baseline. Protected pages (`/app/**`, `/auth/**`, `/chat/`) must render and function **identically** to before the change.

## Protected (off-limits)

- `/app/**/*.html` (all dashboard/workout/nutrition/profile/progress/_debug pages)
- `/auth/**/*.html` (login, signup, forgot-password, reset-password, callback)
- `/chat/index.html`
- Any JS consumed only by the above

## In-scope (strip)

| Page | Strip targets |
|---|---|
| `/index.html` (landing) | styles.css, script.js, landing-background.js |
| `/contact/index.html` | keep `shared/contact-page.js` (form submit) |
| `/privacy/index.html` | static content only |
| `/terms/index.html` | static content only |
| `/demo/index.html` | audit `shared/chat-demo.js`; keep functional, strip styling |
| `/admin/{index,alerts,candidates,feeds,jobs,topics}/index.html` | strip `shared/admin.css`; keep inline module scripts (admin auth + data fetch) |
| `/internal/email-mockups/template-{a,b}.html` | strip inline `<style>` and class/style attrs |

## Phase 0 — Separation (non-destructive, pixel-identical)

`shared/site.css` (2551 lines) is currently loaded by both protected and in-scope pages. Fork it into protected copies first so the in-scope deletion doesn't regress protected pages.

Steps (in order):

1. `cp shared/site.css shared/app.css` — update every `<link rel="stylesheet" href="/shared/site.css...">` in `/app/**/*.html` to `/shared/app.css` (preserve existing `?v=` cache-bust query string).
2. `cp shared/site.css shared/auth.css` — update every `/auth/**/*.html` link the same way.
3. `cp shared/site.css shared/chat-page.css` — update `/chat/index.html` to load `/shared/chat-page.css` in place of `/shared/site.css`. `/chat/index.html` continues to load `/shared/chat.css` alongside (unchanged).
4. `shared/chat.css` stays as-is (consumed by `/chat/` and `/app/_debug/` — both protected).
5. Leave `shared/site.css` in place for now; in-scope pages still reference it temporarily.

**Verification gate (must pass before Phase 1):**
- `rg 'shared/site\.css' app/ auth/ chat/` → no matches
- Manual smoke test: open each protected page in a browser, diff computed styles via DevTools against the pre-change state. Zero visual regression.
- Commit Phase 0 separately: `refactor(ui): fork shared/site.css into per-area stylesheets (no visual change)`

## Phase 1 — Scorched earth on in-scope

### Files to delete outright

- `styles.css` (root, 581 L)
- `script.js` (root, 292 L — Three.js neuron hero)
- `landing-background.js` (root, 650 L)
- `shared/admin.css` (388 L)
- `shared/site.css` (2551 L — confirm zero references outside in-scope before deletion)

### HTML transformation rules (every in-scope `.html`)

**Remove:**
- All `<link rel="stylesheet" ...>` tags (incl. Google Fonts)
- All `<style>...</style>` blocks
- All `class="..."` attributes (remove entirely, do not leave empty)
- All `style="..."` attributes
- `<script>` tags whose only purpose is decoration or animation
- Purely decorative wrapper `<div>`s (empty nesting with no semantic content, no functional id/data hooks). **When in doubt, keep.**

**Keep:**
- Semantic tags: `<h1>`–`<h6>`, `<p>`, `<ul>`, `<ol>`, `<li>`, `<a href>`, `<form>`, `<input>`, `<label>`, `<button>`, `<main>`, `<section>`, `<nav>`, `<header>`, `<footer>`, `<img>` with real content
- Attributes: `id`, `name`, `type`, `href`, `for`, `value`, `placeholder`, `aria-*`, `data-*`, `role`, form validation attrs (`required`, `pattern`, etc.)
- Functional `<script type="module">` tags (form submission, admin data fetch, auth checks)

### Per-page functional JS audit

| Page | Keep | Strip |
|---|---|---|
| `/contact/` | `shared/contact-page.js` (form POST) | visual classes assigned in JS |
| `/demo/` | whatever in `shared/chat-demo.js` is load-bearing for demo behavior | styling-only CSS-in-JS |
| `/admin/*` (6 pages) | `requireAdmin()` auth, `fetch()` + JSON parse + table row rendering | `el.className = ...`, `el.style.* = ...`, inline CSS strings |
| `/privacy/`, `/terms/` | — | all (static content) |
| `/index.html` (landing) | — | all 3 JS files (decorative) |
| `/internal/email-mockups/` | — | inline `<style>` only |

### Commits (bisectable)

- `refactor(ui): strip landing page styling` — root `index.html`, delete `styles.css`, `script.js`, `landing-background.js`
- `refactor(ui): strip marketing/legal pages` — contact/privacy/terms/demo
- `refactor(ui): strip admin pages` — admin/*, delete `shared/admin.css`
- `refactor(ui): strip email mockups` — internal/email-mockups/*
- `refactor(ui): delete shared/site.css` — last, only after all in-scope `<link>`s removed

## Post-strip verification

- `rg 'shared/site\.css'` → no matches
- `rg 'styles\.css|script\.js|landing-background\.js'` (in repo root HTML) → no matches
- Load each in-scope page in browser: no 404s in Network tab, no console errors. Pages render as raw HTML (browser defaults). Forms submit; admin pages fetch and render data (unstyled tables).
- Load each protected page: pixel-identical to pre-change.

## Out of scope

- Redesign itself (covered by separate spec `2026-04-12-frontend-redesign-design.md`)
- `/dist/` (build artifacts — regenerated)
- `docs/` (GitHub Pages satellite — different lifecycle)
- Any backend (`api/`, `server.js`, `worker/`, `jobs/`, `scripts/`, `supabase/`)

## Rollback

Each phase is its own commit. Revert the commit to restore styling for that slice.
