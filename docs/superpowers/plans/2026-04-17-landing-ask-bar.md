# Landing Ask Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Changelog

- **2026-04-17 post-rebase adjustments** — sibling Claude instance landed the widget-v2 subsystem (commits 7f9b078a…0d57f9cc) before this branch. Three deltas:
  1. Pipeline SSE events use `prose` (with `.delta` field) and `tool` (not `text`/`delta`/`chunk` as Task 7's first draft assumed). Task 7 below reflects the correct shapes.
  2. The `done` SSE event carries `sources` (array) and `confidence` — Task 9 appends a compact "Sources" list from this payload instead of trying to render pill DOM inline.
  3. `shared/emersus-renderer.js` is React-based (imports React from esm.sh). The anonymous runtime renders vanilla DOM. Widget fences (including new `widget-v2` segments) are rendered as "Sign up to see the interactive widget" placeholders in anon mode rather than fully hydrated. Full widget parity is deferred to a follow-up spec.
- Empty `userId` / `threadId` flow through the existing pipeline cleanly: `sanitize.js:50` returns empty `stableUserId`/`supabaseUserId` for empty input, and downstream persistence (`persistProfileUpdates`, `logTokenUsage`, `maybeExtractMemory`) all gate on `supabaseUserId` being set. No pipeline changes needed for anonymous mode.

---

**Goal:** Turn the existing autoplay demo on `/` into a real interactive Emersus session. Anonymous visitors get 3 free cited answers per 24 hours per IP.

**Architecture:** New `POST /api/emersus/anon-ask` endpoint reuses the existing pipeline in anonymous mode (no user, no thread, no memory writes). New 24h IP-based rate limiter lives alongside the existing limiters in `api/emersus/rate-limit.js`. The inline landing rotation script gets extracted to `shared/landing-demo.js` with a `takeover()` hook that hands control to a new `shared/landing-chat-runtime.js` anonymous chat runtime.

**Tech Stack:** Express 5, vanilla JS (no bundler), Node 20+, existing SSE streaming, existing `shared/emersus-renderer.js` for widget/citation parsing.

**Spec reference:** `docs/superpowers/specs/2026-04-17-landing-ask-bar-design.md`

---

## File Structure

**Create:**
- `api/emersus/anon-ask.js` — new endpoint handler (~80 lines)
- `tests/anon-ask.test.mjs` — endpoint integration tests
- `tests/anon-rate-limit.test.mjs` — rate limiter unit tests
- `shared/landing-demo.js` — extracted rotation driver + takeover hook
- `shared/landing-chat-runtime.js` — anonymous chat runtime (~180 lines)

**Modify:**
- `api/emersus/rate-limit.js` — add `checkAnonAskRateLimit` + `decrementAnonAskRateLimit` + `AnonAskStore`
- `server.js` — mount `/api/emersus/anon-ask`
- `index.html` — chrome LIVE pill, constant chrome title, replace inline rotation script with module import
- `shared/landing.css` — new rules for pill, wipe, dimmed sidebar, disabled composer, block card

**Out of scope** (separate specs): `/q/:slug` permanent pages, SEO sitemap, curation job, abuse prevention beyond 24h counter.

---

## Task 1: 24h per-IP rate limiter

**Files:**
- Modify: `api/emersus/rate-limit.js` (append at the bottom, near existing `publicRateLimitStore`)
- Create: `tests/anon-rate-limit.test.mjs`

- [ ] **Step 1: Write failing test for basic increment + cap**

Create `tests/anon-rate-limit.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkAnonAskRateLimit,
  decrementAnonAskRateLimit,
  __resetAnonAskStoreForTests,
  ANON_ASK_LIMIT,
} from "../api/emersus/rate-limit.js";

function fakeReq(ip = "1.2.3.4") {
  return { ip, socket: { remoteAddress: ip }, headers: {} };
}

test.beforeEach(() => __resetAnonAskStoreForTests());

test("allows first three requests from same IP", () => {
  const req = fakeReq();
  for (let i = 0; i < ANON_ASK_LIMIT; i++) {
    const r = checkAnonAskRateLimit(req);
    assert.equal(r.allowed, true);
    assert.equal(r.asked, i + 1);
  }
});

test("blocks the fourth request", () => {
  const req = fakeReq();
  for (let i = 0; i < ANON_ASK_LIMIT; i++) checkAnonAskRateLimit(req);
  const r = checkAnonAskRateLimit(req);
  assert.equal(r.allowed, false);
  assert.equal(r.asked, ANON_ASK_LIMIT);
});

test("different IPs are independent", () => {
  for (let i = 0; i < ANON_ASK_LIMIT; i++) checkAnonAskRateLimit(fakeReq("1.1.1.1"));
  const r = checkAnonAskRateLimit(fakeReq("2.2.2.2"));
  assert.equal(r.allowed, true);
  assert.equal(r.asked, 1);
});

test("decrement returns a burned slot", () => {
  const req = fakeReq();
  checkAnonAskRateLimit(req);
  checkAnonAskRateLimit(req);
  decrementAnonAskRateLimit(req);
  const r = checkAnonAskRateLimit(req);
  assert.equal(r.allowed, true);
  assert.equal(r.asked, 2);
});

test("decrement does not go below zero", () => {
  const req = fakeReq();
  decrementAnonAskRateLimit(req);
  const r = checkAnonAskRateLimit(req);
  assert.equal(r.asked, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/anon-rate-limit.test.mjs
```

Expected: FAIL — `checkAnonAskRateLimit is not a function` (module does not export yet).

- [ ] **Step 3: Implement the rate limiter**

Append to `api/emersus/rate-limit.js` before the `export {` block:

```js
// --- Anonymous /api/emersus/anon-ask rate limiter ---
// 3 questions per 24 hours per client IP, in-memory.
// Counter is keyed by IP + UTC date. Bot heuristics are NOT applied here —
// the 3/day cap makes them unnecessary, and we want this path lightweight.

const ANON_ASK_WINDOW_MS = 24 * 60 * 60 * 1000;
const ANON_ASK_LIMIT = 3;
const anonAskStore = new Map();

function anonAskKey(req) {
  const ip = getClientIp(req);
  const utcDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${ip}:${utcDate}`;
}

function checkAnonAskRateLimit(req) {
  const now = Date.now();
  const key = anonAskKey(req);
  let entry = anonAskStore.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + ANON_ASK_WINDOW_MS };
  }
  entry.count += 1;
  anonAskStore.set(key, entry);
  const allowed = entry.count <= ANON_ASK_LIMIT;
  return {
    allowed,
    asked: Math.min(entry.count, ANON_ASK_LIMIT),
    limit: ANON_ASK_LIMIT,
    resetAt: entry.resetAt,
  };
}

function decrementAnonAskRateLimit(req) {
  const key = anonAskKey(req);
  const entry = anonAskStore.get(key);
  if (!entry) return;
  entry.count = Math.max(0, entry.count - 1);
  anonAskStore.set(key, entry);
}

// Test-only reset hook (used by tests/anon-rate-limit.test.mjs).
function __resetAnonAskStoreForTests() {
  anonAskStore.clear();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of anonAskStore) {
    if (entry.resetAt <= now) anonAskStore.delete(key);
  }
}, CLEANUP_INTERVAL_MS).unref();
```

Update the `export {` block at the bottom to add the three new symbols + the constant:

```js
export {
  getClientIp,
  buildRequestMeta,
  checkRateLimit,
  recordGuardrailBlockForRateLimit,
  checkPublicRateLimit,
  publicRateLimitMiddleware,
  RATE_LIMIT_MAX_REQUESTS,
  checkAnonAskRateLimit,
  decrementAnonAskRateLimit,
  __resetAnonAskStoreForTests,
  ANON_ASK_LIMIT,
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/anon-rate-limit.test.mjs
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/rate-limit.js tests/anon-rate-limit.test.mjs
git commit -m "feat(anon-ask): 24h per-IP rate limiter for anonymous ask endpoint"
```

---

## Task 2: Anonymous ask endpoint handler

**Files:**
- Create: `api/emersus/anon-ask.js`
- Create: `tests/anon-ask.test.mjs`

- [ ] **Step 1: Write failing test — 429 on rate limit exceeded**

Create `tests/anon-ask.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/emersus/anon-ask.js";
import {
  __resetAnonAskStoreForTests,
  ANON_ASK_LIMIT,
} from "../api/emersus/rate-limit.js";

function makeReqRes({ method = "POST", body = { question: "What is creatine?" }, ip = "1.2.3.4" } = {}) {
  const headers = { "user-agent": "test-runner" };
  const req = { method, body, ip, socket: { remoteAddress: ip }, headers };
  const res = {
    statusCode: 200,
    headers: {},
    _json: null,
    _writes: [],
    headersSent: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this._json = payload; this.headersSent = true; return this; },
    write(chunk) { this._writes.push(chunk); },
    end() { this.headersSent = true; },
  };
  return { req, res };
}

test.beforeEach(() => __resetAnonAskStoreForTests());

test("rejects non-POST", async () => {
  const { req, res } = makeReqRes({ method: "GET" });
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test("returns 429 when over the 24h limit", async () => {
  // Burn the quota without invoking the pipeline by calling checkAnonAskRateLimit directly
  // is cleaner, but we want to exercise handler. Fire it ANON_ASK_LIMIT times first,
  // ignoring pipeline (it'll fail because no network). We only care about the final 429.
  const ip = "9.9.9.9";
  const { checkAnonAskRateLimit } = await import("../api/emersus/rate-limit.js");
  for (let i = 0; i < ANON_ASK_LIMIT; i++) {
    checkAnonAskRateLimit({ ip, socket: { remoteAddress: ip }, headers: {} });
  }
  const { req, res } = makeReqRes({ ip });
  await handler(req, res);
  assert.equal(res.statusCode, 429);
  assert.equal(res._json.error, "rate_limit");
  assert.equal(res._json.asked, ANON_ASK_LIMIT);
});

test("rejects empty question with 400", async () => {
  const { req, res } = makeReqRes({ body: { question: "" } });
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/anon-ask.test.mjs
```

Expected: FAIL — `Cannot find module '../api/emersus/anon-ask.js'`.

- [ ] **Step 3: Implement the endpoint**

Create `api/emersus/anon-ask.js`:

```js
import { generateRecommendationStream, parseJsonBody } from "./workflow.js";
import {
  buildRequestMeta,
  checkAnonAskRateLimit,
  decrementAnonAskRateLimit,
} from "./rate-limit.js";

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(204).end();
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ message: "Method not allowed." });
    }

    const body = parseJsonBody(req);
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return res.status(400).json({ message: "Question is required." });
    }

    const rateLimit = checkAnonAskRateLimit(req);
    res.setHeader("X-Anon-Ask-Asked", rateLimit.asked);
    res.setHeader("X-Anon-Ask-Limit", rateLimit.limit);

    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: "rate_limit",
        asked: rateLimit.asked,
        limit: rateLimit.limit,
        resetAt: rateLimit.resetAt,
      });
    }

    // Anonymous pipeline input: no user, no thread, no memory.
    // sanitize() tolerates empty userId/threadId — no persistence is attempted
    // downstream when userId is falsy. Verified in Task 3 with a smoke test.
    const pipelineInput = {
      question,
      userId: "",
      threadId: "",
      threadState: {},
      recentMessages: [],
      profile: {},
      requestMeta: buildRequestMeta(req),
    };

    // Track completion so we can roll back the counter on abort/error.
    let completed = false;
    const finalize = () => { if (!completed) decrementAnonAskRateLimit(req); };
    res.on("close", finalize);

    try {
      await generateRecommendationStream(pipelineInput, res);
      completed = true;
    } catch (err) {
      completed = false; // ensure rollback
      if (!res.headersSent) {
        console.error("anon-ask handler error:", err);
        return res.status(500).json({ message: "Unable to generate a response. Please try again." });
      }
      // Headers already sent — generateRecommendationStream writes its own error event.
    }
  } catch (error) {
    if (!res.headersSent) {
      console.error("anon-ask handler outer error:", error);
      return res.status(500).json({ message: "Unable to generate a response. Please try again." });
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/anon-ask.test.mjs
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/anon-ask.js tests/anon-ask.test.mjs
git commit -m "feat(anon-ask): anonymous streaming endpoint with counter rollback on abort"
```

---

## Task 3: Mount endpoint in server.js and smoke test anonymous path

**Files:**
- Modify: `server.js` (around lines 49–90)

- [ ] **Step 1: Add the import**

In `server.js`, after the existing `const { default: recommendationHandler } = await import(...)` line (~line 49), add:

```js
const { default: anonAskHandler } = await import("./api/emersus/anon-ask.js");
```

- [ ] **Step 2: Mount the route**

In `server.js`, after the `/api/emersus/recommendation` route line (~line 89), add:

```js
app.post("/api/emersus/anon-ask", anonAskHandler);
```

Note: no `requireAuth`, no `publicRateLimitMiddleware` — the rate limit lives inside the handler because we need per-IP granularity with custom semantics.

- [ ] **Step 3: Smoke test anonymous pipeline path**

Run the server locally:

```bash
npm run dev
```

In another terminal:

```bash
curl -N -X POST http://localhost:3000/api/emersus/anon-ask \
  -H "Content-Type: application/json" \
  -d '{"question":"How much protein per kg for hypertrophy?"}' | head -c 2000
```

Expected: SSE stream with `data: {...}` events containing text chunks and citations. Confirms anonymous pipeline works end-to-end.

- [ ] **Step 4: Verify rate limit actually triggers**

```bash
for i in 1 2 3 4; do
  echo "=== request $i ==="
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/emersus/anon-ask \
    -H "Content-Type: application/json" \
    -d '{"question":"test question '"$i"'"}'
done
```

Expected: first three return `200`, fourth returns `429`.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(anon-ask): mount /api/emersus/anon-ask route"
```

---

## Task 4: Extract inline rotation script to shared/landing-demo.js

**Files:**
- Create: `shared/landing-demo.js`
- Modify: `index.html` (lines 758–989)

This is a refactor: move the IIFE into a module, no behavior change.

- [ ] **Step 1: Create the module**

Create `shared/landing-demo.js`. Copy the current inline IIFE contents from `index.html:758–989` into it, stripping the `<script>` tags. Change the outer IIFE to an exported `start()` function:

```js
// Landing hero demo — three-rotation loop.
// Phases per rotation: composer-typing → send-flight → thinking →
// intro-stream → widget-skeleton → widget-filled → cite-pill → thread-swap.
// Stylized only — widgets are pre-rendered DOM toggled via data-rotation.
// Reduced-motion users see rotation A in its final state, no loop.

let started = false;
let stopped = false;

export function start() {
  if (started) return;
  started = true;

  const demoRoot = document.getElementById('demo');
  const main = document.querySelector('.demo-main');
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

  // (... copy the ROTATIONS array and all helper functions verbatim ...)

  async function loop() {
    let i = 0;
    while (!stopped) {
      await runRotation(ROTATIONS[i % ROTATIONS.length]);
      i++;
    }
  }

  // (... copy renderStaticA, reduced-motion branch, IntersectionObserver ...)
}

// Stop the rotation. Called by landing-chat-runtime before takeover.
export function stop() {
  stopped = true;
}
```

Key changes from the original IIFE:
- Wrap in `export function start()`.
- Add module-scoped `started` (idempotency) and `stopped` (loop break flag).
- Change `while (true)` in `loop()` to `while (!stopped)`.
- Export a `stop()` function.

Copy the rest of the body verbatim, preserving the `ROTATIONS` array, `typeComposer`, `streamText`, `countTo`, `setActiveSidebar`, `renderCite`, `showThinkingDots`, `clearBubbleContents`, `animateWidgetC`, `runRotation`, `renderStaticA`, and the `IntersectionObserver` block.

- [ ] **Step 2: Replace the inline script in index.html**

In `index.html`, replace the entire `<script>…</script>` block spanning lines 758–989 (the landing hero demo script) with a single module import. Keep the `</main>` and `</body>` surroundings untouched.

```html
  </main>

  <script type="module">
    import { start as startLandingDemo } from '/shared/landing-demo.js';
    startLandingDemo();
  </script>
```

- [ ] **Step 3: Manual verification — rotation still works**

Load `http://localhost:3000/` in a browser. Watch the demo for at least one full rotation cycle (all three: creatine → TDEE → protein). Confirm:
- Typing animation into the composer still plays.
- Thread title still updates per rotation.
- Widgets still render and animate.
- Cite pill still appears.

No regressions. If anything is off, diff against the original IIFE — the refactor is purely structural.

- [ ] **Step 4: Commit**

```bash
git add index.html shared/landing-demo.js
git commit -m "refactor(landing): extract inline demo rotation to shared/landing-demo.js module"
```

---

## Task 5: Chrome LIVE pill + constant chrome title

**Files:**
- Modify: `index.html` (~line 216 for chrome structure)
- Modify: `shared/landing.css` (append new rules)
- Modify: `shared/landing-demo.js` (remove per-rotation chrome title updates)

- [ ] **Step 1: Add the LIVE pill markup to the demo chrome**

In `index.html`, find the `.demo-chrome` block (around line 214):

```html
<div class="demo-chrome">
  <div class="dot-row"><span></span><span></span><span></span></div>
  <div class="chrome-title">emersus.ai — creatine vs beta-alanine</div>
</div>
```

Replace with:

```html
<div class="demo-chrome">
  <div class="dot-row"><span></span><span></span><span></span></div>
  <div class="chrome-title">emersus.ai — ask anything below</div>
  <div class="chrome-live-pill" aria-hidden="true">
    <span class="chrome-live-dot"></span>LIVE
  </div>
</div>
```

- [ ] **Step 2: Add CSS for the pill and update chrome layout**

Append to `shared/landing.css`:

```css
/* ── Landing demo: LIVE pill in chrome bar ───────────────────────── */
.demo-chrome {
  display: flex;
  align-items: center;
  gap: 10px;
}
.demo-chrome .chrome-title {
  flex: 1;
  text-align: center;
}
.chrome-live-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #1c7a4a;
  color: #fdfbf5;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.1em;
  padding: 3px 8px;
  border-radius: 999px;
  text-transform: uppercase;
}
.chrome-live-dot {
  width: 5px;
  height: 5px;
  background: #5ed39b;
  border-radius: 50%;
  animation: chromeLivePulse 2s infinite;
}
@keyframes chromeLivePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

(Verify the existing `.demo-chrome` rules; if it already sets `display: flex`, adjust instead of duplicating. If it uses grid or a different layout, keep this append but remove the duplicate layout properties here.)

- [ ] **Step 3: Remove per-rotation chrome-title mutation in landing-demo.js**

In `shared/landing-demo.js`:
- Remove every write to `chromeTitle.textContent` and `chromeTitle.style.opacity`.
- Remove `chromeTitle.style.opacity = '0.15'` fades and restores.
- Leave the `chromeTitle` variable declared but unused, or remove the `getElementById` if preferred.
- Remove the `chromeTitle: 'emersus.ai — ...'` field from each `ROTATIONS` entry (dead data now).

Concretely, in `runRotation`, delete lines like:
```js
chromeTitle.style.opacity = '0.15';
chromeTitle.textContent = cfg.chromeTitle;
chromeTitle.style.opacity = '';
```

And in `renderStaticA`:
```js
chromeTitle.textContent = cfg.chromeTitle;
```

- [ ] **Step 4: Manual verification**

Reload `/`. Confirm:
- Chrome title now reads `emersus.ai — ask anything below` constantly across all three rotations.
- Green LIVE pill sits on the right side of the chrome bar with a pulsing dot.
- Thread title (inside `.demo-header`, not the chrome) still updates per rotation. (This is the non-chrome title — don't confuse them.)

- [ ] **Step 5: Commit**

```bash
git add index.html shared/landing.css shared/landing-demo.js
git commit -m "feat(landing): LIVE pill in demo chrome + static 'ask anything below' title"
```

---

## Task 6: CSS for takeover wipe, dimmed sidebar, disabled composer, block card

**Files:**
- Modify: `shared/landing.css` (append)

- [ ] **Step 1: Append CSS rules**

Append to `shared/landing.css`:

```css
/* ── Landing demo: takeover state ────────────────────────────────── */

/* Fade-out transition on old content during the T3 wipe. */
.demo-main[data-mode="wiping"] .msg,
.demo-main[data-mode="wiping"] .cite-pill,
.demo-main[data-mode="wiping"] .demo-widget,
.demo-main[data-mode="wiping"] .thread-welcome-demo {
  transition: opacity 300ms ease-out;
  opacity: 0;
}

/* Sidebar items dim to 30% and become non-interactive during anon-chat mode. */
.demo-main[data-mode="anon-chat"] ~ .demo-side .side-item,
.demo-side[data-dimmed="true"] .side-item {
  opacity: 0.3;
  pointer-events: none;
}

/* Composer disabled state (block card active). */
.composer[data-disabled="true"] {
  opacity: 0.5;
  pointer-events: none;
}
.composer[data-disabled="true"] .composer-input {
  color: #9a8f75;
  cursor: not-allowed;
}

/* Block card after the 3rd question. */
.anon-block-card {
  margin: 16px 0 8px;
  padding: 14px 16px;
  background: #fdfbf5;
  border: 1px solid #d8d2c4;
  border-radius: 8px;
  text-align: center;
}
.anon-block-card-title {
  font-size: 13px;
  font-weight: 600;
  color: #1a1713;
  margin: 0 0 4px;
}
.anon-block-card-copy {
  font-size: 12px;
  color: #5a5347;
  margin: 0 0 12px;
}
.anon-block-card-actions {
  display: inline-flex;
  gap: 8px;
}
.anon-block-card-actions .btn { font-size: 12px; padding: 6px 14px; }

/* Inline error/refusal messages in anon chat. */
.anon-inline-hint {
  font-size: 11px;
  color: #7a7364;
  font-style: italic;
  padding: 6px 10px;
  margin: 4px 0;
  text-align: center;
}
.anon-inline-error {
  font-size: 12px;
  color: #b04242;
  padding: 8px 12px;
  margin: 6px 0;
  background: #fef0ed;
  border-radius: 4px;
  text-align: center;
}
```

- [ ] **Step 2: Manual verification**

These rules won't render until later tasks trigger them. Just confirm the file parses (reload `/`, no console errors, rotation still plays).

- [ ] **Step 3: Commit**

```bash
git add shared/landing.css
git commit -m "feat(landing): CSS for anon-chat takeover states and block card"
```

---

## Task 7: Landing chat runtime — scaffold + SSE streaming

**Files:**
- Create: `shared/landing-chat-runtime.js`

This runtime mounts into the demo frame's `.msgs` container and handles the anonymous chat loop. Keep it standalone — it does NOT import `shared/react-chat-app.js` (that module assumes auth / persistence). We render minimal DOM directly. Citation + widget parity comes in Task 8.

- [ ] **Step 1: Create the runtime module**

Create `shared/landing-chat-runtime.js`:

```js
// Anonymous landing chat runtime. Mounted into the demo frame after takeover.
// No Supabase, no auth, no persistence beyond localStorage. Talks to
// /api/emersus/anon-ask over SSE.

const STORAGE_KEY_PREFIX = 'emersus.anon.';
const LIMIT = 3;

function todayKey() {
  return STORAGE_KEY_PREFIX + new Date().toISOString().slice(0, 10);
}

function loadState() {
  try {
    const raw = localStorage.getItem(todayKey());
    if (!raw) return { asked: 0, messages: [], capped: false };
    const parsed = JSON.parse(raw);
    return {
      asked: Number(parsed.asked) || 0,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      capped: Boolean(parsed.capped),
    };
  } catch {
    return { asked: 0, messages: [], capped: false };
  }
}

function saveState(state) {
  try { localStorage.setItem(todayKey(), JSON.stringify(state)); }
  catch { /* quota or disabled — ignore */ }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function appendUserBubble(msgsContainer, text) {
  const row = el('div', 'msg msg-user');
  row.appendChild(el('div', 'bubble', text));
  msgsContainer.appendChild(row);
  return row;
}

function appendAssistBubble(msgsContainer) {
  const row = el('div', 'msg msg-assist');
  const bubble = el('div', 'bubble');
  row.appendChild(bubble);
  msgsContainer.appendChild(row);
  return { row, bubble };
}

function scrollToBottom(msgsContainer) {
  msgsContainer.scrollTop = msgsContainer.scrollHeight;
}

// Stream a POST SSE response. Calls onChunk(textDelta) for each text chunk,
// onDone() on stream completion, onError(err) on any failure.
async function streamAnonAsk(question, { onChunk, onDone, onError }) {
  try {
    const resp = await fetch('/api/emersus/anon-ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    if (resp.status === 429) {
      const body = await resp.json().catch(() => ({}));
      return onError({ kind: 'rate_limit', asked: body.asked || LIMIT });
    }
    if (!resp.ok) {
      return onError({ kind: 'http', status: resp.status });
    }
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      // Pipeline may ShortCircuit and return JSON (e.g. safety refusal).
      const body = await resp.json().catch(() => ({}));
      const message = body.summary || body.answer_text || body.message || '';
      if (message) onChunk(message);
      return onDone({ shortCircuit: true, body });
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload) continue;
        try {
          const msg = JSON.parse(payload);
          if (msg.type === 'prose') {
            onChunk(msg.delta || '');
          } else if (msg.type === 'tool') {
            onTool && onTool(msg.name, msg.data);
          } else if (msg.type === 'tool_error') {
            // Log-only — the prose will reflect the failure if the model retries.
            console.warn('[anon-ask] tool_error', msg.name, msg.errors);
          } else if (msg.type === 'error') {
            return onError({ kind: 'stream_error', message: msg.message });
          } else if (msg.type === 'done') {
            return onDone({ sources: msg.sources || [], confidence: msg.confidence });
          }
        } catch {
          // Not JSON — ignore. The pipeline always emits JSON.
        }
      }
    }
    onDone({});
  } catch (err) {
    onError({ kind: 'network', error: err });
  }
}

export function boot({ msgsContainer, composer, composerInput, threadTitle, threadMeta, sidebar }) {
  const state = loadState();

  // Restore prior messages (if any) from localStorage.
  for (const m of state.messages) {
    if (m.role === 'user') appendUserBubble(msgsContainer, m.text);
    else {
      const { bubble } = appendAssistBubble(msgsContainer);
      bubble.textContent = m.text;
    }
  }
  if (state.capped) {
    renderBlockCard(msgsContainer, composer);
  }
  scrollToBottom(msgsContainer);

  composer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  });

  // Handle plain click-to-focus — composer is a contenteditable div.
  composerInput.setAttribute('contenteditable', 'true');
  composerInput.focus();

  async function handleSubmit() {
    if (state.capped || composer.dataset.disabled === 'true') return;
    const question = (composerInput.textContent || '').trim();
    if (!question) return;

    composerInput.textContent = '';
    appendUserBubble(msgsContainer, question);
    const { bubble } = appendAssistBubble(msgsContainer);
    composer.dataset.disabled = 'true';
    state.messages.push({ role: 'user', text: question });
    scrollToBottom(msgsContainer);

    let accumulated = '';

    await streamAnonAsk(question, {
      onChunk: (delta) => {
        accumulated += delta;
        bubble.textContent = accumulated;
        scrollToBottom(msgsContainer);
      },
      onDone: () => {
        state.messages.push({ role: 'assistant', text: accumulated });
        state.asked += 1;
        if (state.asked >= LIMIT) {
          state.capped = true;
          renderBlockCard(msgsContainer, composer);
        } else {
          composer.dataset.disabled = 'false';
          composerInput.focus();
        }
        saveState(state);
        scrollToBottom(msgsContainer);
      },
      onError: (errInfo) => {
        if (errInfo.kind === 'rate_limit') {
          state.asked = LIMIT;
          state.capped = true;
          bubble.remove();
          renderBlockCard(msgsContainer, composer);
          saveState(state);
          return;
        }
        bubble.remove();
        const err = el('div', 'anon-inline-error',
          'Something went wrong — try again.');
        msgsContainer.appendChild(err);
        composer.dataset.disabled = 'false';
        composerInput.focus();
        scrollToBottom(msgsContainer);
      },
    });
  }
}

function renderBlockCard(msgsContainer, composer) {
  const card = el('div', 'anon-block-card');
  card.appendChild(el('p', 'anon-block-card-title',
    "You've used your 3 free questions."));
  card.appendChild(el('p', 'anon-block-card-copy',
    'Sign up — free — to save this conversation and keep asking.'));
  const actions = el('div', 'anon-block-card-actions');
  const signup = el('a', 'btn btn-accent', 'Sign up →');
  signup.href = '/auth/?panel=signup';
  const login = el('a', 'btn', 'Log in');
  login.href = '/auth/';
  actions.append(signup, login);
  card.appendChild(actions);
  msgsContainer.appendChild(card);

  composer.dataset.disabled = 'true';
  const input = composer.querySelector('.composer-input');
  if (input) {
    input.setAttribute('contenteditable', 'false');
    input.innerHTML = '<span class="composer-placeholder">Sign up to ask more</span>';
  }
  // Focus the primary CTA for keyboard users.
  setTimeout(() => signup.focus(), 0);
}
```

- [ ] **Step 2: Manual verification — module parses**

Reload `/`. Rotation still plays (no behavior change yet). Confirm no console errors on page load. The module is defined but not yet imported.

- [ ] **Step 3: Commit**

```bash
git add shared/landing-chat-runtime.js
git commit -m "feat(landing): anonymous chat runtime — SSE stream, state persistence, block card"
```

---

## Task 8: Takeover hook in landing-demo.js

**Files:**
- Modify: `shared/landing-demo.js` (add takeover() and composer click listener)

- [ ] **Step 1: Add the takeover function + click wiring**

In `shared/landing-demo.js`, inside `start()` after the IntersectionObserver block, add:

```js
  // ── Takeover: composer click hands control to landing-chat-runtime ──
  const composer = document.querySelector('.composer');
  if (composer) {
    composer.addEventListener('click', handleTakeover, { once: true });
  }

  let tookOver = false;

  async function handleTakeover() {
    if (tookOver) return;
    tookOver = true;

    // Break the rotation loop. Any current await will finish, then
    // loop() exits because stopped = true (see stop()).
    stop();

    // T3 wipe: fade existing content, then clear.
    main.dataset.mode = 'wiping';
    const side = document.querySelector('.demo-side');
    if (side) side.dataset.dimmed = 'true';
    await new Promise((r) => setTimeout(r, 320));

    // Unmount the rotation-rendered content.
    clearBubbleContents();
    document.querySelectorAll('.demo-widget').forEach((w) => {
      w.classList.remove('skeleton', 'filled');
      w.hidden = true;
    });
    const welcome = document.getElementById('demo-welcome');
    if (welcome) welcome.style.display = 'none';

    threadTitle.textContent = 'New chat';
    threadMeta.textContent = '';

    main.dataset.mode = 'anon-chat';

    // Boot the anonymous chat runtime into the same .msgs container.
    const { boot } = await import('/shared/landing-chat-runtime.js');
    const msgsContainer = document.querySelector('.demo-main .msgs');
    const composerInput = document.getElementById('demo-composer-input');
    composerInput.innerHTML = ''; // clear placeholder span
    boot({
      msgsContainer,
      composer,
      composerInput,
      threadTitle,
      threadMeta,
      sidebar: side,
    });
  }
```

- [ ] **Step 2: Manual verification — takeover smoke test**

Reload `/`. Wait for the demo to start rotating. Click the composer:
1. Existing content fades to 0 opacity over ~300ms.
2. Sidebar items dim to 30%.
3. Thread title changes to "New chat".
4. Composer is focused and editable.
5. Type "How much protein per kg?" and press Enter.
6. User bubble appears. Assistant bubble starts filling with streamed text.
7. Confirm the response contains citations-style references (the raw text will include `[1]`, `[2]` tokens — widget/citation rendering comes in Task 9).

- [ ] **Step 3: Commit**

```bash
git add shared/landing-demo.js
git commit -m "feat(landing): T3 takeover wipe + handoff to anon chat runtime on composer click"
```

---

## Task 9: Wire citations and widgets via emersus-renderer

**Files:**
- Modify: `shared/landing-chat-runtime.js`

The minimal runtime renders raw text. Full parity — widget fences, citations, grade pills — requires feeding the streamed text through `shared/emersus-renderer.js` (or equivalent). Wire it up.

- [ ] **Step 1: Check how emersus-renderer exposes its API**

```bash
node -e "import('./shared/emersus-renderer.js').then(m => console.log(Object.keys(m)))"
```

Expected output: list of exported names. Typical names: `parseEmersus`, `renderMessage`, `renderAssistantMessage`, or a default export. Note the exact name(s).

- [ ] **Step 2: Integrate the renderer into the assistant bubble**

In `shared/landing-chat-runtime.js`, replace the `onChunk` implementation inside `handleSubmit`:

```js
      onChunk: (delta) => {
        accumulated += delta;
        // Re-render the whole bubble each tick. emersus-renderer parses
        // widget fences and citation tokens from the full buffer. The
        // existing /chat/ uses this exact pattern — re-rendering is cheap
        // because the DOM is scoped to one bubble.
        bubble.innerHTML = '';
        const rendered = renderAssistantContent(accumulated);
        bubble.appendChild(rendered);
        scrollToBottom(msgsContainer);
      },
```

Add a `renderAssistantContent(text)` helper at the bottom of the module. Reuse whichever `emersus-renderer` export matches the existing pattern in `shared/react-chat-app.js`. Example (adjust to match actual API):

```js
import { renderToElement } from '/shared/emersus-renderer.js';

function renderAssistantContent(buffer) {
  const container = document.createElement('div');
  renderToElement(container, buffer, { mode: 'anonymous' });
  return container;
}
```

If `emersus-renderer` does not export something that takes a string buffer and produces DOM, look at how `shared/react-chat-app.js` uses it and replicate the minimal call pattern. The goal: widgets (fenced blocks like ```widget\n{...}```) and citation tokens (`[1]`, `[2]`) render the same way they do in the authenticated chat.

- [ ] **Step 3: Verify widget + citation rendering**

Reload `/`, trigger takeover, ask a question that produces a widget. Good test questions:
- "What's my TDEE at 82 kg, 178 cm, 28 years old, moderately active?" → should produce a TDEE widget.
- "How much protein per kg for hypertrophy?" → should produce citations with grade pills.

Expected: widgets render inline with proper styling; citations show as pills with grade labels.

If rendering breaks, diff against how `shared/react-chat-app.js` invokes the renderer and match its call shape.

- [ ] **Step 4: Commit**

```bash
git add shared/landing-chat-runtime.js
git commit -m "feat(landing): render widgets and citations through emersus-renderer in anon chat"
```

---

## Task 10: Safety-refusal inline hint

**Files:**
- Modify: `shared/landing-chat-runtime.js`

Safety refusals (e.g. off-topic questions) return as ShortCircuit JSON from the pipeline — `streamAnonAsk` already detects `content-type != event-stream` and calls `onChunk(message); onDone({ shortCircuit: true })`. Add a visible hint when that happens.

- [ ] **Step 1: Detect refusal in onDone and render the hint**

In `shared/landing-chat-runtime.js`, update `onDone`:

```js
      onDone: (info) => {
        state.messages.push({ role: 'assistant', text: accumulated });
        state.asked += 1;
        if (info.shortCircuit) {
          const hint = el('div', 'anon-inline-hint',
            'Emersus is tuned for fitness, nutrition, and exercise science — try one of those.');
          msgsContainer.appendChild(hint);
        }
        if (state.asked >= LIMIT) {
          state.capped = true;
          renderBlockCard(msgsContainer, composer);
        } else {
          composer.dataset.disabled = 'false';
          composerInput.focus();
        }
        saveState(state);
        scrollToBottom(msgsContainer);
      },
```

- [ ] **Step 2: Manual verification**

Reload `/`, trigger takeover, ask an off-topic question: "How do I write a Python web scraper?"

Expected:
- Short refusal message renders in the assistant bubble.
- Below it, the italic hint appears: "Emersus is tuned for fitness, nutrition, and exercise science — try one of those."
- Question counts against the 3-question limit.

- [ ] **Step 3: Commit**

```bash
git add shared/landing-chat-runtime.js
git commit -m "feat(landing): inline hint after off-topic safety refusals in anon chat"
```

---

## Task 11: End-to-end manual verification

**No file changes.** This is the verification step before calling the feature done. Follow the checklist in the spec.

- [ ] **Step 1: Fresh state walkthrough**

Clear localStorage for the site and restart the server (fresh rate-limit counter):

```bash
# in a browser devtools console on /
localStorage.clear();
```

Reload. Confirm:
1. Rotation autoplays.
2. Chrome title is `emersus.ai — ask anything below` with green pulsing LIVE pill.
3. Click composer → wipe plays, sidebar dims, thread title becomes "New chat", composer focused.
4. Submit "How much protein per kg for hypertrophy?" → answer streams with at least one citation pill.
5. Submit "What's my TDEE at 82 kg, 178 cm, 28 years old, moderately active?" → answer streams with TDEE widget.
6. Submit one more question → 3rd answer streams, then block card appears below it.
7. Composer disables with "Sign up to ask more" placeholder.
8. Click "Sign up →" in block card → lands on `/auth/?panel=signup`.

- [ ] **Step 2: Refresh persistence**

With the block card still visible, reload `/`. Confirm:
- The 3 prior Q&A render in the demo frame.
- Block card is visible.
- Composer remains disabled.

- [ ] **Step 3: Rate-limit enforcement across refresh**

Open devtools, `localStorage.clear()`. Do NOT reload. Confirm that submitting a new question still returns a block card immediately (because the server-side counter is still at 3).

- [ ] **Step 4: Off-topic refusal**

Clear both localStorage AND restart the server (to reset the in-memory rate limiter). Trigger takeover, ask "How do I write a Python web scraper?". Confirm:
- Short refusal renders.
- Italic hint appears below.
- Counter increments (you now have 2 questions left).

- [ ] **Step 5: Mid-stream failure rollback**

Disable network in devtools (Throttling: Offline). Trigger takeover, ask any question. Confirm:
- "Something went wrong — try again" error renders.
- Composer re-enables.
- Counter does NOT increment (asking again after re-enabling network still gives a full remaining budget).

- [ ] **Step 6: Accessibility check**

From a fresh reload with cleared state, Tab from the hero Sign-up button. Confirm you can reach the composer with keyboard, focus it, type, submit with Enter. After the block card renders, Tab lands on the Sign up button in the card.

- [ ] **Step 7: Commit the verification notes (optional)**

No code to commit. If you added any touch-up tweaks during verification, commit them separately with clear messages.

---

## Self-Review Notes

**Spec coverage:**
- User flow: Tasks 4, 5, 8 (rotation + chrome + takeover); Task 7, 9 (streaming answers); Task 11 (end-to-end)
- Discoverability (chrome pill): Task 5
- Takeover behavior (T3 wipe, sidebar dim, thread title reset): Tasks 6, 8
- Growth mode (fixed + scroll): handled by reusing the existing `.msgs` overflow — Task 7's `scrollToBottom` + existing CSS
- Rate limit (S3 IP, 3 per 24h): Task 1 + Task 2
- Upgrade prompt (U1 post-answer card): Task 7's `renderBlockCard`
- Data flow end-to-end: Tasks 2, 3, 7, 9, 10
- Error handling: Tasks 2, 7, 10 + Task 11 step 5
- Testing: Tasks 1, 2 (backend unit); Task 11 (manual checklist)

**Type consistency check:**
- `checkAnonAskRateLimit` returns `{ allowed, asked, limit, resetAt }` — used consistently in Tasks 1, 2
- `decrementAnonAskRateLimit` signature matches Task 2 usage
- `streamAnonAsk` callbacks `{ onChunk, onDone, onError }` — Task 7 defines them, Tasks 9, 10 modify them in place (same names)
- `boot({ msgsContainer, composer, composerInput, threadTitle, threadMeta, sidebar })` — Task 7 defines, Task 8 calls with matching keys
- `renderBlockCard(msgsContainer, composer)` — Task 7 defines, used in same file

**Known deferred items** (explicitly in spec, not in this plan):
- `/q/:slug` permanent URLs → separate spec
- Slug generation / anonymous_questions table → separate spec (curation)
- Cross-process rate limiting (Redis/Postgres) → separate spec if abuse materializes
- Cross-browser visual QA → out of scope

**Risk notes for the implementer:**
- Task 9 assumes `shared/emersus-renderer.js` has a reusable render-to-DOM entry point. If its API is tightly coupled to React, fall back to rendering raw text in Task 7's bubble and file a follow-up task. The commit in Task 9 can land later without blocking earlier tasks.
- Task 4's refactor must preserve rotation timing exactly — any visible regression means diff the extracted code against `index.html:758–989` carefully.
- The pipeline's `sanitize` stage may reject empty `userId`. If Task 3's smoke test returns a 400 from the pipeline itself, the fix is to pass a synthetic `userId: "anon"` or add a bypass flag; update `anon-ask.js` accordingly.
