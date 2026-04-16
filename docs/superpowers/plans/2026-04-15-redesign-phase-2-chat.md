# Frontend Redesign · Phase 2 · Chat (`/app`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Reskin `/app` (chat) with the Phase 1 chrome (sidebar + top bar + composer) while keeping the existing React app's state/streaming/widget pipeline intact. Add the Emersus model pill, live source-count pill, share dropdown, always-visible message actions, empty-state prompt chips, and stop-stream button. No backend shape changes.

**Scope rule:** This phase is visual + behavioral chrome. Do **not** touch retrieval policy, `workflow.js` synthesis, or the guardrail system. If a task wants you to restructure streaming internals, stop and ask.

**Spec reference:** `docs/superpowers/specs/2026-04-15-frontend-redesign-design.md` — sections "Page designs · 2. Chat" and "Behaviors · 1. Chat".

**Mockup:** `.superpowers/brainstorm/linear-landing/chat.html` — copy the DOM + CSS class structure where feasible; re-write inline styles as classes in a new `shared/chat-v2.css`.

**Prerequisite:** Phase 1 shipped (`redesign-phase-1-foundation` tag).

**Branch strategy:** Work on `main` under a `chat_v2` feature flag (see Task 1). Each task commits incrementally. When every task is done + smoke tests pass, flip the flag in a final commit.

---

## File structure

- **New:** `shared/chat-v2.css` — chat-specific styles on top of `chrome.css` (messages, composer, widget-action footers, empty-state chips)
- **New:** `shared/chat/top-bar.js` — React component: thread title editable · model pill · sources-cited pill · share button · overflow menu
- **New:** `shared/chat/message-actions.js` — React component: always-visible Copy / Cite / Regenerate / Save plan / Swap meal / Export row
- **New:** `shared/chat/empty-prompts.js` — React component: anchored prompt chips fed by `/api/emersus/suggest-prompts` (new endpoint, see Task 9)
- **New:** `shared/chat/share-modal.js` — React component: Copy link · Copy as Markdown · Export as PDF
- **New:** `api/emersus/threads-share.js` — Express handler: `POST /api/threads/:id/share { expires_days } → { url, expires_at }`; `GET /api/threads/:id/export.pdf`; `GET /share/t/:hash` static renderer
- **New:** `api/emersus/suggest-prompts.js` — Express handler: `GET /api/emersus/suggest-prompts?profile_id=...` → `[{ id, label, prompt, data_prompt }]` (profile-aware, falls back to generic list)
- **New:** `supabase/2026-04-15_threads_model_share.sql` — migration adding `threads.model`, `threads.shared_token`, `threads.shared_expires_at`
- **Modify:** `chat/index.html` — load `chat-v2.css` behind the `chat_v2` flag (detected from `localStorage.emersus-flags` or URL `?chat_v2=1`)
- **Modify:** `shared/react-chat-app.js` — mount new components behind flag; preserve all existing streaming / widget logic
- **Modify:** `shared/emersus-renderer.js` — citation card + meal widget footer action buttons (PUBMED / DOI / ASK FOLLOW-UP / Adjust meals / Save to Nutrition →)

No backend workflow (`api/emersus/workflow.js`) changes.

---

## Task 1: Add `chat_v2` feature flag

**Files:**
- Create: `shared/feature-flags.js`
- Create: `tests/unit/shared/feature-flags.test.js`

- [ ] **Step 1: TDD — write the flag resolver tests first**

Flags live in `localStorage.emersus-flags` as a JSON blob `{ chat_v2: true }`. Also respect `?chat_v2=1` / `?chat_v2=0` URL overrides (single-session), and persist URL overrides to localStorage if `?chat_v2.persist=1`.

Tests: `readFlag(name, { saved, url })` returns boolean; precedence = url → saved → default; validates allowed names.

- [ ] **Step 2: Implement `shared/feature-flags.js` exposing `readFlag`, `setFlag`, `KNOWN_FLAGS`**

- [ ] **Step 3: Commit** `feat(flags): feature-flags resolver (localStorage + URL override)`

---

## Task 2: Mount `chat_v2` CSS stub

**Files:**
- Create: `shared/chat-v2.css` (empty placeholder with header comment)
- Modify: `chat/index.html`

- [ ] **Step 1:** Create empty `shared/chat-v2.css` with a top comment noting it's the chat v2 stylesheet.

- [ ] **Step 2:** In `chat/index.html`, add (inside `<head>`, after `chrome.css`):

```html
<script type="module">
  import { readFlag } from '/shared/feature-flags.js';
  if (readFlag('chat_v2')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/shared/chat-v2.css?v=redesign-2';
    document.head.appendChild(link);
    document.documentElement.dataset.chatV2 = '1';
  }
</script>
```

- [ ] **Step 3: Smoke test** — load `/chat/?chat_v2=1` in browser, verify `<html data-chat-v2="1">`.

- [ ] **Step 4: Commit** `feat(chat-v2): feature-flag gate + empty stylesheet`

---

## Task 3: DB migration — `threads.model` / `threads.shared_token` / `threads.shared_expires_at`

**Files:**
- Create: `supabase/2026-04-15_threads_model_share.sql`

- [ ] **Step 1:** Write migration:

```sql
-- 2026-04-15 — threads: per-thread model override + sharing tokens
alter table threads
  add column if not exists model text not null default 'emersus-0.5',
  add column if not exists shared_token text unique,
  add column if not exists shared_expires_at timestamptz;

create index if not exists threads_shared_token_idx on threads (shared_token)
  where shared_token is not null;

comment on column threads.model
  is 'Per-thread model override. Maps to OPENAI_EMERSUS_MODEL tier. Defaults to emersus-0.5.';
comment on column threads.shared_token
  is 'Opaque token for /share/t/<token> read-only renders. Null means not shared.';
```

- [ ] **Step 2:** ⚠️ **DO NOT apply the migration.** Just write the file. User will apply it to prod Hetzner Supabase explicitly.

- [ ] **Step 3: Commit** `sql(threads): migration for model + share tokens (pending apply)`

- [ ] **Step 4:** Update `docs/schema.md` with the new columns.

---

## Task 4: Top-bar React component

**Files:**
- Create: `shared/chat/top-bar.js`
- Create: `tests/unit/shared/chat/top-bar.test.js`

- [ ] **Step 1:** Export `<ChatTopBar thread onRename onModelChange onShare onArchive onDelete sourceCount />`.

Layout (spec):
- Left: editable thread title (click to edit, Enter saves, Esc cancels)
- Middle: `Emersus ▾` model pill → dropdown with `Emersus · Fast · Deep`
- Right cluster: `N SOURCES CITED` non-interactive pill · Share button · `⋯` menu

Use classes from `chrome.css` (`.top-bar`, `.btn`) plus new chat-v2 classes. No new backend calls.

- [ ] **Step 2:** Tests for pure pieces (title normalization + keybinds), following the `theme.test.js` style.

- [ ] **Step 3:** Wire into react-chat-app.js inside a `readFlag('chat_v2')` guard. The existing top bar stays as fallback.

- [ ] **Step 4: Commit** `feat(chat-v2): top bar with editable title + model pill + share + menu`

---

## Task 5: Streaming stop button + live source count

**Files:**
- Modify: `shared/react-chat-app.js`
- Modify: `shared/chat-v2.css`

- [ ] **Step 1:** When `isStreaming`, render a `■ Stop` button in the composer that aborts via the existing `AbortController`. Composer hint text becomes `GENERATING…`. When idle, it reads `⏎ SEND · ⇧⏎ NEWLINE`.

- [ ] **Step 2:** Increment `sourceCount` live as citations stream in (the renderer already knows the current citation count; expose it via a ref or context). Wire to the Top-bar's `sourceCount` prop.

- [ ] **Step 3:** Commit `feat(chat-v2): stop button + live source count`

---

## Task 6: Always-visible message actions

**Files:**
- Create: `shared/chat/message-actions.js`
- Modify: `shared/react-chat-app.js`

- [ ] **Step 1:** `<MessageActions message onCopy onCite onRegenerate onSavePlan onSwapMeal onExport />`. Row always rendered at 55% opacity, hover brightens.

- [ ] **Step 2:** `Copy` — copy rendered text (use existing `readMessageText` helper). Toast `COPIED`.

- [ ] **Step 3:** `Cite` — format cited papers as APA-style block; copy to clipboard; toast `CITATIONS COPIED · N PAPERS`.

- [ ] **Step 4:** `Regenerate` — re-run inference from the parent user message using the existing workflow endpoint.

- [ ] **Step 5:** `Save plan` — only renders when `message.has_workout_plan`. Opens existing workout-plan save drawer.

- [ ] **Step 6:** `Swap meal` — only renders when `message.has_meal_plan`. Seeds composer with swap prompt.

- [ ] **Step 7:** `Export` — opens share-modal (see Task 7).

- [ ] **Step 8: Commit** `feat(chat-v2): always-visible per-message actions`

---

## Task 7: Share modal

**Files:**
- Create: `shared/chat/share-modal.js`
- Create: `api/emersus/threads-share.js`
- Modify: `server.js` (mount `POST /api/threads/:id/share` and `GET /api/threads/:id/export.pdf`)

- [ ] **Step 1:** Modal with three options:
  - **Copy link** → `POST /api/threads/:id/share { expires_days: 30 }` → copy `url` to clipboard.
  - **Copy as Markdown** → serializes the thread client-side (widgets → Markdown tables).
  - **Export as PDF** → opens `GET /api/threads/:id/export.pdf` in a new tab.

- [ ] **Step 2:** Server: generate a 22-char random `shared_token`, compute `expires_at`, `update threads set shared_token=..., shared_expires_at=... where id = :id`, return `{ url: "/share/t/<token>", expires_at }`.

- [ ] **Step 3:** PDF export: use a minimal server-side render (handlebars-style template + `pdf-kit` or similar; **NOTE**: if adding a new dep is out of scope, stub with a plain `.txt` download and flag `pdf_export` for later).

- [ ] **Step 4:** Public read-only route: `GET /share/t/:token` → renders a static HTML of the thread if `shared_expires_at > now()`, else 410.

- [ ] **Step 5: Commit** `feat(chat-v2): share modal + server share/export endpoints`

---

## Task 8: Citation card + meal widget action footers

**Files:**
- Modify: `shared/emersus-renderer.js`
- Modify: `shared/chat-v2.css`

- [ ] **Step 1:** Citation footer: `PUBMED ↗` (if pmid) · `DOI ↗` (if doi) · `ASK FOLLOW-UP` (always). Clicking `ASK FOLLOW-UP` seeds the composer with "Tell me more about [title] by [first author]" — no auto-send.

- [ ] **Step 2:** Meal-widget footer: `Adjust meals` (opens inline editor) · `Save to Nutrition →` (POST to `/api/nutrition/plans`). Inline editor is minimum-viable: numeric inputs for each row's kcal/protein.

- [ ] **Step 3:** Preserve the existing `citation` / `meal-plan` / `workout-plan` fence format. Do **not** change the LLM's output contract.

- [ ] **Step 4: Commit** `feat(chat-v2): citation + meal widget action footers`

---

## Task 9: Empty-state prompt chips

**Files:**
- Create: `shared/chat/empty-prompts.js`
- Create: `api/emersus/suggest-prompts.js`
- Modify: `server.js`
- Modify: `shared/react-chat-app.js`

- [ ] **Step 1:** Server endpoint `GET /api/emersus/suggest-prompts?profile_id=<id>` returning `[{ id, label, prompt }]`. Profile-aware (checks `goal` + `experience`); generic fallback of 6 prompts.

- [ ] **Step 2:** Component `<EmptyPrompts />` anchored to the bottom of an empty thread's messages area (not centered). Click fills composer; no auto-send.

- [ ] **Step 3:** Wire under `readFlag('chat_v2')` in the react-chat-app empty-state branch.

- [ ] **Step 4: Commit** `feat(chat-v2): empty-state prompt chips`

---

## Task 10: Sidebar — New thread · Search · thread list polish

**Files:**
- Modify: `shared/react-chat-app.js`
- Modify: `shared/chat-v2.css`

- [ ] **Step 1:** `+ New thread` primary button uses `.side-primary-btn` class. Creates a draft thread (no server call) with id `draft-<uuid>`. On first submit, promote via existing thread upsert.

- [ ] **Step 2:** Search input debounced 300ms → `GET /api/threads?search=<q>`. The existing thread-list component filters on response.

- [ ] **Step 3:** Thread list grouped Today / Yesterday / Previous 7 days. Use existing `localDateStr` helper.

- [ ] **Step 4: Commit** `feat(chat-v2): sidebar primary button + search + grouping`

---

## Task 11: Palette switcher UI element

**Files:**
- Modify: `shared/react-chat-app.js`

- [ ] **Step 1:** Add a `.palette-switch` widget (see chrome.css Task 4) to the sidebar user-card area. Two swatches with `data-theme-swatch="mint"` / `"paper"`. Call `bindSwitcher()` from `theme.js` on mount.

- [ ] **Step 2: Commit** `feat(chat-v2): palette switcher in sidebar`

---

## Task 12: Write chat-v2.css fully

**Files:**
- Modify: `shared/chat-v2.css`

- [ ] **Step 1:** Copy the relevant sections from the `chat.html` mockup into `chat-v2.css`: messages layout (assistant / user mono labels + timestamps), composer shell, empty-prompt chips layout, message-action row, widget-frame wrapper overrides.

- [ ] **Step 2:** Audit for unused class names — remove anything the React code doesn't reference.

- [ ] **Step 3: Commit** `feat(chat-v2): chat-specific styles`

---

## Task 13: Flip `chat_v2` flag default to `true`

**Files:**
- Modify: `shared/feature-flags.js` — set default to `true`
- Modify: `shared/chat.css` — mark for removal (add header comment; delete in follow-up once v2 is confirmed stable)

- [ ] **Step 1:** Manual QA pass with both `?chat_v2=0` (old) and `?chat_v2=1` (new) — confirm both work, no console errors, streaming still streams.

- [ ] **Step 2:** Flip default in `feature-flags.js`.

- [ ] **Step 3: Commit** `feat(chat-v2): default to chat v2`

---

## Task 14: Tag phase-2 completion

- [ ] Run `git tag -a redesign-phase-2-chat -m "Phase 2 — Chat redesign shipped"`.

---

## Spec coverage check

Covered:
- ✓ Top bar (title, model pill, sources pill, share, menu) — Task 4
- ✓ Message actions — Task 6
- ✓ Citation + meal widget footers — Task 8
- ✓ Streaming stop button + live citation count — Task 5
- ✓ Empty-state prompt chips — Task 9
- ✓ Sidebar (new thread, search, thread list) — Task 10
- ✓ Palette switcher — Task 11
- ✓ Theme persistence — already in Phase 1

Deferred to later phases:
- The actual model-tier backend wiring (Emersus Fast / Deep) — today the UI stores the selection but the workflow still routes to the single configured `OPENAI_EMERSUS_MODEL`. Extending retrieval-policy tier is a separate pipeline task.
- PDF export backend — stub OK for now; real server-side PDF rendering is a follow-up.
- Thread sharing public-view rendering — the `/share/t/<token>` handler is minimal; polish is later.

---

## Acceptance criteria

1. `/chat/?chat_v2=1` renders the new chrome with no console errors on both themes.
2. Existing streaming, citations, and workout/meal widgets still work (regression-test against canary prompts).
3. Editable thread title mutates `PATCH /api/threads/:id { title }`.
4. Model pill updates `threads.model` (no backend behavior change yet).
5. `N SOURCES CITED` pill reflects the actual live citation count.
6. Share modal → Copy link returns a `/share/t/<token>` URL valid for 30d.
7. Message actions row is visible for every assistant message at 55% opacity; hover brightens.
8. Empty-state chips render from `/api/emersus/suggest-prompts`; clicking fills composer.
9. Palette switcher in sidebar toggles theme without flicker.
10. Default theme is picked from `prefers-color-scheme` on first visit; persisted after.
11. `chat_v2=0` still serves the prior UI (no regressions on fallback).

---

## Next: Phase 3 (Train)

When Phase 2 is stable and flag default flipped, start on `docs/superpowers/plans/2026-04-15-redesign-phase-3-train.md` (outline in place, expand before execution).
