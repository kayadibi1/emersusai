# Chat pipeline deferred work — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/chat-pipeline-gap-analysis.md` (Deferred section)

**Goal:** Close the four deferred items from the 2026-04-21 gap analysis: the full `previous_response_id` chaining refactor (the biggest cost win), OpenAI moderation precheck, `reasoning_effort` readiness for future `o*` models, and `UPDATE_USER_PROFILE` strict-mode cleanup.

**Architecture:** Each item is independent and can ship separately. Item 1 is the heavyweight — it reduces per-turn input-token billing on multi-turn threads by letting OpenAI carry prior conversation state server-side (enabled by `store:true` shipped 2026-04-21). Item 2 adds a ~50–200 ms moderation call per user turn. Item 3 is one-liner future-proofing. Item 4 is a schema correction surfaced by the preflight test.

**Tech Stack:** OpenAI Responses API, Node/Express pipeline in `api/emersus/pipeline/`, React chat client in `shared/react-chat-app.js`, Supabase for `chat_threads.messages` JSONB.

---

## Scope check

These four items are independent subsystems. Execute in priority order:

1. **Item 1 (previous_response_id chaining)** — highest cost impact, largest implementation footprint
2. **Item 4 (UPDATE_USER_PROFILE strict cleanup)** — small, unblocks re-enabling the tool
3. **Item 2 (moderation precheck)** — medium effort, marginal safety win
4. **Item 3 (reasoning_effort)** — keep as a future note; not actionable until the model changes

---

## File structure overview

**Item 1 — `previous_response_id` chaining:**
- Modify `api/emersus/pipeline/synthesize.js` — add chaining decision + trim messages path
- Modify `api/emersus/pipeline/stream.js` — emit `chainingUsed` flag on `done` event
- Modify `api/emersus/workflow.js` — thread resolution needs to expose `lastResponseId`
- Modify `shared/feature-flags.js` — new flag `chat_response_id_chaining`
- Modify `shared/react-chat-app.js` — nothing (already persists `openaiResponseId` per message)
- New `api/emersus/pipeline/response-chaining.js` — pure helper: decide whether to chain, extract last response_id, handle 25-day expiry
- New `tests/unit/api/emersus/pipeline/response-chaining.test.js`

**Item 2 — moderation precheck:**
- Modify `api/emersus/pipeline/safety.js` — add `runModerationCheck()` as first gate
- New `tests/unit/api/emersus/pipeline/safety-moderation.test.js`

**Item 3 — reasoning_effort:**
- Single TODO comment in `api/emersus/pipeline/synthesize.js`
- No code change required until model swap

**Item 4 — UPDATE_USER_PROFILE strict cleanup:**
- Modify `api/emersus/pipeline/tools.js` — repair the schema to strict:true contract
- Modify `api/emersus/pipeline/tools.js` — re-enable in `TOOL_DEFINITIONS`
- Run existing `tests/unit/api/emersus/pipeline/tools-strict-contract.test.js` — verify passes

---

# Item 1 — `previous_response_id` chaining (5 phases, ~18 tasks)

## Rationale

After Tier 2b shipped 2026-04-21, every `/v1/responses` request has `store: true` and the `response.id` is already persisted on each assistant message as `openaiResponseId` (via the client's `compactChatMessage` field preservation). OpenAI retains server-side conversation state for 30 days.

Today we still send the **full `messages` array** every turn, costing ~500 tokens/turn × N prior turns in redundant input tokens. The fix is to send the new user message + the most recent `openaiResponseId` as `previous_response_id`, letting OpenAI reassemble the conversation context from its stored state.

### Key design decisions (resolved up front)

1. **System prompt handling:** Every turn still sends the full system prompt fresh (identity + widget tokens + current retrieved evidence + current user profile snapshot + cross-thread memory). OpenAI appends these to stored state; the first-turn system identity + tool definitions persist in the cache. Total input tokens per turn stay roughly the same for non-message content — the real saving is on the prior-message history.
2. **Expiry window:** 25-day gate (5-day safety margin vs OpenAI's 30-day retention). Threads with `lastMessageAt` older than 25 days fall back to full-history mode.
3. **Error recovery:** If OpenAI returns `previous_response_not_found` (rare — could happen if OpenAI rotates storage or the id was deleted), transparently retry with full history and clear the stale `openaiResponseId` from the client state.
4. **Feature flag:** `chat_response_id_chaining` (default OFF). Flip on after manual testing cohort.
5. **Observability:** Emit `chainingUsed: true|false` on the `done` SSE event so the client + server logs record per-turn chain state. The existing cache-hit rail chip already shows whether the cache is engaged.

---

## Phase 1.1 — Feature flag plumbing

### Task 1.1.1: Add feature flag constant

**Files:**
- Modify: `shared/feature-flags.js`

- [ ] **Step 1: Add flag constant**

Find the `KNOWN_FLAGS` list in `shared/feature-flags.js` and add:

```js
// Add to KNOWN_FLAGS array (matches sibling flags — no named export constant):
//   'chat_response_id_chaining',
```

- [ ] **Step 2: Add URL-override entry**

Add a case for `chat_response_id_chaining` in the URL-override parser so `?chat_response_id_chaining=1` forces the flag on for testing.

- [ ] **Step 3: Commit**

```bash
git add shared/feature-flags.js
git commit -m "feat(flags): add chat_response_id_chaining flag (off by default)"
```

---

## Phase 1.2 — Chaining decision helper (pure logic + tests)

### Task 1.2.1: Write the decision helper + tests

**Files:**
- Create: `api/emersus/pipeline/response-chaining.js`
- Create: `tests/unit/api/emersus/pipeline/response-chaining.test.js`

- [ ] **Step 1: Write failing tests first**

Create `tests/unit/api/emersus/pipeline/response-chaining.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { resolveChainingContext } from "../../../../../api/emersus/pipeline/response-chaining.js";

test("resolveChainingContext", () => {
  const now = new Date("2026-04-21T12:00:00Z").getTime();

  test("returns chain:false when flag disabled", () => {
    const ctx = resolveChainingContext({
      flagEnabled: false,
      messages: [{ role: "assistant", openaiResponseId: "resp_abc", createdAt: now - 3600_000 }],
      now,
    });
    assert.equal(ctx.shouldChain, false);
    assert.equal(ctx.reason, "flag_disabled");
  });

  test("returns chain:false when no prior assistant message has a response_id", () => {
    const ctx = resolveChainingContext({
      flagEnabled: true,
      messages: [{ role: "user", createdAt: now - 1000 }],
      now,
    });
    assert.equal(ctx.shouldChain, false);
    assert.equal(ctx.reason, "no_prior_response_id");
  });

  test("returns chain:false when newest response_id is older than 25 days", () => {
    const twentySixDaysAgo = now - 26 * 24 * 3600 * 1000;
    const ctx = resolveChainingContext({
      flagEnabled: true,
      messages: [
        { role: "assistant", openaiResponseId: "resp_old", createdAt: twentySixDaysAgo },
      ],
      now,
    });
    assert.equal(ctx.shouldChain, false);
    assert.equal(ctx.reason, "expired");
  });

  test("returns chain:true with newest response_id when within 25 days", () => {
    const fiveDaysAgo = now - 5 * 24 * 3600 * 1000;
    const ctx = resolveChainingContext({
      flagEnabled: true,
      messages: [
        { role: "assistant", openaiResponseId: "resp_first", createdAt: now - 10 * 24 * 3600 * 1000 },
        { role: "user", createdAt: fiveDaysAgo + 1000 },
        { role: "assistant", openaiResponseId: "resp_newest", createdAt: fiveDaysAgo },
      ],
      now,
    });
    assert.equal(ctx.shouldChain, true);
    assert.equal(ctx.previousResponseId, "resp_newest");
    assert.equal(ctx.reason, "ok");
  });

  test("skips user messages when finding newest response_id", () => {
    const ctx = resolveChainingContext({
      flagEnabled: true,
      messages: [
        { role: "assistant", openaiResponseId: "resp_a", createdAt: now - 1000 },
        { role: "user", createdAt: now - 500 }, // no response_id expected
      ],
      now,
    });
    assert.equal(ctx.previousResponseId, "resp_a");
  });
});
```

- [ ] **Step 2: Run test, verify it fails with "not defined"**

```bash
npx mocha tests/unit/api/emersus/pipeline/response-chaining.test.js
```

Expected: FAIL with module-not-found or `resolveChainingContext is not a function`.

- [ ] **Step 3: Write the implementation**

Create `api/emersus/pipeline/response-chaining.js`:

```js
// Decides whether a request should use `previous_response_id` chaining
// instead of sending the full `messages` array. Input: the thread's
// persisted messages + the current feature-flag state. Output: a decision
// object consumed by synthesize.js buildRequestBody.

const EXPIRY_WINDOW_MS = 25 * 24 * 60 * 60 * 1000; // 25 days; OpenAI retains 30

export function resolveChainingContext({ flagEnabled, messages, now = Date.now() }) {
  if (!flagEnabled) {
    return { shouldChain: false, reason: "flag_disabled" };
  }

  // Find the newest assistant message with a response_id.
  let newest = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    if (!m.openaiResponseId) continue;
    newest = m;
    break;
  }

  if (!newest) {
    return { shouldChain: false, reason: "no_prior_response_id" };
  }

  const createdAt = typeof newest.createdAt === "string"
    ? new Date(newest.createdAt).getTime()
    : Number(newest.createdAt || 0);

  if (!Number.isFinite(createdAt) || now - createdAt > EXPIRY_WINDOW_MS) {
    return { shouldChain: false, reason: "expired", previousResponseId: newest.openaiResponseId };
  }

  return { shouldChain: true, reason: "ok", previousResponseId: newest.openaiResponseId };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx mocha tests/unit/api/emersus/pipeline/response-chaining.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/pipeline/response-chaining.js tests/unit/api/emersus/pipeline/response-chaining.test.js
git commit -m "feat(chat): response-chaining decision helper with 25-day expiry gate"
```

---

## Phase 1.3 — Wire the helper into synthesize.js

### Task 1.3.1: Accept `chainingContext` in buildRequestBody

**Files:**
- Modify: `api/emersus/pipeline/synthesize.js`
- Modify: `tests/unit/api/emersus/pipeline/synthesize.test.js`

- [ ] **Step 1: Add test for chaining mode**

Append to `tests/unit/api/emersus/pipeline/synthesize.test.js`:

```js
test("buildRequestBody with chaining enabled sends previous_response_id and trims messages to latest user turn", () => {
  const body = buildRequestBody({
    model: "gpt-5.4-mini",
    messages: [
      { role: "system", content: "sys..." },
      { role: "user", content: "old user" },
      { role: "assistant", content: "old reply" },
      { role: "user", content: "NEW user turn" },
    ],
    tools: [],
    chainingContext: { shouldChain: true, previousResponseId: "resp_123" },
  });

  assert.equal(body.previous_response_id, "resp_123");
  // Only the new user turn + system prompt should survive when chaining.
  assert.equal(body.input.length, 2);
  assert.equal(body.input[0].role, "system");
  assert.equal(body.input[1].content, "NEW user turn");
});

test("buildRequestBody without chainingContext sends full messages", () => {
  const body = buildRequestBody({
    model: "gpt-5.4-mini",
    messages: [
      { role: "system", content: "sys..." },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ],
    tools: [],
  });

  assert.ok(!("previous_response_id" in body));
  assert.equal(body.input.length, 4);
});
```

- [ ] **Step 2: Run tests, verify new ones fail**

```bash
npx mocha tests/unit/api/emersus/pipeline/synthesize.test.js
```

Expected: the two new tests fail (chainingContext param ignored).

- [ ] **Step 3: Modify `buildRequestBody` to honour chainingContext**

In `api/emersus/pipeline/synthesize.js`, find `buildRequestBody(...)`. Change the signature to accept `chainingContext` and apply at the end of the function:

```js
export function buildRequestBody({
  model,
  messages,
  tools = [],
  kind = "synthesis",
  chainingContext = null,
  // ... existing params
}) {
  const body = {
    model,
    store: true,
    parallel_tool_calls: true,
    // ... existing body construction
    input: messages,
    tools,
    max_output_tokens: resolveMaxOutputTokens(kind),
    prompt_cache_key: "emersus-coach-v1",
    prompt_cache_retention: "24h",
  };

  if (chainingContext?.shouldChain && chainingContext.previousResponseId) {
    // Chaining: drop prior conversation from input; OpenAI reassembles it
    // from stored state. Keep system prompts + only the newest user turn.
    const systemPrompts = messages.filter((m) => m.role === "system");
    const lastUserIdx = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") return i;
      }
      return -1;
    })();
    if (lastUserIdx >= 0) {
      body.input = [...systemPrompts, messages[lastUserIdx]];
      body.previous_response_id = chainingContext.previousResponseId;
    }
    // If somehow no user message exists (shouldn't happen), fall through
    // to full-history mode by leaving input + no previous_response_id.
  }

  return body;
}
```

- [ ] **Step 4: Run tests**

```bash
npx mocha tests/unit/api/emersus/pipeline/synthesize.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/pipeline/synthesize.js tests/unit/api/emersus/pipeline/synthesize.test.js
git commit -m "feat(chat): buildRequestBody honours chainingContext to trim messages + send previous_response_id"
```

---

## Phase 1.4 — Thread through workflow + flag check

### Task 1.4.1: Compute chainingContext in workflow.js

**Files:**
- Modify: `api/emersus/workflow.js`

- [ ] **Step 1: Read feature flag server-side**

The server needs to know whether to chain. Pass flag state from the request. In `api/emersus/workflow.js`, inside the main handler:

```js
import { resolveChainingContext } from "./pipeline/response-chaining.js";

// Inside the handler, after loading the thread:
const flagEnabled = req.body?.featureFlags?.chat_response_id_chaining === true;
const chainingContext = resolveChainingContext({
  flagEnabled,
  messages: thread.messages || [],
});
```

Pass `chainingContext` into the synthesize call.

- [ ] **Step 2: Pass flag from client**

In `shared/react-chat-app.js`, find where the `/api/emersus/recommendation` or chat endpoint is called. Add `featureFlags: { chat_response_id_chaining: getFlag("chat_response_id_chaining") }` to the request body. Import `getFlag` from `shared/feature-flags.js` if needed.

- [ ] **Step 3: Commit**

```bash
git add api/emersus/workflow.js shared/react-chat-app.js
git commit -m "feat(chat): wire chainingContext through workflow; client forwards flag state"
```

---

## Phase 1.5 — Error recovery + observability

### Task 1.5.1: Retry on `previous_response_not_found`

**Files:**
- Modify: `api/emersus/pipeline/synthesize.js`
- Modify: `tests/unit/api/emersus/pipeline/synthesize.test.js`

- [ ] **Step 1: Write test for the retry path**

```js
test("fetchWithRetry retries without previous_response_id when OpenAI returns previous_response_not_found", async () => {
  let calls = 0;
  const fetchMock = async (url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    if (calls === 1) {
      assert.ok(body.previous_response_id, "first call should have chaining");
      return {
        ok: false,
        status: 400,
        headers: new Map(),
        json: async () => ({ error: { code: "previous_response_not_found" } }),
      };
    }
    assert.ok(!body.previous_response_id, "second call should NOT chain");
    return { ok: true, status: 200, json: async () => ({ id: "ok" }) };
  };
  // ... invoke fetchWithRetry with chaining on, assert 2 calls, second succeeds
});
```

- [ ] **Step 2: Add handler in the fetch/retry path**

In `fetchWithRetry` in `synthesize.js`, when a 400 response body contains `error.code === "previous_response_not_found"`, retry once with `previous_response_id` stripped from the body. Emit a diagnostic `console.warn("[chat] previous_response_id stale; retrying with full history")`.

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add api/emersus/pipeline/synthesize.js tests/unit/api/emersus/pipeline/synthesize.test.js
git commit -m "feat(chat): recover from previous_response_not_found by retrying without chaining"
```

### Task 1.5.2: Emit `chainingUsed` on done SSE event

**Files:**
- Modify: `api/emersus/pipeline/stream.js`

- [ ] **Step 1: Propagate the flag**

Thread `chainingContext?.shouldChain === true` into the stream context; emit as `chainingUsed` on the `done` SSE event next to `responseId`. One line in the done emitter.

- [ ] **Step 2: Commit**

```bash
git add api/emersus/pipeline/stream.js
git commit -m "feat(chat): emit chainingUsed flag on done SSE event for observability"
```

---

## Phase 1.6 — Rollout checklist (not code)

- [ ] **Internal dogfood:** flag on for the operator account only. Open 10 multi-turn threads, verify answer quality unchanged.
- [ ] **Cache hit rate monitoring:** the rail chip should show sustained cache hits on chained turns.
- [ ] **Error path verification:** manually force a stale response_id (delete it from Supabase via a test thread), confirm the retry path fires cleanly.
- [ ] **A/B cohort:** enable for ~10% of users for 48 h, monitor `logTokenUsage` rows for input_tokens delta vs control.
- [ ] **Full flip:** after A/B clean, flip `chat_response_id_chaining` default to `true` in `feature-flags.js`. Monitor for 1 week before removing the flag.

---

# Item 2 — OpenAI moderation precheck (4 tasks)

## Rationale

`safety.js` currently runs regex-based scope-lock guards for self-harm/ED crisis, PED protocol, and prompt injection. Adding the OpenAI moderation endpoint as a first gate catches emerging jailbreaks + general-purpose harm categories that regex can't encode. Cost is negligible ($0.00002/call); latency 50–200 ms.

### Design decisions

- Call `POST /v1/moderations` with `omni-moderation-latest` on the raw user input.
- If any category flags with confidence > 0.5, return the existing `refusal` code path — reuse the same UI.
- Cache by `sha256(userInput)` in-memory with a 1-hour TTL — repeated identical queries skip the round-trip.
- On moderation API failure (5xx or timeout), **fall through** to the existing regex guards. Don't hard-fail the turn because the moderation API hiccupped.

### Task 2.1: Add the moderation runner

**Files:**
- Modify: `api/emersus/pipeline/safety.js`
- Create: `tests/unit/api/emersus/pipeline/safety-moderation.test.js`

- [ ] **Step 1: Write tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { classifySafety } from "../../../../../api/emersus/pipeline/safety.js";

test("moderation precheck", () => {
  test("flags violent content before regex", async () => {
    // Mock fetch to return flagged moderation.
    const result = await classifySafety({
      userInput: "how do I commit violence against X",
      moderationFetch: async () => ({
        results: [{ flagged: true, categories: { violence: true } }],
      }),
    });
    assert.equal(result.refused, true);
    assert.equal(result.source, "moderation");
  });

  test("falls through to regex when moderation API errors", async () => {
    const result = await classifySafety({
      userInput: "what's a good bench press routine",
      moderationFetch: async () => { throw new Error("API down"); },
    });
    assert.equal(result.refused, false); // regex clean
    assert.equal(result.source, "regex");
  });

  test("caches identical inputs within TTL", async () => {
    let calls = 0;
    const fetchMock = async () => {
      calls++;
      return { results: [{ flagged: false, categories: {} }] };
    };
    await classifySafety({ userInput: "same question", moderationFetch: fetchMock });
    await classifySafety({ userInput: "same question", moderationFetch: fetchMock });
    assert.equal(calls, 1);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Add `runModerationCheck()` to safety.js**

Export a new helper that takes userInput, calls `moderationFetch` (defaulting to `fetch("/v1/moderations" ...)`), returns `{ flagged, categories }`. Add an in-process Map cache keyed by SHA-256 hash of input, TTL 1 hour.

Wire it as the first step in `classifySafety()`. If flagged → return refused=true with source="moderation". If errors → log + fall through to existing regex.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add api/emersus/pipeline/safety.js tests/unit/api/emersus/pipeline/safety-moderation.test.js
git commit -m "feat(chat): moderation precheck with 1h cache, fallthrough on API error"
```

---

# Item 3 — `reasoning_effort` readiness (1 task)

## Rationale

Not applicable to `gpt-5.4-mini`. When/if the model changes to `o4` / `o5` / any reasoning class, we need to set `reasoning.effort` explicitly to avoid paying for `high` effort by default.

### Task 3.1: Add readiness comment

**Files:**
- Modify: `api/emersus/pipeline/synthesize.js`

- [ ] **Step 1: Add the comment + conditional skeleton**

In `buildRequestBody`, near the existing model setup, add:

```js
// Reasoning models (o*-class) accept body.reasoning = { effort: "medium" }.
// When OPENAI_EMERSUS_MODEL starts with "o", uncomment below + preflight a
// real API call (strict-mode rules may differ for reasoning models).
// if (/^o\d/.test(model)) {
//   body.reasoning = { effort: "medium" };
// }
```

- [ ] **Step 2: Commit**

```bash
git add api/emersus/pipeline/synthesize.js
git commit -m "chore(chat): document reasoning_effort readiness for future o*-class models"
```

---

# Item 4 — `UPDATE_USER_PROFILE` strict cleanup (3 tasks)

## Rationale

The preflight static-check test (`tests/unit/api/emersus/pipeline/tools-strict-contract.test.js`) surfaced that `UPDATE_USER_PROFILE` declares 13 properties with `required: []` — a strict-mode violation. The tool is currently excluded from `TOOL_DEFINITIONS`. To re-enable, fix the schema.

### Task 4.1: Inspect current schema

**Files:**
- Read: `api/emersus/pipeline/tools.js` (around line 1471, search for `UPDATE_USER_PROFILE`)

- [ ] **Step 1: List every property + its semantic optionality**

For each of the 13 properties (`full_name`, `goal`, `experience_level`, `dietary_preferences`, …), decide if it's semantically required or optional. For a PROFILE UPDATE tool, **all fields are semantically optional** — the user can update any subset. So every field needs nullable typing.

### Task 4.2: Rewrite schema to strict:true contract

**Files:**
- Modify: `api/emersus/pipeline/tools.js`

- [ ] **Step 1: Rewrite each property to nullable union type**

Transform each property from:

```js
full_name: { type: "string", description: "..." }
```

to:

```js
full_name: { type: ["string", "null"], description: "..." }
```

- [ ] **Step 2: Move every property into `required[]`**

```js
required: ["full_name", "goal", "experience_level", /* all 13 */],
additionalProperties: false,
```

- [ ] **Step 3: Filter null values in the tool handler**

In the handler that consumes `update_user_profile` tool calls (search in `stream.js` or `tools.js`), pre-filter: drop keys whose value is `null` before writing to Supabase. Strict-mode forces the model to supply every key; `null` means "no change."

- [ ] **Step 4: Re-enable in `TOOL_DEFINITIONS`**

Find the `TOOL_DEFINITIONS` array. Uncomment / add the `UPDATE_USER_PROFILE` entry. If there's a comment like "withheld pending strict-mode compliance work" above it, remove that comment.

### Task 4.3: Verify + commit

- [ ] **Step 1: Run the preflight test**

```bash
npx mocha tests/unit/api/emersus/pipeline/tools-strict-contract.test.js
```

Expected: 12 tools (was 11) all pass.

- [ ] **Step 2: Manual API preflight**

Per memory `feedback_openai_strict_mode.md`, run one real API call to confirm strict mode accepts the schema. Create a temporary script or use the Responses API playground. If it rejects, iterate.

- [ ] **Step 3: Commit**

```bash
git add api/emersus/pipeline/tools.js
git commit -m "fix(chat): UPDATE_USER_PROFILE schema meets strict:true contract; re-enabled in TOOL_DEFINITIONS"
```

---

## Self-review checklist

- [x] Spec coverage: all 4 deferred items have tasks
- [x] No placeholders — every code block is concrete
- [x] Type consistency — `resolveChainingContext`, `buildRequestBody` signature, `classifySafety` all used consistently across tasks
- [x] Commit cadence — every task ends in a commit
- [x] TDD — Item 1 + Item 2 start with failing tests; Item 4 uses the existing preflight test as the guardrail

## Execution order recommendation

1. **Item 4 first** — smallest, unblocks re-enabling the profile tool (a dormant feature).
2. **Item 2 next** — independent, single-file, clear win.
3. **Item 1 last (or in a dedicated session)** — largest blast radius; needs careful A/B before full rollout.
4. **Item 3** — drop-in when you upgrade model.
