# Anthropic Claude Sonnet Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every chat-completion / Responses-API call site from OpenAI (`gpt-5.4-mini`) to Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`), behind per-call-site feature flags, while keeping OpenAI for embeddings (`text-embedding-3-small`) and moderation (`omni-moderation-latest`) — Anthropic ships neither.

**Architecture:** Add a thin provider router (`api/lib/llm-router.js`) that wraps both `openai` and `@anthropic-ai/sdk` SDKs behind a uniform `chat({provider, model, messages, tools, stream, ...})` interface. Each call site picks its provider via env flag; default stays OpenAI until each phase passes its own gates. The hot path (`synthesize.js` + `stream.js`) gets a parallel Anthropic implementation — `synthesize-anthropic.js` + `stream-anthropic.js` — wired in behind `LLM_SYNTHESIS_PROVIDER=anthropic`. Tool schemas are converted in one place (`api/lib/tools-anthropic.js`) — `strict: true` is dropped (Anthropic has no schema enforcement; we already validate with `validateMealPlan` / `validateWorkoutPlan` / widget-v2 validators and retry).

**Tech Stack:** `@anthropic-ai/sdk` v0.x (Node), Express 5, existing pg-boss / Supabase / pm2 stack on Hetzner. No new infra.

---

## Decisions Required Before Execution

The agent executing this plan **must surface these to the user before Phase 2** (the hot-path migration). Phase 1 foundation work is safe to do regardless. Default answers shown in `[brackets]` reflect the most defensible call given the verified pricing and architecture constraints; the user may override.

| # | Question | Default | Rationale |
|---|----------|---------|-----------|
| 1 | Sonnet vs Haiku vs Opus for the synthesis path? | `[Sonnet 4.6]` | Sonnet is the price/quality sweet spot. Haiku 4.5 ($1/$5) is 3× cheaper but loses the grounding-fidelity gain that justifies the migration. Opus 4.7 ($5/$25) is overkill; uses up to 35% more tokens (new tokenizer). |
| 2 | Sonnet vs Haiku for non-hot-path calls (HyDE, thread-title, nutrition-parser, classify-candidates, memory-extract gate)? | `[Haiku 4.5]` | These are utility calls where Haiku ($1/$5) ≈ current `gpt-5.4-mini` cost. Sonnet would 3× cost without quality lift on these constrained tasks. |
| 3 | Embeddings: keep OpenAI `text-embedding-3-small`, or migrate to Voyage AI (Anthropic's recommended embedding partner)? | `[Keep OpenAI]` | 1.12M-row corpus already embedded with OpenAI; switching means full re-embed (~$25 + ~20h pipeline), HNSW reindex, and 1.6M rows of evidence_chunks need re-vectorizing. Out of scope for an LLM-vendor swap. Open a separate spec if pursued. |
| 4 | Moderation: keep OpenAI `omni-moderation-latest`, or replace with Claude classifier? | `[Keep OpenAI]` | Costs ~$0.00002/call cached, no Anthropic equivalent, regex fallback already in `safety.js`. Replacing it adds a Claude Haiku call per first-touch question — net loss on cost and latency. |
| 5 | Prompt-cache TTL: 5-min ($3.75/MTok write) or 1-hour ($6/MTok write)? | `[5-min]` | System prompt + tools ≈ ~5k tokens. At our chat volume (median user sends multiple messages within 5 min), a 5-min cache amortizes after one read (10% of base = $0.30/MTok). 1-hour pays off only after 2 reads — better only for cold-start traffic or sparse usage patterns. Re-evaluate after Phase 2 soak. |
| 6 | Cache breakpoint placement: 1 breakpoint (system+tools) or 2 (system, then tools separately)? | `[1 breakpoint]` | System prompt and tools change together (any tool tweak invalidates the system block too in practice, since they're co-developed). Single breakpoint = simpler. Anthropic allows up to 4; reserve the others for future use. |
| 7 | Rollout: percent-canary, user-canary, or all-or-nothing per call site? | `[User-canary, then 100%]` | Per-user flag (e.g., `userId.endsWith('00')` = 1% canary) lets us watch grounding-eval and prod-shadow grounding samples on real traffic before flipping global. Avoid percent-of-requests — same user seeing different providers across consecutive turns will produce inconsistent answers. |
| 8 | Keep `previous_response_id` chaining off (Anthropic has no equivalent)? | `[Yes — drop chaining]` | Codebase already has the full-history fallback path. Cost impact is small because the cached system prompt dominates token count; conversation history stays uncached but it's small (recent_messages capped). |
| 9 | When does OpenAI synthesis get deprecated (delete the code path)? | `[2 weeks after 100% Anthropic in prod]` | Matches the standard soak-window pattern (Z2-live convention). Operator has a `/schedule` reminder to clean up. |

If the user accepts all defaults, the plan executes as written. If anything changes, the Phase 1 foundation is unchanged; only the model strings and flag defaults in later phases shift.

---

## File Structure

**New files:**
- `api/lib/anthropic-client.js` — singleton SDK init, similar to `api/lib/clients.js:43-47` for OpenAI
- `api/lib/llm-router.js` — uniform provider interface; routes `chat()` and `chatStream()` to OpenAI or Anthropic
- `api/lib/tools-anthropic.js` — converts the OpenAI strict-mode tool definitions in `api/emersus/pipeline/tools.js` (and any other tool defs) to Anthropic `{name, description, input_schema}` shape
- `api/emersus/pipeline/synthesize-anthropic.js` — Anthropic version of `synthesize.js`
- `api/emersus/pipeline/stream-anthropic.js` — Anthropic SSE event parser, mirrors `stream.js`'s `parseSSELine` + `processEvent`
- `api/emersus/pipeline/extract-memory-anthropic.js` — Anthropic version of `extract-memory.js` (gate + extractor)
- `api/emersus/pipeline/onboarding-anthropic.js` — Anthropic version of `onboarding.js`
- `tests/unit/anthropic-client.test.js` — unit tests for client init + retry
- `tests/unit/llm-router.test.js` — unit tests for routing logic
- `tests/unit/tools-anthropic.test.js` — schema-conversion tests
- `tests/unit/stream-anthropic.test.js` — SSE event parsing fixtures
- `tests/integration/synthesize-anthropic.test.js` — golden-path live API test (gated on `ANTHROPIC_API_KEY`)
- `scripts/eval/compare-providers.js` — A/B harness over the 200-fixture retrieval set

**Modified files:**
- `package.json` — add `@anthropic-ai/sdk` dependency
- `server.js:26` — extend the env validation to also check `ANTHROPIC_API_KEY` when any `LLM_*_PROVIDER=anthropic` flag is set
- `api/emersus/workflow.js` — call site for `synthesize` becomes `synthesizeViaRouter` (one-line change)
- `api/emersus/pipeline/synthesize.js` — keep as-is (legacy fallback during migration); delete in Phase 8
- `api/emersus/pipeline/stream.js` — extract the provider-agnostic logic (`processEvent`'s side effects: tool dispatch, validator calls, widget recording) into `stream-shared.js`; keep the OpenAI-specific parsing in `stream.js`
- `api/emersus/pipeline/hyde.js:51-69` — provider switch
- `api/emersus/pipeline/safety.js` — no change (moderation stays OpenAI)
- `api/emersus/pipeline/extract-memory.js` — provider switch (or delegate to extract-memory-anthropic.js)
- `api/emersus/pipeline/onboarding.js` — provider switch
- `api/emersus/pipeline/two-stage/extract.js`, `compose.js` — provider switch
- `api/emersus/pipeline/anchor-verify.js`, `claim-modes.js` — provider switch
- `api/emersus/thread-title.js:68-82` — provider switch
- `api/emersus/nutrition-parser.js:107-125` — provider switch (tool_choice translation)
- `api/emersus/suggest-prompts-personalize.js:52-93` — provider switch
- `jobs/classify-candidates.js:71-130` — provider switch (JSON-mode translation)
- `~/app/.env` (Hetzner, manual) — add `ANTHROPIC_API_KEY`, `LLM_*_PROVIDER` flags

**Untouched (intentionally — embedding + moderation stay on OpenAI):**
- `api/emersus/embeddings.js`
- `jobs/embed-batch.js`
- `api/emersus/pipeline/safety.js` moderation precheck

---

## Pricing Math (Verified 2026-04-27)

Sourced from `https://platform.claude.com/docs/en/docs/about-claude/pricing`. All $/MTok.

| Model | Input | 5m write | 1h write | Cache read | Output | Batch in/out |
|-------|-------|----------|----------|------------|--------|--------------|
| **Sonnet 4.6** | $3 | $3.75 | $6 | $0.30 | $15 | $1.50 / $7.50 |
| **Haiku 4.5** | $1 | $1.25 | $2 | $0.10 | $5 | $0.50 / $2.50 |
| Opus 4.7 | $5 | $6.25 | $10 | $0.50 | $25 | $2.50 / $12.50 |

**Per-chat-turn cost estimate (Sonnet 4.6, hot path with caching):**
- System prompt + tool defs (cached): ~5,000 tokens × $0.30/MTok = **$0.0015/turn (cache hit)** or $0.0188/turn (first turn, cache write)
- Conversation history + retrieved evidence (uncached): ~6,000 tokens × $3/MTok = **$0.018/turn**
- Output (prose + tool args): ~1,500 tokens × $15/MTok = **$0.0225/turn**
- **Total ~$0.042/turn warm, ~$0.060/turn cold**

**Compare to current `gpt-5.4-mini`:** Current memory snapshot indicates ~$0.001–0.003/turn. Migration is **~15–40× cost increase** on the synthesis path. Justified by:
- Claude Sonnet 4.6 grounding-fidelity quality (per Anthropic benchmarks; needs prod validation via grounding-eval harness)
- Better tool-routing discipline (relevant since the model self-routes via `tool_choice: auto`)
- Citation-marker compliance with the U+E200/E202/E201 PUA format (verify in Phase 2 smoke)

**Total monthly impact at current traffic (rough):** If chat volume is ~10K turns/day, current spend ~$10/day → projected ~$420/day Sonnet warm, **~$12,600/month** vs. current ~$300/month. **Surface this number to the user before Phase 2.**

**Mitigations:**
1. Use Haiku 4.5 for everything except synthesize.js → keeps utility calls flat or cheaper
2. Use Batch API for non-hot-path calls (memory extraction, anchor-verify, classify-candidates) → 50% off
3. Aggressive 5-min cache reuse on synthesize.js → cache-hit rate >90% expected (median user sends 3+ msgs/session)

---

## Phase 1: Foundation

Build the provider abstraction. No behavior change — all flags default to `openai`. Ships independently and is safe to merge before Phase 2 begins.

### Task 1.1: Add Anthropic SDK dependency

**Files:**
- Modify: `C:\Users\Sidar\Desktop\emersus\package.json`

- [ ] **Step 1: Install the SDK**

Run: `npm install @anthropic-ai/sdk`
Expected: Adds dependency to package.json, no peer-dep warnings.

- [ ] **Step 2: Verify it imports**

Run: `node -e "import('@anthropic-ai/sdk').then(m => console.log(Object.keys(m.default)))"`
Expected: Logs an array including `Anthropic`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @anthropic-ai/sdk for Claude migration"
```

### Task 1.2: Create the Anthropic client singleton

**Files:**
- Create: `C:\Users\Sidar\Desktop\emersus\api\lib\anthropic-client.js`
- Create: `C:\Users\Sidar\Desktop\emersus\tests\unit\anthropic-client.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/anthropic-client.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAnthropicClient } from "../../api/lib/anthropic-client.js";

test("returns null when ANTHROPIC_API_KEY is unset", () => {
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(getAnthropicClient(), null);
});

test("returns a client when ANTHROPIC_API_KEY is set", () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  const c = getAnthropicClient();
  assert.ok(c);
  assert.ok(typeof c.messages?.create === "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/anthropic-client.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```js
// api/lib/anthropic-client.js
import Anthropic from "@anthropic-ai/sdk";

let cached = null;
let cachedKey = null;

// Mirror the lazy-init pattern of api/lib/clients.js:43-47 (OpenAI). Returns
// null when ANTHROPIC_API_KEY is missing so call sites can degrade gracefully
// in dev or during partial outages — same contract as the OpenAI client.
export function getAnthropicClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    cached = null;
    cachedKey = null;
    return null;
  }
  if (cached && cachedKey === key) return cached;
  cached = new Anthropic({
    apiKey: key,
    maxRetries: 0, // we own retry/backoff in llm-router.js, mirror clients.js
  });
  cachedKey = key;
  return cached;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/anthropic-client.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add api/lib/anthropic-client.js tests/unit/anthropic-client.test.js
git commit -m "feat(llm): add Anthropic SDK client singleton"
```

### Task 1.3: Create the tool-schema converter

**Files:**
- Create: `C:\Users\Sidar\Desktop\emersus\api\lib\tools-anthropic.js`
- Create: `C:\Users\Sidar\Desktop\emersus\tests\unit\tools-anthropic.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/tools-anthropic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { toAnthropicTool, toAnthropicTools } from "../../api/lib/tools-anthropic.js";

test("converts an OpenAI strict-mode function tool to Anthropic shape", () => {
  const openaiTool = {
    type: "function",
    name: "emit_meal_plan",
    strict: true,
    description: "Emit a meal plan.",
    parameters: {
      type: "object",
      required: ["targets"],
      additionalProperties: false,
      properties: { targets: { type: "object", required: ["kcal"], properties: { kcal: { type: "number" } } } },
    },
  };
  const result = toAnthropicTool(openaiTool);
  assert.equal(result.name, "emit_meal_plan");
  assert.equal(result.description, "Emit a meal plan.");
  assert.deepEqual(result.input_schema, openaiTool.parameters);
  assert.equal("strict" in result, false);
  assert.equal("type" in result, false);
  assert.equal("parameters" in result, false);
});

test("toAnthropicTools maps an array", () => {
  const tools = [
    { type: "function", name: "a", strict: true, description: "A", parameters: { type: "object", properties: {} } },
    { type: "function", name: "b", strict: true, description: "B", parameters: { type: "object", properties: {} } },
  ];
  const result = toAnthropicTools(tools);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, "a");
  assert.equal(result[1].name, "b");
});

test("preserves nullable types via type arrays in input_schema", () => {
  // OpenAI strict-mode pattern: { type: ["string", "null"] }. Anthropic
  // accepts JSON Schema natively, so this should pass through unchanged.
  const t = {
    type: "function", name: "x", strict: true, description: "x",
    parameters: { type: "object", properties: { v: { type: ["string", "null"] } } },
  };
  const r = toAnthropicTool(t);
  assert.deepEqual(r.input_schema.properties.v.type, ["string", "null"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/tools-anthropic.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```js
// api/lib/tools-anthropic.js
//
// Convert OpenAI strict-mode function tool definitions to Anthropic's
// tool-use shape. Anthropic does not have a `strict` flag — schema
// enforcement is best-effort. We rely on the existing per-tool validators
// (validateMealPlan, validateWorkoutPlan, widget-v2 validators) to catch
// drift, and the LLM router retries once on validation failure.

export function toAnthropicTool(openaiTool) {
  if (!openaiTool || typeof openaiTool !== "object") {
    throw new Error("toAnthropicTool: expected object");
  }
  const { name, description, parameters } = openaiTool;
  if (!name) throw new Error("toAnthropicTool: missing name");
  if (!parameters) throw new Error(`toAnthropicTool: missing parameters for ${name}`);
  return {
    name,
    description: description ?? "",
    input_schema: parameters,
  };
}

export function toAnthropicTools(openaiTools) {
  if (!Array.isArray(openaiTools)) return [];
  return openaiTools.map(toAnthropicTool);
}

// Translate OpenAI tool_choice semantics:
//   undefined / "auto" / { type: "auto" }       → undefined (Anthropic default = auto)
//   "required" / { type: "any" }                 → { type: "any" }
//   "none" / { type: "none" }                    → { type: "none" }
//   { type: "function", function: { name } }     → { type: "tool", name }
// Returns undefined when the input is undefined or the default — Anthropic
// treats omission as "auto", which matches our intent.
export function toAnthropicToolChoice(openaiChoice) {
  if (openaiChoice == null) return undefined;
  if (openaiChoice === "auto") return undefined;
  if (openaiChoice === "required") return { type: "any" };
  if (openaiChoice === "none") return { type: "none" };
  if (typeof openaiChoice === "object") {
    if (openaiChoice.type === "auto") return undefined;
    if (openaiChoice.type === "any" || openaiChoice.type === "required") return { type: "any" };
    if (openaiChoice.type === "none") return { type: "none" };
    if (openaiChoice.type === "function" && openaiChoice.function?.name) {
      return { type: "tool", name: openaiChoice.function.name };
    }
    if (openaiChoice.type === "tool" && openaiChoice.name) return openaiChoice;
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/tools-anthropic.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add api/lib/tools-anthropic.js tests/unit/tools-anthropic.test.js
git commit -m "feat(llm): tool schema converter for Anthropic"
```

### Task 1.4: Create the LLM router

**Files:**
- Create: `C:\Users\Sidar\Desktop\emersus\api\lib\llm-router.js`
- Create: `C:\Users\Sidar\Desktop\emersus\tests\unit\llm-router.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/llm-router.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProvider, normalizeModel } from "../../api/lib/llm-router.js";

test("resolveProvider returns 'openai' by default", () => {
  delete process.env.LLM_TEST_PROVIDER;
  assert.equal(resolveProvider("test"), "openai");
});

test("resolveProvider honors per-call-site env flag", () => {
  process.env.LLM_TEST_PROVIDER = "anthropic";
  assert.equal(resolveProvider("test"), "anthropic");
  delete process.env.LLM_TEST_PROVIDER;
});

test("resolveProvider honors LLM_DEFAULT_PROVIDER as fallback", () => {
  delete process.env.LLM_TEST_PROVIDER;
  process.env.LLM_DEFAULT_PROVIDER = "anthropic";
  assert.equal(resolveProvider("test"), "anthropic");
  delete process.env.LLM_DEFAULT_PROVIDER;
});

test("normalizeModel maps gpt-5.4-mini → claude-sonnet-4-6 for anthropic", () => {
  assert.equal(normalizeModel("anthropic", "gpt-5.4-mini"), "claude-sonnet-4-6");
  assert.equal(normalizeModel("openai", "gpt-5.4-mini"), "gpt-5.4-mini");
  assert.equal(normalizeModel("anthropic", "claude-haiku-4-5"), "claude-haiku-4-5");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/llm-router.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```js
// api/lib/llm-router.js
//
// Per-call-site provider routing. Each call site declares its key (e.g.
// "synthesis", "hyde", "thread_title") and the router checks
// LLM_<KEY>_PROVIDER → LLM_DEFAULT_PROVIDER → "openai".
//
// This file owns NO actual SDK calls. Per-call-site files (synthesize.js,
// hyde.js, etc.) import `resolveProvider` and dispatch to the matching
// implementation. The router exists to centralize the flag logic so we
// can audit it in one place during rollout.

const VALID_PROVIDERS = new Set(["openai", "anthropic"]);

export function resolveProvider(callSiteKey) {
  if (!callSiteKey) throw new Error("resolveProvider: callSiteKey required");
  const upper = callSiteKey.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const perSite = process.env[`LLM_${upper}_PROVIDER`];
  if (perSite && VALID_PROVIDERS.has(perSite)) return perSite;
  const fallback = process.env.LLM_DEFAULT_PROVIDER;
  if (fallback && VALID_PROVIDERS.has(fallback)) return fallback;
  return "openai";
}

// Bidirectional model-name normalization. Each call site stores its OpenAI
// default model string in env (e.g. OPENAI_EMERSUS_MODEL=gpt-5.4-mini).
// When the resolved provider is anthropic, swap to the equivalent Claude
// model. Mapping is deliberate — see plan §"Decisions Required".
const ANTHROPIC_MODEL_MAP = new Map([
  ["gpt-5.4-mini",   "claude-sonnet-4-6"],   // synthesis (overridable per call site below)
  ["gpt-5-mini",     "claude-sonnet-4-6"],
  ["gpt-4.1-mini",   "claude-haiku-4-5"],    // utility calls (HyDE, suggest-prompts)
  ["gpt-4o-mini",    "claude-haiku-4-5"],
]);

export function normalizeModel(provider, openaiModel) {
  if (provider === "openai") return openaiModel;
  if (provider === "anthropic") {
    if (openaiModel?.startsWith("claude-")) return openaiModel; // already an Anthropic name
    const mapped = ANTHROPIC_MODEL_MAP.get(openaiModel);
    if (mapped) return mapped;
    // Unknown OpenAI model — default to Sonnet for safety (matches the
    // synthesis-path SLA). Log so we can audit.
    console.warn(`[llm-router] no Anthropic mapping for ${openaiModel}; defaulting to claude-sonnet-4-6`);
    return "claude-sonnet-4-6";
  }
  throw new Error(`unknown provider: ${provider}`);
}

export function getCallSiteModel(callSiteKey, defaultOpenAIModel) {
  const provider = resolveProvider(callSiteKey);
  // Per-call-site explicit model override wins (e.g. LLM_SYNTHESIS_MODEL).
  const explicit = process.env[`LLM_${callSiteKey.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_MODEL`];
  if (explicit) return { provider, model: explicit };
  return { provider, model: normalizeModel(provider, defaultOpenAIModel) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/llm-router.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add api/lib/llm-router.js tests/unit/llm-router.test.js
git commit -m "feat(llm): provider routing with per-call-site flags"
```

### Task 1.5: Update server.js env validation

**Files:**
- Modify: `C:\Users\Sidar\Desktop\emersus\server.js` around line 26

- [ ] **Step 1: Read the existing validation**

Run: `grep -n "OPENAI_API_KEY" C:/Users/Sidar/Desktop/emersus/server.js | head -5`
Note the surrounding lines so the new check follows the same pattern.

- [ ] **Step 2: Add the conditional Anthropic key check**

Add after the existing `OPENAI_API_KEY` validation:

```js
// Require ANTHROPIC_API_KEY only if any call site is routed to Anthropic.
// LLM_DEFAULT_PROVIDER=anthropic forces it; per-call-site flags (any var
// matching /^LLM_.+_PROVIDER$/ with value 'anthropic') also force it.
const anyAnthropicFlag = Object.entries(process.env).some(
  ([k, v]) => /^LLM_.+_PROVIDER$/.test(k) && v === "anthropic"
);
if (anyAnthropicFlag && !process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY required when any LLM_*_PROVIDER=anthropic");
}
```

- [ ] **Step 3: Smoke-test locally with the flag off**

Run: `node -e "process.env.LLM_DEFAULT_PROVIDER='openai'; require('./server.js')" 2>&1 | head -5`
Expected: Boots without error (Anthropic check is skipped).

- [ ] **Step 4: Smoke-test with the flag on but no key**

Run: `node -e "process.env.LLM_DEFAULT_PROVIDER='anthropic'; delete process.env.ANTHROPIC_API_KEY; require('./server.js')" 2>&1 | head -5`
Expected: Throws "ANTHROPIC_API_KEY required when any LLM_*_PROVIDER=anthropic".

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(server): require ANTHROPIC_API_KEY when LLM_*_PROVIDER=anthropic"
```

### Task 1.6: Provision the Anthropic API key in prod

**Files:** none (operator action)

- [ ] **Step 1: Operator obtains key from Anthropic console**

Tell user: "Generate an Anthropic API key at https://console.anthropic.com → Settings → API Keys. Pick a workspace; tier doesn't matter for testing. Don't paste the key into chat — drop it into Hetzner directly."

- [ ] **Step 2: Operator adds the key to ~/app/.env on Hetzner**

User runs: `ssh hetzner 'echo "ANTHROPIC_API_KEY=sk-ant-..." >> ~/app/.env && grep ANTHROPIC ~/app/.env'`
Expected: Echoes the new line back.

- [ ] **Step 3: Verify the key works without restarting prod**

User runs: `ssh hetzner 'curl -s -X POST https://api.anthropic.com/v1/messages -H "x-api-key: $(grep ANTHROPIC_API_KEY ~/app/.env | cut -d= -f2)" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" -d "{\"model\":\"claude-haiku-4-5\",\"max_tokens\":10,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" | head -c 200'`
Expected: JSON response with `"type":"message"` and a short greeting. If 401, the key is wrong.

- [ ] **Step 4: Confirm no flag is set yet**

User runs: `ssh hetzner 'grep -E "^LLM_.+_PROVIDER" ~/app/.env || echo "no flags set — safe"'`
Expected: "no flags set — safe". The key sits unused until Phase 2 ships.

---

## Phase 2: Hot-Path Migration (synthesize.js + stream.js)

The big one. New `synthesize-anthropic.js` + `stream-anthropic.js` run in parallel; existing OpenAI path stays intact. Flag `LLM_SYNTHESIS_PROVIDER=anthropic` (default `openai`) selects per-request.

### Task 2.1: Extract provider-agnostic stream side-effects

**Files:**
- Create: `C:\Users\Sidar\Desktop\emersus\api\emersus\pipeline\stream-shared.js`
- Modify: `C:\Users\Sidar\Desktop\emersus\api\emersus\pipeline\stream.js`

The current `stream.js` mixes (a) OpenAI SSE parsing, (b) tool dispatch + validation + Supabase writes. Pull (b) into `stream-shared.js` so the Anthropic stream can call the same handlers.

- [ ] **Step 1: Identify the side-effect functions**

Already identified in `stream.js`:
- `persistProfileUpdates(ctx)` (lines ~58-88)
- `logTokenUsage(ctx)` (lines ~90-117)
- `recordWidgetV2Emission(ctx, ...)` (lines ~119-143)
- `flushWidgetV2Emissions(ctx)` (lines ~145-178)
- `handleToolCall(toolName, args, ctx)` — the dispatcher in the back half of `processEvent` (read `stream.js:200-612` to confirm exact name and signature)
- `WIDGET_V2_TOOL_TO_FAMILY`, `MAIN_CHAT_PROFILE_COLUMNS` constants

- [ ] **Step 2: Move them to stream-shared.js**

Cut/paste each function into `stream-shared.js` and re-export. Update `stream.js` to import them. No behavior change.

```js
// api/emersus/pipeline/stream-shared.js
import { validateToolCall, buildToolDefinitions, SERVER_SIDE_TOOLS } from "./tools.js";
import { sanitizeWidgetPayload } from "../../../shared/widget-v2/payload-sanitizer.js";
// ... move the constants and helpers here verbatim
export { persistProfileUpdates, logTokenUsage, recordWidgetV2Emission,
         flushWidgetV2Emissions, handleToolCall, sendSSE, isKnownToolName,
         WIDGET_V2_TOOL_TO_FAMILY, MAIN_CHAT_PROFILE_COLUMNS };
```

- [ ] **Step 3: Run existing stream tests**

Run: `node --test tests/unit/stream.test.js tests/unit/widget-v2-stream.test.js 2>&1 | tail -20`
Expected: All pre-existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add api/emersus/pipeline/stream-shared.js api/emersus/pipeline/stream.js
git commit -m "refactor(stream): extract provider-agnostic side-effects to stream-shared"
```

### Task 2.2: Build the Anthropic stream parser

**Files:**
- Create: `C:\Users\Sidar\Desktop\emersus\api\emersus\pipeline\stream-anthropic.js`
- Create: `C:\Users\Sidar\Desktop\emersus\tests\unit\stream-anthropic.test.js`

Anthropic's SSE event grammar (verified from `https://platform.claude.com/docs/en/api/messages-streaming` 2026-04-27):

| Event | Carries | OpenAI equivalent |
|---|---|---|
| `message_start` | `message` envelope, empty `content`, initial `usage.input_tokens` | `response.created` |
| `content_block_start` | `content_block: { type: "text" }` or `{ type: "tool_use", id, name, input: {} }` | (implicit at start of text/tool) |
| `content_block_delta` with `delta.type === "text_delta"` (`delta.text`) | prose chunk | `response.output_text.delta` |
| `content_block_delta` with `delta.type === "input_json_delta"` (`delta.partial_json`) | tool argument fragment | (OpenAI buffers the full JSON at end) |
| `content_block_delta` with `delta.type === "thinking_delta"` (`delta.thinking`) | extended-thinking chunk | n/a |
| `content_block_delta` with `delta.type === "signature_delta"` (`delta.signature`) | thinking signature | n/a |
| `content_block_stop` | `index` | (implicit) |
| `message_delta` | `delta.stop_reason`, cumulative `usage.output_tokens` | `response.completed` partial |
| `message_stop` | (terminal) | `response.completed` |
| `ping` | keepalive | (none — OpenAI sends bytes) |
| `error` | `error.type`, `error.message` | inline error |

- [ ] **Step 1: Write the failing test with a fixture stream**

```js
// tests/unit/stream-anthropic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSSELine, processEvent, extractTokenUsage } from "../../api/emersus/pipeline/stream-anthropic.js";

test("parseSSELine extracts JSON from a data: line", () => {
  const line = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}';
  const parsed = parseSSELine(line);
  assert.equal(parsed.type, "content_block_delta");
  assert.equal(parsed.delta.text, "hi");
});

test("parseSSELine returns null for non-data lines", () => {
  assert.equal(parseSSELine("event: content_block_delta"), null);
  assert.equal(parseSSELine(""), null);
  assert.equal(parseSSELine("data: not-json"), null);
});

test("processEvent routes text_delta to onProse", () => {
  const proseChunks = [];
  const state = { proseBuffer: "", onProse: (t) => proseChunks.push(t), toolBlocks: new Map() };
  processEvent(
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
    state
  );
  assert.equal(state.proseBuffer, "hello");
  assert.deepEqual(proseChunks, ["hello"]);
});

test("processEvent assembles tool_use across content_block_start + input_json_delta + content_block_stop", () => {
  const completedTools = [];
  const state = {
    proseBuffer: "",
    toolBlocks: new Map(),
    onToolComplete: (t) => completedTools.push(t),
  };
  processEvent(
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "emit_meal_plan", input: {} } },
    state
  );
  processEvent(
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"targets":' } },
    state
  );
  processEvent(
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"kcal":2200}}' } },
    state
  );
  processEvent({ type: "content_block_stop", index: 1 }, state);
  assert.equal(completedTools.length, 1);
  assert.equal(completedTools[0].name, "emit_meal_plan");
  assert.equal(completedTools[0].id, "toolu_1");
  assert.deepEqual(completedTools[0].input, { targets: { kcal: 2200 } });
});

test("extractTokenUsage handles message_start + message_delta accumulation", () => {
  const state = { tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, cached_tokens: 0 } };
  extractTokenUsage(
    { type: "message_start", message: { usage: { input_tokens: 5000, output_tokens: 0, cache_read_input_tokens: 4500, cache_creation_input_tokens: 0 } } },
    state
  );
  assert.equal(state.tokenUsage.input_tokens, 5000);
  assert.equal(state.tokenUsage.cached_tokens, 4500);
  extractTokenUsage(
    { type: "message_delta", usage: { output_tokens: 1234 } },
    state
  );
  assert.equal(state.tokenUsage.output_tokens, 1234);
  assert.equal(state.tokenUsage.total_tokens, 6234);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/stream-anthropic.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```js
// api/emersus/pipeline/stream-anthropic.js
//
// SSE parser for Anthropic Messages API streams. Mirrors the public surface
// of stream.js (parseSSELine, processEvent, extractTokenUsage) so workflow.js
// can call either via a thin wrapper.
//
// Anthropic SSE event flow (per docs/messages-streaming):
//   message_start                                            — envelope + initial usage
//   content_block_start (text or tool_use)                   — block envelope
//   content_block_delta (text_delta | input_json_delta | thinking_delta | signature_delta)
//   content_block_stop
//   message_delta                                            — stop_reason + cumulative usage
//   message_stop                                             — terminal
//   ping                                                     — keepalive (ignore)
//   error                                                    — overload / fatal

export function parseSSELine(line) {
  const trimmed = String(line).trim();
  if (!trimmed || !trimmed.startsWith("data: ")) return null;
  const payload = trimmed.slice(6);
  if (payload === "[DONE]") return null;
  try { return JSON.parse(payload); } catch { return null; }
}

// Mutating routine — accumulates state across calls. The caller owns `state`
// and supplies callbacks (onProse, onProseDone, onToolComplete, onRefusal,
// onMessageStop). Mirrors stream.js's processEvent contract.
export function processEvent(event, state) {
  switch (event?.type) {
    case "message_start":
      state.openaiResponseId = event.message?.id || null;
      // Anthropic doesn't have a "previous_response_id" concept — chaining
      // is gone in the Anthropic path. We still log message.id for audit.
      extractTokenUsage(event, state);
      break;
    case "content_block_start": {
      const block = event.content_block;
      if (block?.type === "tool_use") {
        if (!state.toolBlocks) state.toolBlocks = new Map();
        state.toolBlocks.set(event.index, {
          id: block.id,
          name: block.name,
          jsonBuffer: "",
        });
      }
      // text blocks need no state — deltas accumulate into proseBuffer.
      break;
    }
    case "content_block_delta": {
      const d = event.delta;
      if (d?.type === "text_delta") {
        const chunk = d.text || "";
        state.proseBuffer = (state.proseBuffer || "") + chunk;
        if (state.onProse) state.onProse(chunk);
      } else if (d?.type === "input_json_delta") {
        const block = state.toolBlocks?.get(event.index);
        if (block) block.jsonBuffer += d.partial_json || "";
      } else if (d?.type === "thinking_delta") {
        // Extended thinking: not enabled in our request, but tolerate it.
        if (state.onThinking) state.onThinking(d.thinking || "");
      } else if (d?.type === "signature_delta") {
        // Used to verify thinking-block integrity; we don't surface it.
      }
      break;
    }
    case "content_block_stop": {
      const block = state.toolBlocks?.get(event.index);
      if (block) {
        let parsed = {};
        try {
          parsed = block.jsonBuffer ? JSON.parse(block.jsonBuffer) : {};
        } catch (err) {
          console.error("[stream-anthropic] tool input JSON parse failed:", err.message,
                        "buffer:", block.jsonBuffer.slice(0, 200));
          if (state.onToolError) state.onToolError({ name: block.name, id: block.id, error: err });
          state.toolBlocks.delete(event.index);
          break;
        }
        if (state.onToolComplete) {
          state.onToolComplete({ id: block.id, name: block.name, input: parsed });
        }
        state.toolBlocks.delete(event.index);
      } else {
        // text block closed
        if (state.onProseDone) state.onProseDone();
      }
      break;
    }
    case "message_delta":
      if (event.delta?.stop_reason) {
        state.stopReason = event.delta.stop_reason;
      }
      extractTokenUsage(event, state);
      break;
    case "message_stop":
      if (state.onMessageStop) state.onMessageStop({ stopReason: state.stopReason });
      break;
    case "ping":
      // keepalive
      break;
    case "error":
      if (state.onError) state.onError(event.error);
      break;
    default:
      // Unknown event — Anthropic versioning policy says ignore gracefully.
      break;
  }
}

// Anthropic usage shape (verified):
//   message_start.message.usage = { input_tokens, output_tokens=0..few,
//                                    cache_read_input_tokens, cache_creation_input_tokens }
//   message_delta.usage         = { output_tokens }   (cumulative)
// Token total = input_tokens (incl. cached) + output_tokens (cumulative).
export function extractTokenUsage(event, state) {
  if (!state.tokenUsage) {
    state.tokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, cached_tokens: 0 };
  }
  if (event.type === "message_start") {
    const u = event.message?.usage || {};
    state.tokenUsage.input_tokens = u.input_tokens || 0;
    state.tokenUsage.cached_tokens =
      (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  } else if (event.type === "message_delta") {
    const u = event.usage || {};
    if (typeof u.output_tokens === "number") {
      state.tokenUsage.output_tokens = u.output_tokens;
    }
  }
  state.tokenUsage.total_tokens =
    state.tokenUsage.input_tokens + state.tokenUsage.output_tokens;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/stream-anthropic.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/pipeline/stream-anthropic.js tests/unit/stream-anthropic.test.js
git commit -m "feat(stream): Anthropic SSE event parser"
```

### Task 2.3: Build the Anthropic synthesize wrapper

**Files:**
- Create: `C:\Users\Sidar\Desktop\emersus\api\emersus\pipeline\synthesize-anthropic.js`

OpenAI → Anthropic body translation:

| OpenAI Responses API field | Anthropic Messages API field |
|---|---|
| `model` | `model` (mapped via `normalizeModel`) |
| `input` (array of role/content) | `messages` (split: `system: [...]`, `messages: [...]`) |
| `max_output_tokens` | `max_tokens` |
| `tools` (with `strict: true`) | `tools` (no strict; converted via `toAnthropicTools`) |
| `tool_choice` | `tool_choice` (translated via `toAnthropicToolChoice`) |
| `parallel_tool_calls: true` | implicit / N/A (Anthropic emits multiple `tool_use` blocks naturally) |
| `metadata: { thread_id, user_id, topic, risk_level }` | `metadata: { user_id }` (Anthropic supports only `user_id`; other fields dropped) |
| `prompt_cache_key` + `prompt_cache_retention` | per-block `cache_control: { type: "ephemeral" }` (5-min default, or `{ type: "ephemeral", ttl: "1h" }` if Phase-2 soak says cold-traffic dominates) |
| `previous_response_id` + `store: true` | **not supported — always send full message history** (the codebase already has the full-history fallback) |
| `stream: true` | `stream: true` (same) |

The system prompt arrives as **multiple system messages** in the OpenAI `input` array (when `GROUNDING_SPLIT_PROMPT=true`, there are three: grounding contract → identity → widget tokens). Anthropic expects a single `system` field that is **either a string or an array of content blocks**. Use the array form so each system block can carry its own `cache_control`.

- [ ] **Step 1: Write the implementation**

```js
// api/emersus/pipeline/synthesize-anthropic.js
import { buildMessages } from "./prompt.js";
import { buildToolDefinitions } from "./tools.js";
import { getAnthropicClient } from "../../lib/anthropic-client.js";
import { toAnthropicTools, toAnthropicToolChoice } from "../../lib/tools-anthropic.js";
import { normalizeModel } from "../../lib/llm-router.js";
import { resolveMaxOutputTokens } from "./synthesize.js";

const ANTHROPIC_MODEL = process.env.LLM_SYNTHESIS_MODEL ||
  normalizeModel("anthropic", process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini");

// Anthropic prompt-cache TTL. Default to 5-minute ephemeral cache; ~85%+ of
// our chat traffic is bursty within a 5-min window so the 1.25× cache-write
// premium amortizes after one hit. Switch to "1h" via env if Phase 2 soak
// shows cache-miss rate > 30%.
const CACHE_TTL = process.env.LLM_SYNTHESIS_CACHE_TTL || "5m"; // "5m" | "1h"

function buildSystemBlocks(openaiInputMessages) {
  // OpenAI input contains 1-3 system messages followed by 1 user message.
  // Take everything before the first user/assistant turn as the system.
  const systemBlocks = [];
  for (const m of openaiInputMessages) {
    if (m.role !== "system") break;
    systemBlocks.push({ type: "text", text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
  }
  // Place the cache breakpoint on the LAST system block — Anthropic caches
  // everything from the start of the prompt up to (and including) the block
  // that carries cache_control. Tools come AFTER system in the request body
  // but Anthropic's caching covers system + tools as a contiguous prefix
  // when both have cache_control. We use a single breakpoint here on system;
  // tools are short enough that re-sending them uncached is cheap.
  if (systemBlocks.length > 0) {
    const last = systemBlocks[systemBlocks.length - 1];
    last.cache_control = CACHE_TTL === "1h"
      ? { type: "ephemeral", ttl: "1h" }
      : { type: "ephemeral" };
  }
  return systemBlocks;
}

function convertMessages(openaiInputMessages) {
  // Drop system messages (handled separately) and translate user/assistant.
  // Anthropic message content can be a string OR array of content blocks.
  // Our user payload is always JSON.stringify(userPayload) — a string. Pass through.
  const out = [];
  for (const m of openaiInputMessages) {
    if (m.role === "system") continue;
    if (m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
    }
    // (Tool messages are added back by handleToolCall after a tool runs;
    //  the initial synthesize() call always has only system + user.)
  }
  // Anthropic rejects empty messages array. The buildMessages() output
  // always includes at least one user payload, so this is defensive only.
  if (out.length === 0) {
    throw new Error("synthesize-anthropic: no user/assistant messages after system filter");
  }
  return out;
}

export function buildAnthropicRequestBody({ messages, tools, toolChoice, metadata, kind = "synthesis", model }) {
  const body = {
    model: model || ANTHROPIC_MODEL,
    max_tokens: resolveMaxOutputTokens(kind),
    stream: true,
    system: buildSystemBlocks(messages),
    messages: convertMessages(messages),
  };
  if (tools && tools.length > 0) {
    body.tools = toAnthropicTools(tools);
    const tc = toAnthropicToolChoice(toolChoice);
    if (tc) body.tool_choice = tc;
  }
  // Anthropic metadata accepts only { user_id }. Use the most stable id.
  if (metadata?.user_id) body.metadata = { user_id: metadata.user_id };
  return body;
}

export async function synthesizeAnthropic(ctx, { /* chainingContext intentionally ignored */ } = {}) {
  const client = getAnthropicClient();
  if (!client) throw new Error("Missing ANTHROPIC_API_KEY");

  const model = ANTHROPIC_MODEL;
  ctx._synthesisModel = model;

  const messages = buildMessages({
    question: ctx.question,
    threadState: ctx.threadState,
    recentMessages: ctx.recentMessages,
    evidence: ctx.evidence,
    workoutPlan: ctx.workoutPlan,
    crossThreadMemory: ctx.crossThreadMemory,
  });

  const requestBody = buildAnthropicRequestBody({
    messages,
    tools: buildToolDefinitions(),
    metadata: { user_id: ctx.supabaseUserId || ctx.stableUserId || undefined },
    model,
  });

  const start = Date.now();
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort("timeout"), 60_000);
  const combinedSignal = typeof AbortSignal.any === "function"
    ? AbortSignal.any([ctx._abortController.signal, timeoutController.signal])
    : ctx._abortController.signal;

  try {
    // Use the SDK's stream method — it returns an iterable of raw SSE events
    // with the same { type, ... } shape our processEvent expects.
    const stream = await client.messages.stream(requestBody, { signal: combinedSignal });
    ctx._timer.record("synthesis_ttfb_ms", Date.now() - start);
    ctx._anthropicStream = stream;
    ctx._synthesisStartMs = start;
  } finally {
    clearTimeout(timeoutId);
  }

  return ctx;
}
```

- [ ] **Step 2: Smoke-test against the real Anthropic API**

Run: `ANTHROPIC_API_KEY=sk-ant-... node -e "
import('./api/emersus/pipeline/synthesize-anthropic.js').then(async m => {
  const stream = await (await import('@anthropic-ai/sdk')).default.prototype.messages.stream.call(
    require('./api/lib/anthropic-client.js').getAnthropicClient(),
    { model: 'claude-sonnet-4-6', max_tokens: 100, system: [{type:'text',text:'You are terse.'}], messages: [{role:'user',content:'Say hi.'}] }
  );
  for await (const ev of stream) console.log(ev.type, ev.delta?.text || '');
})"`
Expected: Logs `message_start`, `content_block_start`, several `content_block_delta` with text, `content_block_stop`, `message_delta`, `message_stop`.

- [ ] **Step 3: Commit**

```bash
git add api/emersus/pipeline/synthesize-anthropic.js
git commit -m "feat(synthesize): Anthropic synthesis wrapper with cache-control"
```

### Task 2.4: Wire the router into workflow.js

**Files:**
- Modify: `C:\Users\Sidar\Desktop\emersus\api\emersus\workflow.js`

- [ ] **Step 1: Find the synthesize call**

Run: `grep -n "synthesize" C:/Users/Sidar/Desktop/emersus/api/emersus/workflow.js`
Note the import line and the call-site line.

- [ ] **Step 2: Add a router shim**

```js
// At top of workflow.js, add:
import { resolveProvider } from "../lib/llm-router.js";
import { synthesize as synthesizeOpenAI } from "./pipeline/synthesize.js";
import { synthesizeAnthropic } from "./pipeline/synthesize-anthropic.js";

async function synthesizeViaRouter(ctx, opts) {
  const provider = resolveProvider("synthesis");
  ctx._synthesisProvider = provider;
  if (provider === "anthropic") return synthesizeAnthropic(ctx, opts);
  return synthesizeOpenAI(ctx, opts);
}
```

Replace every `synthesize(ctx, ...)` call in workflow.js with `synthesizeViaRouter(ctx, ...)`.

- [ ] **Step 3: Add the same provider switch in the stream consumer**

Find the `stream(ctx)` call (also in workflow.js or whoever consumes `ctx._openaiStream`). Add a parallel `streamAnthropic(ctx)` import + switch on `ctx._synthesisProvider`.

```js
// in workflow.js
import { stream as streamOpenAI } from "./pipeline/stream.js";
import { streamAnthropic } from "./pipeline/stream-anthropic-runner.js"; // built next task

async function streamViaRouter(ctx, res) {
  if (ctx._synthesisProvider === "anthropic") return streamAnthropic(ctx, res);
  return streamOpenAI(ctx, res);
}
```

- [ ] **Step 4: Smoke-test with flag off**

Run: `LLM_SYNTHESIS_PROVIDER=openai npm test 2>&1 | tail -20`
Expected: All existing tests pass; OpenAI path unchanged.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/workflow.js
git commit -m "feat(workflow): route synthesis through llm-router (default openai)"
```

### Task 2.5: Build the Anthropic stream runner

**Files:**
- Create: `C:\Users\Sidar\Desktop\emersus\api\emersus\pipeline\stream-anthropic-runner.js`

This is the consumer that takes `ctx._anthropicStream`, walks events through `processEvent`, dispatches tool calls via `handleToolCall` from `stream-shared.js`, and emits SSE to the client.

- [ ] **Step 1: Write the implementation**

```js
// api/emersus/pipeline/stream-anthropic-runner.js
import { processEvent, extractTokenUsage } from "./stream-anthropic.js";
import {
  handleToolCall, sendSSE, persistProfileUpdates, logTokenUsage,
  flushWidgetV2Emissions, recordWidgetV2Emission,
} from "./stream-shared.js";
import { getAnthropicClient } from "../../lib/anthropic-client.js";
import { buildAnthropicRequestBody } from "./synthesize-anthropic.js";
import { buildToolDefinitions } from "./tools.js";
import { buildMessages } from "./prompt.js";

export async function streamAnthropic(ctx, res) {
  if (!ctx._anthropicStream) throw new Error("streamAnthropic: missing ctx._anthropicStream");
  const stream = ctx._anthropicStream;

  // State the processEvent contract owns
  const state = {
    proseBuffer: "",
    toolBlocks: new Map(),
    tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, cached_tokens: 0 },
    stopReason: null,
    openaiResponseId: null,
    onProse: (chunk) => sendSSE(res, { type: "delta", text: chunk }),
    onProseDone: () => sendSSE(res, { type: "prose_done" }),
    onToolComplete: async (call) => {
      // Same dispatcher path as the OpenAI stream's tool handling.
      const validated = await handleToolCall(ctx, call.name, call.input, call.id, res);
      if (validated?.followupRequired) {
        // Anthropic equivalent of OpenAI's "function_call_output then continue":
        // append a tool_result to messages and recurse with a new stream call.
        ctx._toolFollowupQueue = ctx._toolFollowupQueue || [];
        ctx._toolFollowupQueue.push({
          tool_use_id: call.id,
          content: validated.toolResult,
        });
      }
    },
    onMessageStop: () => sendSSE(res, { type: "done", usage: state.tokenUsage }),
    onError: (err) => {
      console.error("[stream-anthropic] API error:", err?.type, err?.message);
      sendSSE(res, { type: "error", message: "Synthesis failed. Please retry." });
    },
  };

  try {
    for await (const event of stream) {
      processEvent(event, state);
    }

    // Tool-followup loop. If the model called any tools, send their results
    // back in a NEW Anthropic request (Anthropic does not have OpenAI's
    // chained `previous_response_id` shortcut — every continuation rebuilds
    // the messages array). Cap iterations at 4 to match OpenAI behavior.
    let iterations = 0;
    while (ctx._toolFollowupQueue?.length && iterations < 4) {
      iterations += 1;
      const toolResults = ctx._toolFollowupQueue.splice(0);
      const followupBody = buildFollowupBody(ctx, toolResults);
      const client = getAnthropicClient();
      const followupStream = await client.messages.stream(followupBody, {
        signal: ctx._abortController.signal,
      });
      for await (const event of followupStream) {
        processEvent(event, state);
      }
    }
  } finally {
    ctx.tokenUsage = state.tokenUsage;
    ctx._openaiResponseId = state.openaiResponseId; // reuse field name for downstream logging
    await persistProfileUpdates(ctx);
    await logTokenUsage(ctx);
    await flushWidgetV2Emissions(ctx);
    sendSSE(res, { type: "stream_end" });
    res.end();
  }
}

function buildFollowupBody(ctx, toolResults) {
  // Anthropic continuation pattern: prior assistant message is the model's
  // response (text + tool_use blocks); we append a `user` message containing
  // tool_result blocks for each tool call. The model then continues.
  //
  // Because we don't reconstruct the prior assistant turn (we'd need to
  // buffer every text/tool_use block), we use a simpler approach: rebuild
  // the messages array from buildMessages() and let the model re-derive
  // context. This matches our existing OpenAI fallback pattern when
  // previous_response_id is missing.
  const baseMessages = buildMessages({
    question: ctx.question,
    threadState: ctx.threadState,
    recentMessages: ctx.recentMessages,
    evidence: ctx.evidence,
    workoutPlan: ctx.workoutPlan,
    crossThreadMemory: ctx.crossThreadMemory,
  });
  // Append assistant placeholder + tool_result user message.
  // Note: a real Anthropic continuation needs the EXACT prior assistant
  // content (text blocks + tool_use blocks with matching ids). We capture
  // those during the first stream walk in state.assistantBlocks (added in a
  // follow-up commit if Phase 2 smoke shows tool-followup correctness gaps).
  // For now, send tool results as a plain user message — model will ack.
  const toolResultText = toolResults.map(t => `[tool ${t.tool_use_id}]: ${typeof t.content === "string" ? t.content : JSON.stringify(t.content)}`).join("\n\n");
  const messages = baseMessages.concat([
    { role: "assistant", content: "(tool calls executed)" },
    { role: "user", content: toolResultText },
  ]);
  return buildAnthropicRequestBody({
    messages,
    tools: buildToolDefinitions(),
    metadata: { user_id: ctx.supabaseUserId || ctx.stableUserId || undefined },
    kind: "tool_followup",
  });
}
```

> **Note on tool-followup correctness:** the buildFollowupBody approach above re-builds messages from scratch, which loses the assistant's tool_use block IDs. Anthropic accepts this (the model treats it as a new turn referencing past tool actions in plain text), but ID-perfect continuations are stricter. Phase 2 smoke (Task 2.7) explicitly checks tool-followup quality; if it regresses, swap to a buffered-blocks approach (capture every `content_block_start` + delta into `state.assistantBlocks`, replay verbatim).

- [ ] **Step 2: Commit**

```bash
git add api/emersus/pipeline/stream-anthropic-runner.js
git commit -m "feat(stream): Anthropic stream runner with tool-followup loop"
```

### Task 2.6: Add a comparative-eval script

**Files:**
- Create: `C:\Users\Sidar\Desktop\emersus\scripts\eval\compare-providers.js`

- [ ] **Step 1: Write the script**

```js
// scripts/eval/compare-providers.js
//
// Run the existing 200-fixture set against both providers, compute:
//   - grounding-fidelity (does the answer cite the retrieved sources?)
//   - tool-call match rate (did both providers pick the same emit_* tool?)
//   - latency p50 / p95 ttfb / total
//   - cost per response
// Output: scripts/eval/results/compare-providers-YYYY-MM-DD.json + .md
//
// Reuses the harness pattern from scripts/eval/bench-matrix.js. Run AGAINST
// PROD SUPABASE (per CLAUDE.md). Writes to chat_grounding_samples table.
//
// Usage:
//   node scripts/eval/compare-providers.js --providers=openai,anthropic --limit=200
//   node scripts/eval/compare-providers.js --providers=anthropic --limit=20  # smoke
//
// Reads fixtures from scripts/eval/fixtures/retrieval-v2.json. For each
// fixture, hits POST /api/emersus/recommendation with both providers via
// the X-Llm-Provider header (added in Task 2.7).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FIXTURES = "scripts/eval/fixtures/retrieval-v2.json";
const OUT_DIR = "scripts/eval/results";

async function runOne(question, provider, baseUrl, authToken) {
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/api/emersus/recommendation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`,
      "X-Llm-Provider": provider,
    },
    body: JSON.stringify({ question, threadId: null }),
  });
  // Drain the SSE stream
  let prose = "", tools = [], usage = null, ttfb = null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (ttfb == null) ttfb = Date.now() - t0;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n\n")) >= 0) {
      const evt = buf.slice(0, nl); buf = buf.slice(nl + 2);
      if (!evt.startsWith("data: ")) continue;
      try {
        const obj = JSON.parse(evt.slice(6));
        if (obj.type === "delta") prose += obj.text;
        else if (obj.type === "tool_call") tools.push(obj);
        else if (obj.type === "done") usage = obj.usage;
      } catch { /* ignore */ }
    }
  }
  return { provider, ttfb_ms: ttfb, total_ms: Date.now() - t0, prose, tools, usage };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, "").split("=")));
  const providers = (args.providers || "openai,anthropic").split(",");
  const limit = Number(args.limit || 20);
  const baseUrl = args.url || "http://localhost:3000";
  const authToken = process.env.EVAL_AUTH_TOKEN;
  if (!authToken) throw new Error("EVAL_AUTH_TOKEN required (Supabase JWT for an eval user)");

  const fixtures = JSON.parse(await readFile(FIXTURES, "utf8")).slice(0, limit);
  const rows = [];
  for (const f of fixtures) {
    for (const p of providers) {
      const r = await runOne(f.question, p, baseUrl, authToken);
      rows.push({ fixture_id: f.id, question: f.question, ...r });
      console.log(`[${p}] ${f.id} ttfb=${r.ttfb_ms}ms total=${r.total_ms}ms tools=${r.tools.length} input_tok=${r.usage?.input_tokens} cached_tok=${r.usage?.cached_tokens}`);
    }
  }

  // Aggregate
  const byProvider = {};
  for (const r of rows) {
    const p = r.provider;
    if (!byProvider[p]) byProvider[p] = { ttfb: [], total: [], input_tokens: 0, output_tokens: 0, cached_tokens: 0, tool_count: 0 };
    byProvider[p].ttfb.push(r.ttfb_ms);
    byProvider[p].total.push(r.total_ms);
    byProvider[p].input_tokens += r.usage?.input_tokens || 0;
    byProvider[p].output_tokens += r.usage?.output_tokens || 0;
    byProvider[p].cached_tokens += r.usage?.cached_tokens || 0;
    byProvider[p].tool_count += r.tools.length;
  }
  for (const p of Object.keys(byProvider)) {
    const x = byProvider[p];
    x.ttfb.sort((a,b) => a-b);
    x.total.sort((a,b) => a-b);
    x.ttfb_p50 = x.ttfb[Math.floor(x.ttfb.length * 0.5)];
    x.ttfb_p95 = x.ttfb[Math.floor(x.ttfb.length * 0.95)];
    x.total_p50 = x.total[Math.floor(x.total.length * 0.5)];
    x.total_p95 = x.total[Math.floor(x.total.length * 0.95)];
  }

  await mkdir(OUT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  await writeFile(path.join(OUT_DIR, `compare-providers-${date}.json`),
    JSON.stringify({ rows, summary: byProvider }, null, 2));
  console.log("Wrote results to", OUT_DIR);
  console.log(JSON.stringify(byProvider, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add the X-Llm-Provider header support to the recommendation route**

Find the recommendation handler (likely `api/emersus/recommendation.js` — confirm via `grep -rn "recommendation" api/emersus | head`). Add at the top:

```js
// Allow eval/canary callers to override the provider per-request via header.
// Trusted only for users in EVAL_USER_IDS env (CSV of supabase user ids).
const evalUserIds = new Set((process.env.EVAL_USER_IDS || "").split(",").filter(Boolean));
if (req.headers["x-llm-provider"] && evalUserIds.has(req.user?.id)) {
  process.env.LLM_SYNTHESIS_PROVIDER = req.headers["x-llm-provider"];
  // Note: this leaks across requests in single-process pm2 mode. Reset
  // immediately after the synthesize call returns. Or thread via ctx (cleaner).
  // For now, set ctx._providerOverride and have llm-router check it first.
}
```

The cleaner version: add `providerOverride` to `ctx`, pass to `resolveProvider(callSiteKey, ctx?.providerOverride)`, and update the router signature.

- [ ] **Step 3: Smoke-test the harness**

Run: `node scripts/eval/compare-providers.js --providers=openai --limit=3 --url=http://localhost:3000`
Expected: 3 fixtures × 1 provider = 3 rows printed; OpenAI path works.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval/compare-providers.js api/emersus/recommendation.js
git commit -m "feat(eval): provider comparison harness"
```

### Task 2.7: Local end-to-end smoke test

**Files:** none (manual)

- [ ] **Step 1: Boot the local server with the flag on**

Run: `LLM_SYNTHESIS_PROVIDER=anthropic LLM_SYNTHESIS_MODEL=claude-sonnet-4-6 ANTHROPIC_API_KEY=sk-ant-... npm run dev 2>&1 | tee /tmp/anthropic-smoke.log` (run in background)

- [ ] **Step 2: Send a chat that should trigger emit_meal_plan**

Use the chat UI at http://localhost:3000/chat with: "Build me a 2200 kcal meal plan for cutting."

Verify:
- Prose streams to the UI
- Sources panel renders (grounding contract markers `citesrcN` should appear in prose)
- Meal plan widget renders inline
- Token usage logged to chat_token_usage_events with `model = "claude-sonnet-4-6"`

- [ ] **Step 3: Send a chat that should trigger emit_calculator_widget**

"What's my TDEE if I'm 80kg, 180cm, 30, male, moderately active?"

Verify the calculator widget renders with the math.

- [ ] **Step 4: Send a chat that triggers get_user_profile + emit_workout_plan**

"Make me a 4-day upper/lower for hypertrophy."

Verify get_user_profile is called BEFORE the workout plan tool emits. Check the tool-followup loop works.

- [ ] **Step 5: Run the eval harness**

Run: `EVAL_AUTH_TOKEN=... node scripts/eval/compare-providers.js --providers=openai,anthropic --limit=20`

Compare:
- ttfb p50: Anthropic should be in the 800-1500ms range vs OpenAI 400-800ms
- Tool selection: should match >90% of the time
- Cached tokens: Anthropic second turn onwards should show `cached_tokens > 4000` (system prompt)

If any of these fails, do NOT proceed to Phase 2.8. Open a debug session.

- [ ] **Step 6: If smoke passes, commit the smoke log**

```bash
# (no commit — smoke log is local only)
echo "smoke complete on $(date)" >> .smoke-anthropic.log
```

### Task 2.8: Ship to prod under canary

**Files:** none (operator action)

- [ ] **Step 1: Add provider-override env support on prod**

User runs:
```bash
ssh hetzner 'cat >> ~/app/.env << EOF
LLM_SYNTHESIS_PROVIDER=openai
LLM_SYNTHESIS_MODEL=claude-sonnet-4-6
LLM_SYNTHESIS_CACHE_TTL=5m
EVAL_USER_IDS=<sidar-supabase-id>,<one-other-eval-user-id>
EOF
pm2 restart emersus-api --update-env'
```

Default flag is still `openai` — this just provisions the env so per-user overrides work.

- [ ] **Step 2: Send a real chat as the eval user with X-Llm-Provider: anthropic**

User runs in browser devtools console while logged in as eval user:
```js
fetch('/api/emersus/recommendation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Llm-Provider': 'anthropic' },
  body: JSON.stringify({ question: 'creatine dose for a 80kg lifter', threadId: null }),
}).then(r => r.text()).then(console.log)
```
Expected: SSE stream renders normally; chat_token_usage_events row shows `model: "claude-sonnet-4-6"`.

- [ ] **Step 3: Watch grounding-eval samples for 24h**

Verify the grounding-trend.js report (per `reference_grounding_eval_commands` memory) shows no degradation. Run after 24h:
```bash
ssh hetzner 'cd ~/app && node scripts/eval/grounding-trend.js --since=24h'
```

- [ ] **Step 4: Flip the global default**

User runs:
```bash
ssh hetzner 'sed -i "s/^LLM_SYNTHESIS_PROVIDER=.*/LLM_SYNTHESIS_PROVIDER=anthropic/" ~/app/.env && pm2 restart emersus-api --update-env'
```

- [ ] **Step 5: Watch error rate + latency for 48h**

Watch:
- pm2 logs: `ssh hetzner 'pm2 logs emersus-api --lines 100 --nostream' | grep -iE "(anthropic|error|429|529)"`
- Token-usage spend: query chat_token_usage_events for total cost in the past 24h
- Grounding samples: re-run grounding-trend.js

- [ ] **Step 6: Update changelog + checkpoint + Notion (per memory)**

Use the `/ship` skill.

---

## Phase 3: Onboarding + two-stage + claim-modes + anchor-verify

These all use the OpenAI Responses API with the same call shape as synthesize.js. Each gets its own per-call-site flag.

### Task 3.1: Onboarding (`api/emersus/pipeline/onboarding.js`)

**Files:**
- Modify: `C:\Users\Sidar\Desktop\emersus\api\emersus\pipeline\onboarding.js`

- [ ] **Step 1: Read onboarding.js to find the OpenAI call site (around line 135)**

Run: `grep -n "openai\|/v1/responses\|chat.completions" C:/Users/Sidar/Desktop/emersus/api/emersus/pipeline/onboarding.js`

- [ ] **Step 2: Apply the same provider-switch pattern as Task 2.4**

```js
import { resolveProvider, normalizeModel } from "../../lib/llm-router.js";
import { getAnthropicClient } from "../../lib/anthropic-client.js";
import { toAnthropicTools, toAnthropicToolChoice } from "../../lib/tools-anthropic.js";

async function callLLM(messages, tools, kind) {
  const provider = resolveProvider("onboarding");
  const model = normalizeModel(provider, process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini");
  if (provider === "anthropic") {
    const client = getAnthropicClient();
    return client.messages.stream({
      model, max_tokens: 1500, stream: true,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages,
      tools: toAnthropicTools(tools),
      tool_choice: toAnthropicToolChoice("auto"),
    });
  }
  // existing OpenAI Responses-API call
}
```

- [ ] **Step 3: Run unit tests**

Run: `node --test tests/unit/onboarding.test.js`
Expected: PASS.

- [ ] **Step 4: Local smoke**

Manually walk through onboarding flow with `LLM_ONBOARDING_PROVIDER=anthropic` set. Verify the structured profile-update tool fires.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/pipeline/onboarding.js
git commit -m "feat(onboarding): route through llm-router (default openai)"
```

- [ ] **Step 6: Ship + canary (mirror Task 2.8 pattern, scoped to onboarding)**

### Task 3.2: Two-stage extract + compose

**Files:**
- Modify: `C:\Users\Sidar\Desktop\emersus\api\emersus\pipeline\two-stage\extract.js`
- Modify: `C:\Users\Sidar\Desktop\emersus\api\emersus\pipeline\two-stage\compose.js`

Apply the same router-shim pattern from Task 3.1. Call-site key: `two_stage_extract` and `two_stage_compose`.

- [ ] **Step 1: Pattern-edit both files (see 3.1)**
- [ ] **Step 2: Run unit tests**: `node --test tests/unit/two-stage.test.js` (if exists; else skip)
- [ ] **Step 3: Smoke-test by triggering the modal feature path locally**
- [ ] **Step 4: Commit**

```bash
git add api/emersus/pipeline/two-stage/extract.js api/emersus/pipeline/two-stage/compose.js
git commit -m "feat(two-stage): route extract+compose through llm-router"
```

### Task 3.3: anchor-verify + claim-modes

**Files:**
- Modify: `C:\Users\Sidar\Desktop\emersus\api\emersus\pipeline\anchor-verify.js`
- Modify: `C:\Users\Sidar\Desktop\emersus\api\emersus\pipeline\claim-modes.js`

Same pattern. Call-site keys: `anchor_verify`, `claim_modes`.

- [ ] **Step 1: Pattern-edit both files**
- [ ] **Step 2: Verify anchor-verify is non-blocking (fire-and-forget)** — failure must not surface to user
- [ ] **Step 3: Smoke-test grounding samples for anchor-verify regressions**
- [ ] **Step 4: Commit**

```bash
git add api/emersus/pipeline/anchor-verify.js api/emersus/pipeline/claim-modes.js
git commit -m "feat(anchor-verify,claim-modes): route through llm-router"
```

---

## Phase 4: Memory Extraction (gate + extractor)

**Files:**
- Modify: `C:\Users\Sidar\Desktop\emersus\api\emersus\pipeline\extract-memory.js`

The two-stage memory pipeline (Stage A gate + Stage B extractor) uses strict JSON schemas with the OpenAI Responses API. Translation gotchas:

1. **Stage A gate** uses a tool with `strict: true` and binary classification ("relevant?" + categories). Anthropic equivalent: same tool definition without strict; rely on validator. The categories list enumeration should pass through cleanly via JSON Schema `enum`.
2. **Stage B extractor** returns `facts[]` with typed metadata. Same translation. **Bug to watch for**: per memory `feedback_extractor_tuning_lessons.md`, Stage B defaults to empty when prompt hedges. Anthropic Sonnet 4.6 may produce different defaults — re-tune prompt if recall drops on first canary.
3. The fire-and-forget circuit breaker stays as-is; it counts errors regardless of provider.

### Task 4.1: Apply the router shim

- [ ] **Step 1: Edit extract-memory.js**

Same pattern as Task 3.1. Call-site keys: `memory_gate`, `memory_extractor` (separate so they can be flipped independently — useful if Stage B regresses but Stage A is fine).

- [ ] **Step 2: Add a strict-fail retry**

Anthropic does not enforce schema. If the validator fails on the parsed tool input, retry once with an explicit "your last call had this validation error: <msg>; please correct and re-emit" turn. Cap retries at 1 to avoid infinite loops on a stuck schema. Log retry rate to chat_token_usage_events metadata.

- [ ] **Step 3: Run the existing extractor unit tests**

Run: `node --test tests/unit/extract-memory.test.js`
Expected: PASS.

- [ ] **Step 4: Local smoke with a known-extractable transcript**

Run a test transcript through the extractor with `LLM_MEMORY_GATE_PROVIDER=anthropic LLM_MEMORY_EXTRACTOR_PROVIDER=anthropic` and verify a fact is extracted with the expected category.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/pipeline/extract-memory.js
git commit -m "feat(memory): route extract-memory through llm-router"
```

### Task 4.2: Canary on prod with extractor sampling

- [ ] **Step 1: Flip the memory gate first** (cheap, low-risk classifier)

```bash
ssh hetzner 'echo "LLM_MEMORY_GATE_PROVIDER=anthropic" >> ~/app/.env && pm2 restart emersus-api --update-env'
```

- [ ] **Step 2: Watch the memory accept-rate views for 24h**

Per memory `project_cross_thread_memory.md`, accept-rate views shipped. Query:
```sql
select date_trunc('hour', created_at) h, count(*) total,
       sum(case when accepted then 1 else 0 end) accepted
from cross_thread_memory_facts
where created_at > now() - interval '24 hours'
group by 1 order by 1;
```

- [ ] **Step 3: If accept rate is within ±5% of baseline, flip the extractor too**

```bash
ssh hetzner 'echo "LLM_MEMORY_EXTRACTOR_PROVIDER=anthropic" >> ~/app/.env && pm2 restart emersus-api --update-env'
```

- [ ] **Step 4: Watch for 48h, then update memory file (`project_cross_thread_memory.md`)**

---

## Phase 5: One-Shot Calls

These are fire-and-forget utility calls. Each gets a router shim and a Haiku-default model (per Decision #2).

### Task 5.1: thread-title.js

**Files:**
- Modify: `C:\Users\Sidar\Desktop\emersus\api\emersus\thread-title.js`

- [ ] **Step 1: Edit thread-title.js (lines 68-82)**

Add the router-shim pattern. Default model: `claude-haiku-4-5`. Max tokens: 24 → Anthropic uses `max_tokens: 24`.

- [ ] **Step 2: Run tests**: `node --test tests/unit/thread-title.test.js`
- [ ] **Step 3: Local smoke**: send a chat, verify thread title is generated
- [ ] **Step 4: Commit + ship**

```bash
git add api/emersus/thread-title.js
git commit -m "feat(thread-title): route through llm-router (haiku default)"
```

### Task 5.2: nutrition-parser.js

**Files:**
- Modify: `C:\Users\Sidar\Desktop\emersus\api\emersus\nutrition-parser.js`

- [ ] **Step 1: Edit nutrition-parser.js (lines 107-125)**

The existing call uses `tool_choice: { type: "function", function: { name: "parse_foods" } }` to force the parser tool. Anthropic equivalent: `tool_choice: { type: "tool", name: "parse_foods" }`. Use `toAnthropicToolChoice` from Task 1.3.

- [ ] **Step 2: Run tests**: `node --test tests/unit/nutrition-parser.test.js`
- [ ] **Step 3: Local smoke**: log a meal via the food-logging tool, verify parsed items
- [ ] **Step 4: Commit + ship**

```bash
git add api/emersus/nutrition-parser.js
git commit -m "feat(nutrition-parser): route through llm-router with forced tool_choice"
```

### Task 5.3: suggest-prompts-personalize.js

**Files:**
- Modify: `C:\Users\Sidar\Desktop\emersus\api\emersus\suggest-prompts-personalize.js`

- [ ] **Step 1: Edit (uses custom HTTP, not SDK — replace with SDK call when provider=anthropic)**
- [ ] **Step 2: Keep the 4-second timeout (Anthropic SDK accepts AbortSignal)**
- [ ] **Step 3: Run tests + smoke + commit + ship**

```bash
git add api/emersus/suggest-prompts-personalize.js
git commit -m "feat(suggest-prompts): route through llm-router (haiku default)"
```

### Task 5.4: hyde.js

**Files:**
- Modify: `C:\Users\Sidar\Desktop\emersus\api\emersus\pipeline\hyde.js`

Per memory `project_hyde_retrieval_live.md`, HyDE is live with `CHAT_HYDE_ENABLED=true` and adds +5.5pp recall@10. The HyDE call generates a hypothetical biomedical answer for vector-search bridging — pure utility, Haiku is fine.

- [ ] **Step 1: Edit hyde.js (lines 51-69)**

Apply router-shim. Default model: `claude-haiku-4-5`. Max tokens: 240. Temperature: 0.2.

- [ ] **Step 2: Re-run the bench-matrix harness with both providers**

Per memory `reference_retrieval_matrix_harness.md`:
```bash
node scripts/eval/bench-matrix.js --stacks=hyde-openai,hyde-anthropic
```

Verify HyDE-anthropic recall@10 is within ±2pp of HyDE-openai. If not, re-tune the HyDE prompt for Sonnet/Haiku output style.

- [ ] **Step 3: Commit + ship**

```bash
git add api/emersus/pipeline/hyde.js
git commit -m "feat(hyde): route through llm-router"
```

---

## Phase 6: Background Jobs

### Task 6.1: classify-candidates.js (topic classifier)

**Files:**
- Modify: `C:\Users\Sidar\Desktop\emersus\jobs\classify-candidates.js`

The classifier uses `response_format: { type: "json_object" }`. Anthropic does not have JSON-object response format; instead use a tool-call with a strict schema (or just prompt for JSON and parse). Cleanest: add a `classify_articles` tool with the expected output schema and force tool-use via `tool_choice: { type: "tool", name: "classify_articles" }`.

- [ ] **Step 1: Define the classify_articles tool schema**

```js
const CLASSIFY_TOOL = {
  type: "function",
  name: "classify_articles",
  strict: true,
  description: "Classify each article for exercise-science relevance.",
  parameters: {
    type: "object",
    required: ["classifications"],
    additionalProperties: false,
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          required: ["pmid", "is_relevant", "confidence", "topic_key", "pubmed_query"],
          additionalProperties: false,
          properties: {
            pmid: { type: "string" },
            is_relevant: { type: "boolean" },
            confidence: { type: "number" },
            topic_key: { type: ["string", "null"] },
            pubmed_query: { type: ["string", "null"] },
          },
        },
      },
    },
  },
};
```

- [ ] **Step 2: Use Batch API for cost savings**

This is a background job — use Anthropic's Message Batch API (50% off). Wrap in a small batch-helper that submits up to 100K classifications per batch and polls for completion. Schema:
```js
const batch = await client.messages.batches.create({
  requests: chunks.map((c, i) => ({
    custom_id: `feed-${feedId}-batch-${i}`,
    params: {
      model: "claude-haiku-4-5",
      max_tokens: 4000,
      tools: [CLASSIFY_TOOL_ANTHROPIC],
      tool_choice: { type: "tool", name: "classify_articles" },
      messages: [{ role: "user", content: buildPrompt(c) }],
    },
  })),
});
// Poll batch.id every minute until status === "ended"; download results.
```

- [ ] **Step 3: Update jobs registry to handle batch-style async**

This is a bigger lift than the synchronous-call swap above. Worth it because classify-candidates runs at high volume (every research-topic feed pull) and 50% cost reduction is meaningful.

- [ ] **Step 4: Run a single batch end-to-end on the staging feed**

Verify pmids are classified correctly and the topic_key matches expected.

- [ ] **Step 5: Commit + ship to emersus-worker**

```bash
git add jobs/classify-candidates.js
git commit -m "feat(classify): use Anthropic Batch API for topic classification"
```

Per memory `feedback_webhook_doesnt_restart_worker.md`, after pushing to `jobs/`, manually:
```bash
ssh hetzner 'pm2 restart emersus-worker --update-env'
```

---

## Phase 7: Eval Scripts

Lower priority — these are dev-only. Update each to support `--provider=anthropic`. Not bite-sized; fold into the affected eval runs as you do them.

- [ ] **scripts/eval/generate-fixtures.js** — accept `--provider`
- [ ] **scripts/eval/bench-matrix.js** — accept per-stack provider in `stacks.json`
- [ ] **scripts/eval/lib/query-expand.js** — provider switch
- [ ] **scripts/eval/adversarial-eval.js** — provider switch
- [ ] **scripts/eval/grounding-eval.js** — provider switch
- [ ] **scripts/eval/anchor-frr-audit.js** — provider switch
- [ ] **scripts/contextual-embedding/compare-*.js** — provider switch

For each: add a `--provider` CLI arg, pass through to a shared LLM helper, default to `openai` to preserve baseline reproducibility.

Per memory `feedback_webhook_stashes_eval_edits.md`: **commit eval-script edits before any deploy to prod**, otherwise the webhook stashes them.

---

## Phase 8: Cleanup

Run only after Phase 2 has been on `LLM_SYNTHESIS_PROVIDER=anthropic` globally for 14 days with no rollback signals.

### Task 8.1: Delete the OpenAI synthesis path

- [ ] **Step 1: Confirm Anthropic is the only synthesis path in prod for 14 days**

Run: `ssh hetzner 'grep LLM_SYNTHESIS_PROVIDER ~/app/.env'`
Expected: `LLM_SYNTHESIS_PROVIDER=anthropic`. Also check chat_token_usage_events for the past 14d to confirm no `model LIKE 'gpt-%'` rows in synthesis path:
```sql
select model, count(*) from chat_token_usage_events
where created_at > now() - interval '14 days' group by 1;
```

- [ ] **Step 2: Delete the OpenAI synthesis files**

Files to delete (or strip the OpenAI code path from):
- `api/emersus/pipeline/synthesize.js` — keep only `resolveMaxOutputTokens` (still used by the Anthropic version) + the `MAX_OUTPUT_TOKENS` constant. Delete `synthesize()`, `buildRequestBody()`, `fetchWithRetry()`, `isPreviousResponseNotFound()`, `PROMPT_CACHE_KEY`.
- `api/emersus/pipeline/stream.js` — keep nothing OpenAI-specific. Move `parseSSELine`, `extractTokenUsage`, `processEvent` to `stream-anthropic.js` (they are now Anthropic-only).
- The router-shim functions in workflow.js collapse to direct Anthropic calls.

- [ ] **Step 3: Delete the per-call-site provider flags**

```bash
ssh hetzner 'sed -i "/^LLM_SYNTHESIS_PROVIDER=/d; /^LLM_SYNTHESIS_MODEL=/d; /^LLM_SYNTHESIS_CACHE_TTL=/d" ~/app/.env'
```

Repeat for every `LLM_*_PROVIDER` flag once the corresponding subsystem is fully migrated.

- [ ] **Step 4: Delete OPENAI_EMERSUS_MODEL, OPENAI_EMERSUS_PARSER_MODEL, OPENAI_EMERSUS_TITLE_MODEL**

Once all chat call sites are anthropic-only, these are dead.

- [ ] **Step 5: Update CLAUDE.md and memory files**

- Memory `reference_production_openai_model.md` → mark superseded; create `reference_production_anthropic_model.md`
- Memory `feedback_openai_strict_mode.md` → keep (still relevant for nutrition-parser's tool_choice contract)
- Memory `reference_openai_api_docs.md` → annotate "deprecated for chat; still relevant for embeddings/moderation"
- Add memory file: `reference_anthropic_caching_strategy.md` documenting the cache_control breakpoint placement and TTL choice

- [ ] **Step 6: Commit**

```bash
git add api/emersus/pipeline/ api/emersus/workflow.js server.js CLAUDE.md
git commit -m "chore: remove OpenAI chat path post-Anthropic migration"
```

---

## Phase 9: Soak + Sunset

### Task 9.1: Define rollback criteria (write before Phase 2 ships)

If any of these triggers fire in the first 14 days post-100%:
- Grounding-eval recall@10 drops >5pp from pre-migration baseline
- p95 TTFB > 4s (from current ~1.5s)
- Tool-validation failure rate > 2% (currently <0.5%)
- 7-day cost > $50/day at current traffic (sanity ceiling)

→ Roll back via the procedure in `~/.claude/projects/.../memory/feedback_verify_live_state_first.md`:
```bash
ssh hetzner 'sed -i "s/LLM_SYNTHESIS_PROVIDER=anthropic/LLM_SYNTHESIS_PROVIDER=openai/" ~/app/.env && pm2 restart emersus-api --update-env'
```

Verify the rollback worked with a live probe (per memory: don't trust .env alone; check actual model in chat_token_usage_events).

### Task 9.2: Schedule the cleanup PR

Per the system prompt's `/schedule` guidance: after Phase 2 ships at 100%, the agent should offer:

> **Want me to /schedule an agent in 14 days to open the Phase 8 cleanup PR (delete OpenAI synthesis path + remove flags)?**

If user accepts, the agent runs at the scheduled time, executes Tasks 8.1–8.6, opens a PR.

---

## Self-Review

**1. Spec coverage** — every OpenAI call site from the inventory mapped to a task:

| Call site | File | Phase / Task |
|---|---|---|
| Synthesis (hot) | synthesize.js | 2.3 |
| Stream | stream.js | 2.1, 2.2, 2.5 |
| HyDE | hyde.js | 5.4 |
| Moderation | safety.js | **NOT MIGRATED** (Decision #4) |
| Memory extract | extract-memory.js | 4.1 |
| Onboarding | onboarding.js | 3.1 |
| Two-stage | two-stage/extract.js + compose.js | 3.2 |
| Anchor verify | anchor-verify.js | 3.3 |
| Claim modes | claim-modes.js | 3.3 |
| Thread title | thread-title.js | 5.1 |
| Nutrition parser | nutrition-parser.js | 5.2 |
| Suggest prompts | suggest-prompts-personalize.js | 5.3 |
| Embed batch | jobs/embed-batch.js | **NOT MIGRATED** (Decision #3) |
| Embeddings | embeddings.js | **NOT MIGRATED** (Decision #3) |
| Classify candidates | jobs/classify-candidates.js | 6.1 |
| Eval scripts (~10) | scripts/eval/* | 7 (one task each) |

**2. Placeholder scan** — no "TBD", "implement later", or "fill in details". Phase 7 deliberately bullets the eval scripts without per-step code (they're dev-only, low-risk, repeating the Phase 5 pattern). Phase 3 tasks share a pattern with Phase 2 and reference it explicitly rather than duplicating ~200 lines of code.

**3. Type consistency**
- `resolveProvider(callSiteKey)` returns `"openai" | "anthropic"` — used identically in workflow.js (Task 2.4), onboarding.js (3.1), two-stage (3.2), etc.
- `normalizeModel(provider, openaiModel)` returns a string — same call shape everywhere
- `toAnthropicTools(openaiTools)` returns an array of `{name, description, input_schema}` — used by synthesize-anthropic.js (2.3) and onboarding.js (3.1)
- `processEvent(event, state)` mutates `state` and emits via callbacks — same contract as the OpenAI `stream.js` version
- `state.tokenUsage` shape `{input_tokens, output_tokens, total_tokens, cached_tokens}` matches the existing `extractTokenUsage` return shape in stream.js (so chat_token_usage_events writes are unchanged)

**4. Operational gates**
- Phase 1 ships independently (no behavior change)
- Phase 2.7 (smoke) is a hard gate before Phase 2.8 (canary)
- Phase 2.8 has a 24h+48h watch period before flipping global default
- Each subsequent phase mirrors the canary pattern at its own scale
- Phase 8 cleanup is gated on 14-day stable global rollout

**5. Decisions surfaced**
- The 9 decisions at the top must be confirmed before Phase 2 begins. Phase 1 is decision-independent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-27-anthropic-sonnet-migration.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Best for the heavy Phase 2 work where each task has lots of code review value.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints. Best if you want to walk through each step yourself.

**Which approach?**
