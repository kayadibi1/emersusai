# Landing Ask Bar — Design Spec

**Date:** 2026-04-17
**Status:** Design approved, pending implementation plan
**Scope:** Landing-page placement and interactive takeover only.

---

## One-line summary

Turn the existing autoplay demo on `/` into a real interactive Emersus session. Anonymous visitors get 3 free, fully-cited answers per 24 hours per IP, streamed into the demo frame. No signup required to experience the product.

## In scope

- Landing page (`index.html`) changes to make the demo composer functional.
- New anonymous streaming endpoint (`/api/anon-ask`).
- 24-hour per-IP rate limiting (3 questions).
- Block card + upgrade prompt after the 3rd question.
- Graceful error/refusal handling.

## Explicitly out of scope (tracked as separate specs)

- `/q/:slug` permanent, shareable, SEO-indexed answer pages.
- Curation job promoting high-quality anonymous Q&As to the public sitemap.
- Abuse prevention beyond the 24h IP counter (CAPTCHA, Turnstile, cost caps).

---

## User flow

1. Visitor lands on `/`. Hero renders unchanged. The existing demo frame below it autoplays the three-phase rotation (creatine → TDEE → protein).
2. The demo's chrome bar reads `emersus.ai — ask anything below` with a small green pulsing "● LIVE" pill on the right.
3. Visitor clicks the composer. Over ~300ms the fake bubbles, widget, and rotation state fade out (T3 wipe). Sidebar items dim to 30% opacity. Thread title becomes "New chat". Composer focuses. Rotation timers shut down for the remainder of the session.
4. Visitor types a question and submits. The real pipeline streams an answer into the demo frame. Frame stays fixed-height with internal scroll — page geometry does not shift.
5. Up to 3 questions per 24h per IP. After the 3rd answer completes, a bordered block card slides in below it:
   > You've used your 3 free questions.
   > Sign up — free — to save this conversation and keep asking.
   > [Sign up] [Log in]
   Composer disables, placeholder becomes "Sign up to ask more".
6. State persists across refresh via localStorage (keyed by date) so visitors who refresh see their prior Q&A and the same block card if they were capped. IP rate limit is the source of truth server-side.

## Discoverability

Signal lives inside the existing demo chrome — zero vertical space added. Chrome title: `emersus.ai — ask anything below`. Small green "● LIVE" pill on the right side of the chrome bar, with a pulsing dot.

No other signals. No hero-level ask bar, no banner above the demo, no always-on nudge overlay. The chrome bar is the single signal of interactivity.

## Takeover behavior (T3 — transitional wipe)

When the visitor clicks anywhere on the composer input:

- Rotation timer clears; no further phase transitions.
- Existing user bubble, assistant bubble, widget, and cite pill animate to opacity 0 over ~300ms, then unmount.
- Sidebar items in `.demo-side` transition to `opacity: 0.3`.
- Thread title in `.demo-header` swaps to "New chat"; thread meta clears.
- Composer input gains focus.
- The real chat runtime (below) mounts into the same `.msgs` container.

Once taken over, the demo never returns to rotation state within the same page load, even if the visitor doesn't type.

## Growth mode (fixed + scroll)

The demo frame height is fixed at its rotation-state height. As messages and widgets arrive, `.msgs` scrolls internally. Auto-scroll to bottom on each new chunk, using the same scroll logic the authenticated `/chat/` uses. Hero above, rest of landing below — page geometry does not reflow.

## Rate limit (S3 — IP-based, 3 per 24h)

- Counter key: `sha256(ip + YYYY-MM-DD)` where the date is UTC.
- Storage: in-memory `Map` on the Node process with per-entry 24h expiry. Entries auto-purge on a light interval (e.g. on each request, opportunistically sweep expired keys).
- Trade-off acknowledged: in-memory state does not survive restarts and is per-process. For v1 this is acceptable because (a) pm2 runs a single process for `emersus-api`, (b) restarts effectively reset limits which is lenient, not abusive, and (c) the limiter is a soft nudge — the real conversion is the block card, not enforcement.
- Swap to Redis or a Postgres `anon_rate_limits` table if abuse materializes or we scale to multiple app processes. Tracked as the "abuse prevention" out-of-scope spec.

## Permalink strategy

Every anonymous question is assigned a slug (for internal reference and future `/q/:slug`), but **no permanent public page is rendered in this spec**. Slugs land in a `anonymous_questions` staging table (or equivalent); a separate curation spec decides which get promoted to public SEO pages. For v1, anonymous answers exist only in the visitor's session — no share button, no permalink affordance.

## Upgrade prompt (U1 — post-answer card inline)

- Fires immediately after the 3rd answer's stream completes.
- Renders as a bordered card beneath the assistant bubble, inside the `.msgs` scroll container.
- Copy: "You've used your 3 free questions. Sign up — free — to save this conversation and keep asking."
- Two buttons: `Sign up →` (links `/auth/?panel=signup`) and `Log in` (links `/auth/`).
- Composer transitions to `disabled` state with placeholder "Sign up to ask more".
- No modal, no overlay, no countdown. Visitor can freely scroll and re-read their 3 answers.

## Architecture & components

### Frontend

- **`index.html`** — the existing `#demo` section gets:
  - Chrome title changed to `emersus.ai — ask anything below`.
  - A new `.chrome-live-pill` element (green, pulsing dot) appended to `.demo-chrome`.
  - Everything else structurally unchanged.
- **`landing-demo.js`** (existing rotation driver) — gains a `takeover()` function called on composer click:
  - Clears rotation timers, fades current content, dims sidebar, mounts the real chat runtime.
  - Exposes a one-way transition — no un-takeover.
- **`landing-chat-runtime.js`** (new, ~150 lines) — anonymous-mode bootstrap:
  - Wires `shared/react-chat-app.js` into the demo frame's `.msgs` container.
  - Reuses the existing renderer (`shared/emersus-renderer.js`), streaming client, and citation components.
  - Submission target: `POST /api/anon-ask` (SSE).
  - Persistence: localStorage only (no Supabase reads/writes). Key: `emersus.anon.YYYY-MM-DD`. Value: `{ asked: number, messages: [...], capped: boolean }`.
  - Enforces the client-side "3 asked" mirror; block card logic lives here.
- **`shared/landing.css`** — new rules for:
  - `.chrome-live-pill` (green background, white text, pulsing dot).
  - `.demo-side[data-dimmed="true"]` (0.3 opacity, pointer-events none).
  - `.composer[data-disabled="true"]` (faded, non-editable).
  - `.wipe-out` fade transition class.
  - `.anon-block-card` (bordered, two buttons, accent colors).
  - Target ~60 lines.

### Backend

- **`api/anon-ask.js`** (new) — POST endpoint:
  - Input: `{ question: string }`.
  - Resolves client IP: prefer `req.ip` with `trust proxy` set; fall back to `x-forwarded-for` first hop if running behind the Hetzner nginx.
  - Rate check: compute `sha256(ip + utcDateStr)`, look up in the in-memory counter Map. If ≥3 → return `429` with `{ error: "rate_limit", asked: 3, limit: 3 }`, do not open a stream.
  - Increment counter with 24h TTL.
  - Invoke the existing pipeline in anonymous mode:
    - `user_id = null`, `thread_id = null`.
    - Skip the persistence layer: no insert into `messages`, no insert into `threads`, no memory read/write.
    - Safety scope lock (`api/emersus/pipeline/safety.js`) runs unchanged; refusal responses still return via SSE.
    - Model, prompt, retrieval, widgets, citations: identical to the authenticated path.
  - Stream SSE back using the existing SSE shape.
  - On stream error (pipeline throws, upstream model 500, retrieval fail): wrap the increment in a try/finally; decrement if the stream aborts before completing.
- **`server.js`** — mount `/api/anon-ask`. Reuse existing body-parser and SSE middleware.

### Reused, unchanged

- `api/emersus/pipeline/{sanitize,safety,retrieve,synthesize,stream}.js` — drive the answer, no changes.
- `shared/react-chat-app.js`, `shared/emersus-renderer.js` — render the answer, no changes.
- `api/emersus/workflow.js` — anonymous path either gets a new thin orchestrator sibling or a `{ anonymous: true }` flag. Decide during implementation.

---

## Data flow (one question, end-to-end)

1. Visitor submits. Runtime checks localStorage counter. If ≥3: show block card, stop.
2. Runtime disables composer, renders user bubble, opens SSE to `POST /api/anon-ask`.
3. Server: hash IP+date, check in-memory counter. If ≥3 → 429, stop.
4. Server: increment counter, open stream, run pipeline in anonymous mode.
5. Stream events flow through existing SSE shape → `emersus-renderer.js` → `.msgs` container.
6. Stream completes: client increments localStorage counter, writes message log.
7. If `asked === 3` after increment: render block card, disable composer.
8. On safety refusal: counts against the limit, inline hint ("Emersus is tuned for fitness, nutrition, and exercise science — try one of those").
9. On mid-stream error or client disconnect: server decrements the counter in a try/finally so any stream that doesn't reach the terminal "done" event doesn't burn a question. Visible errors render "Something went wrong — try again" inline.

---

## Error handling & edge cases

- **Rate limit hit (429):** block card renders with Sign up / Log in. Composer disabled. No toast, no modal.
- **Safety refusal:** counts against the limit (rationale: refunding encourages probing; charging matches product behavior). Short inline hint.
- **Mid-stream error or client disconnect:** inline error message for the visible-error case. Server wraps the stream in a try/finally: if the pipeline throws, or the SSE connection closes before the terminal "done" event, the counter decrements. The effect is that any stream that doesn't reach successful completion — error, abort, refresh — doesn't burn a question on the server. The client counter only increments on successful completion, so both sides stay in sync.
- **Two tabs:** localStorage shared between tabs; server enforces the hard cap. Simultaneous submits from 2 tabs at 2/3 → one gets a 429 after submit.
- **IP rotation / incognito / clear storage bypass:** explicit non-goal. S3 is a lightweight limiter; determined bypass is accepted.
- **Scroll away during rotation:** unchanged.
- **Click composer without typing:** takeover happens (wipe, focus), rotation stays dead, frame sits empty-and-focused. No auto-revert.
- **Long answers (workout plan, meal plan):** internal scroll handles it. No page reflow.
- **Multiple widgets / citations:** reuses existing renderer.

---

## Testing

### Backend

- Unit: `api/anon-ask.js` rate-limit counter — increment path, 24h TTL expiry, decrement-on-error path, 429 response shape.
- Integration: one end-to-end test that hits `/api/anon-ask` four times from the same IP hash and asserts the 4th returns 429. One test that asserts anonymous context flows through the pipeline without writing to `messages` or `threads` tables (mock Supabase).
- Smoke: one real call against the deployed endpoint after merge — confirms safety scope lock and streaming path still work. Manual curl.

### Frontend

- Manual smoke checklist (no React test harness):
  1. Load `/` — rotation autoplays.
  2. Chrome reads "ask anything below" with green LIVE pill pulsing.
  3. Click composer → wipe plays, sidebar dims, thread title becomes "New chat", composer focused.
  4. Submit a real fitness question → answer streams with citations and at least one widget if applicable.
  5. Ask 2 more → all 3 stream successfully.
  6. After 3rd completes → block card renders, composer disables.
  7. Refresh → prior Q&A restored, block card still visible, composer still disabled.
  8. Click Sign up → lands on `/auth/?panel=signup`.
- Accessibility: composer reachable via Tab from the hero; Enter submits; Sign up button in block card receives focus after it renders.

### Explicitly not tested

- Widget rendering correctness (covered by existing pipeline tests).
- Cross-browser pixel-diff of the fade animation.
- IP-rotation bypass scenarios.

### Verification before completion

Load `/` in a browser, run the manual checklist above, confirm one real question streams with citations. No "I think this works" claims — the feature is visitor-facing.

---

## Open questions deferred to implementation

- Whether `landing-chat-runtime.js` re-uses `shared/react-chat-app.js` wholesale (preferred) or extracts a thinner `ChatSurface` component. Decide based on how much `react-chat-app.js` assumes about auth/persistence at boot.
- Whether `api/emersus/workflow.js` gets an `{ anonymous: true }` flag or a parallel thin orchestrator. Favor the flag if it's a single-branch change; split if the branches multiply.
- Exact copy of the safety-refusal hint ("fitness, nutrition, and exercise science" phrasing can be tightened during implementation).
- Exact visual treatment of the block card (mock during implementation, not worth pre-speccing).
