---
name: Site-wide audit — implementation plan
status: executing
spec: docs/superpowers/specs/2026-04-21-site-wide-audit-design.md
---

# Plan — execution order

## Phase 1 — I handle directly (shared files; serialized to avoid agent conflicts)

1. **`shared/design-tokens.css`**
   - Add universal `:focus-visible` ring utility.
   - Add `.sr-only` + `.skip-to-main` + `[aria-live]` style primitives.
   - Raise `--dim` contrast in both palettes to ≥ 4.5:1.
   - Wrap every declared motion (`transition`, `animation`) behind a `@media (prefers-reduced-motion: no-preference)` default. Add a universal `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }` kill switch.
2. **`shared/chrome.css`**
   - Add skip-to-main link styles + mobile drawer toggle affordance (hamburger in top bar).
3. **`shared/app-pages.js`**
   - Inject skip-to-main anchor + mobile drawer hamburger that toggles a `.sidebar.is-open` class; hook Escape + outside-click.
   - Listen for `storage` event on `theme` key → re-apply data-theme so open tabs stay in sync.
4. **`shared/theme.js`**
   - Fallback to `prefers-color-scheme` when no stored theme *and* the floating switcher is used as final resort (not a blocker, keeps explicit-opt principle).
5. **`shared/supabase.js`**
   - Clear `configPromise` on rejection so stale failures don't wedge page forever.

## Phase 2 — parallel section agents (no shared-file overlap)

Each agent is given:
- explicit file list (scope lock)
- the section's findings verbatim
- an instruction to FIX, not flag
- a rule to skip chat-workflow issues
- verification requirement (grep tests, smoke read)

| Agent | Scope |
|-------|-------|
| LAND  | `index.html`, `shared/landing.css`, `shared/landing-wave.js` |
| AUTH  | `auth/**`, `shared/auth.css`, `shared/auth-pages.js`, `shared/auth-email-allowlist.js` |
| NUTR  | `app/nutrition/**`, `shared/nutrition**`, `shared/food-detail-drawer.js`, `shared/meal-plan-*.js` |
| TRAIN | `app/train/**`, `app/workout/**`, `shared/train/**`, `shared/train.css`, `shared/climbing-*.js`, `shared/exercise-icons.js`, `shared/gps-tracker.js`, `shared/mapbox.js`, `shared/workout-plan-*.js` |
| PROG  | `app/progress/**`, `app/profile/**`, `shared/progress*.js`, `shared/progress.css`, `shared/profile.css` |
| CHAT-UI | `chat/index.html`, `shared/chat.css`, `shared/chat-blocks.js`, narrow UI-only edits in `shared/react-chat-app.js` (textarea autogrow, scroll-to-bottom user-intent guard, menu viewport bounds, title tooltip). |
| BACK  | `api/**`, `server.js` (excluding `api/emersus/pipeline/**` and `api/emersus/workflow.js`) |
| WIDG  | `shared/emersus-renderer.js`, `shared/widget-v2/**`, `shared/share-modal.js`, `shared/share-card.js`, `shared/share-capability.js`, `shared/contact-page.js`, `shared/widget-fence-parser.js` |

## Phase 3 — verify

- Node syntax check on every edited JS: `node --check path`.
- Grep for re-introduced raw hex colours in CSS touched files.
- Confirm chat-workflow list is untouched in code; list persisted to `docs/chat-workflow-bugs-flagged.md`.

## Phase 4 — done

- Summary of changes + flagged-bug file shown to user.
- Do NOT commit automatically — user will review then confirm commit+push (per memory `feedback_ask_commit_push.md`).
