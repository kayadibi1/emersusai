# Cross-Thread Memory — Phase 3 Implementation Plan (`recall_memory` tool)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the `recall_memory` server-side tool so the model can query a user's memory on demand — for off-path questions the always-inject + RAG set didn't already surface. Typical triggers: *"what was my deadlift PR in March?"*, *"remember when I mentioned my shoulder?"*, *"what equipment did I tell you I have?"*.

**Architecture:** Same pattern as `remember_fact` (Phase 1) and `get_user_profile`: a strict-mode function tool declared in `tools.js`, flag-gated by `MEMORY_RECALL_ENABLED`, resolved server-side in `stream.js resolveAndContinue`. Backed by a new PostgREST RPC `recall_memory` that's broader than the Phase 2 retrieval RPCs — searches ALL tiers, includes resolved/archived rows (for "remember when…" recall), supports optional semantic query + optional category filter.

**Tech stack:** Postgres 15 + pgvector (already set up) · PostgREST RPC · OpenAI Responses API strict-mode function calling · `text-embedding-3-small`.

**Spec reference:** `docs/superpowers/specs/2026-04-16-cross-thread-memory-design.md` §5.3 (`recall_memory` schema), §3 (status lifecycle — resolved/archived are user-recallable), §9.8 (`MEMORY_RECALL_ENABLED` kill switch).

**Prior phases:** `docs/superpowers/plans/2026-04-16-cross-thread-memory-phase-0-1.md`, `docs/superpowers/plans/2026-04-16-cross-thread-memory-phase-2.md` (both shipped 2026-04-16 / 2026-04-17).

---

## Why a new RPC instead of reusing `retrieve_memory_rag`

The Phase 2 `retrieve_memory_rag` is tuned for the *automatic* retrieval path — it excludes Tier A/D (handled by always-inject), requires non-null embeddings, filters out resolved/archived. The `recall_memory` tool is the opposite — the *explicit* recall path, which should:

- Include every tier (user might ask about an old injury = Tier A).
- Include `status in ('confirmed', 'resolved', 'archived')` — resolved rows preserve history ("yes you did have a shoulder thing last year; here's what you said and that you marked it healed").
- Accept a null embedding (plain category filter / recency-ordered recall, no semantic query).

Two RPCs is the right factoring — each has a single, clear purpose.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/20260417_recall_memory_rpc.sql` | Create | `recall_memory(user_id, embedding?, categories?, limit)` RPC |
| `api/emersus/pipeline/tools.js` | Modify | Add `RECALL_MEMORY` tool definition; include in `buildToolDefinitions()` when `MEMORY_RECALL_ENABLED=true` |
| `api/emersus/pipeline/recall-memory-handler.js` | Create | Embeds query if present, calls RPC, returns rows for the model |
| `api/emersus/pipeline/stream.js` | Modify | Add `recall_memory` branch to `resolveAndContinue` |
| `tests/unit/api/emersus/pipeline/tools.test.js` | Modify | Add RECALL_MEMORY schema + buildToolDefinitions gating tests |
| `tests/unit/api/emersus/pipeline/recall-memory-handler.test.js` | Create | Handler unit tests |

---

## Task 1 — RPC migration

**Files:** Create `supabase/20260417_recall_memory_rpc.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/20260417_recall_memory_rpc.sql
-- Phase 3 cross-thread memory recall RPC. See
-- docs/superpowers/specs/2026-04-16-cross-thread-memory-design.md §5.3.
--
-- Broader than retrieve_memory_rag: includes all tiers, includes resolved +
-- archived rows (so users can ask "remember when I had that shoulder thing?"),
-- accepts null embedding for category-only recall.
--
-- SECURITY INVOKER + search_path = public, extensions for pgvector <=> operator
-- (same pattern as 20260417_memory_retrieval_rpcs.sql after the search_path fix).

begin;

create or replace function public.recall_memory(
  p_user_id     uuid,
  p_embedding   vector(1536) default null,
  p_categories  text[]       default null,
  p_limit       int          default 6
)
returns table (
  id                uuid,
  category          text,
  tier              char(1),
  fact              text,
  metadata          jsonb,
  status            text,
  created_at        timestamptz,
  last_mentioned_at timestamptz,
  resolved_at       timestamptz,
  similarity        real
)
language sql
security invoker
set search_path = public, extensions
stable
as $$
  select
    m.id,
    m.category,
    m.tier,
    m.fact,
    m.metadata,
    m.status,
    m.created_at,
    m.last_mentioned_at,
    m.resolved_at,
    case
      when p_embedding is not null and m.fact_embedding is not null
        then (1 - (m.fact_embedding <=> p_embedding))::real
      else null
    end as similarity
  from public.user_memories m
  where m.user_id = p_user_id
    and m.status in ('confirmed', 'resolved', 'archived')
    and (p_categories is null
         or array_length(p_categories, 1) is null
         or m.category = any(p_categories))
    and (p_embedding is null
         or m.fact_embedding is null
         or true)  -- allow non-embedded rows when filter is semantic OR category-only
  order by
    case when p_embedding is not null and m.fact_embedding is not null
         then m.fact_embedding <=> p_embedding end asc nulls last,
    m.last_mentioned_at desc
  limit coalesce(p_limit, 6);
$$;

grant execute on function public.recall_memory(uuid, vector, text[], int) to authenticated, service_role;

commit;
```

- [ ] **Step 2: Commit locally** (prod apply waits for user OK)

```bash
git add supabase/20260417_recall_memory_rpc.sql
git commit -m "feat(memory): Phase 3 — recall_memory RPC

SECURITY INVOKER fn that searches ALL tiers + ALL non-rejected/pending
statuses. Null embedding = category-only recall sorted by recency;
non-null embedding = semantic kNN. Broader than retrieve_memory_rag
(which is tuned for auto-retrieval, excludes Tier A/D, excludes
resolved+archived)."
```

---

## Task 2 — `RECALL_MEMORY` tool definition (TDD)

**Files:**
- Modify: `api/emersus/pipeline/tools.js`
- Modify: `tests/unit/api/emersus/pipeline/tools.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/api/emersus/pipeline/tools.test.js`:

```javascript
// Near the top of the file, extend the imports:
// import { ..., RECALL_MEMORY } from "../../../../../api/emersus/pipeline/tools.js";

describe("RECALL_MEMORY tool definition", () => {
  it("has type=function, strict=true, correct parameter shape", () => {
    assert.equal(RECALL_MEMORY.type, "function");
    assert.equal(RECALL_MEMORY.name, "recall_memory");
    assert.equal(RECALL_MEMORY.strict, true);
    const p = RECALL_MEMORY.parameters;
    assert.equal(p.additionalProperties, false);
    assert.deepEqual(p.required.slice().sort(), ["query", "categories", "limit"].sort());
    // All three properties must be nullable per strict-mode rules.
    assert.deepEqual(p.properties.query.type, ["string", "null"]);
    assert.deepEqual(p.properties.limit.type, ["integer", "null"]);
    // categories is array|null; when non-null, items are the 20-category enum
    assert.ok(Array.isArray(p.properties.categories.type));
    assert.ok(p.properties.categories.type.includes("null"));
    assert.ok(p.properties.categories.type.includes("array"));
  });
});

describe("buildToolDefinitions — flag-gated recall_memory", () => {
  it("excludes recall_memory when MEMORY_RECALL_ENABLED unset", () => {
    const saved = process.env.MEMORY_RECALL_ENABLED;
    delete process.env.MEMORY_RECALL_ENABLED;
    try {
      const defs = buildToolDefinitions();
      assert.ok(!defs.some((d) => d.name === "recall_memory"));
    } finally {
      if (saved === undefined) delete process.env.MEMORY_RECALL_ENABLED;
      else process.env.MEMORY_RECALL_ENABLED = saved;
    }
  });

  it("includes recall_memory when MEMORY_RECALL_ENABLED=true", () => {
    const saved = process.env.MEMORY_RECALL_ENABLED;
    process.env.MEMORY_RECALL_ENABLED = "true";
    try {
      const defs = buildToolDefinitions();
      assert.ok(defs.some((d) => d.name === "recall_memory"));
    } finally {
      if (saved === undefined) delete process.env.MEMORY_RECALL_ENABLED;
      else process.env.MEMORY_RECALL_ENABLED = saved;
    }
  });

  it("both remember_fact and recall_memory present when both flags on", () => {
    const savedR = process.env.MEMORY_REMEMBER_FACT_ENABLED;
    const savedL = process.env.MEMORY_RECALL_ENABLED;
    process.env.MEMORY_REMEMBER_FACT_ENABLED = "true";
    process.env.MEMORY_RECALL_ENABLED = "true";
    try {
      const defs = buildToolDefinitions();
      assert.ok(defs.some((d) => d.name === "remember_fact"));
      assert.ok(defs.some((d) => d.name === "recall_memory"));
    } finally {
      if (savedR === undefined) delete process.env.MEMORY_REMEMBER_FACT_ENABLED;
      else process.env.MEMORY_REMEMBER_FACT_ENABLED = savedR;
      if (savedL === undefined) delete process.env.MEMORY_RECALL_ENABLED;
      else process.env.MEMORY_RECALL_ENABLED = savedL;
    }
  });

  it("SERVER_SIDE_TOOLS contains recall_memory regardless of flag", () => {
    assert.ok(SERVER_SIDE_TOOLS.has("recall_memory"));
  });
});
```

- [ ] **Step 2: Run the test — expected FAIL** (RECALL_MEMORY not exported)

```bash
node --experimental-test-module-mocks --test tests/unit/api/emersus/pipeline/tools.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Add RECALL_MEMORY in `api/emersus/pipeline/tools.js`**

Below the existing REMEMBER_FACT definition, add:

```javascript
// ── recall_memory (server-side tool, flag-gated) ────────────────────────
//
// When MEMORY_RECALL_ENABLED=true, the model can query the user's memory on
// demand — for off-path questions that always-inject + RAG didn't cover.
// Typical uses: "what was my deadlift PR in March?", "remember when I
// mentioned my shoulder?". See spec §5.3.
//
// Wider than Phase 2's automatic RAG: includes all tiers (A–E + X), includes
// resolved + archived rows so "remember when…" questions can surface history.

export const RECALL_MEMORY = {
  type: "function",
  name: "recall_memory",
  description:
    "Retrieve prior-thread memory about the user. Use when you need context the profile and auto-injected memories don't cover — typically PR history, past events, preferences, or explicit recall requests from the user ('remember when I mentioned…', 'what was my…'). Either `query` OR `categories` must be non-null to produce useful results; passing both narrows the result. `limit` defaults to 6 if null; hard cap 20.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      query:      { type: ["string", "null"] },
      categories: {
        type: ["array", "null"],
        items: { type: "string", enum: MEMORY_CATEGORY_ENUM.filter((c) => c !== "custom").concat(["custom"]) },
      },
      limit:      { type: ["integer", "null"] },
    },
    required: ["query", "categories", "limit"],
    additionalProperties: false,
  },
};
```

Then extend `buildToolDefinitions` to include RECALL_MEMORY when `MEMORY_RECALL_ENABLED=true`:

```javascript
export function buildToolDefinitions() {
  const defs = [...TOOL_DEFINITIONS];
  const rememberEnabled = /^(true|1)$/i.test(String(process.env.MEMORY_REMEMBER_FACT_ENABLED || "").trim());
  const recallEnabled   = /^(true|1)$/i.test(String(process.env.MEMORY_RECALL_ENABLED      || "").trim());
  if (rememberEnabled) defs.push(REMEMBER_FACT);
  if (recallEnabled)   defs.push(RECALL_MEMORY);
  return defs;
}
```

And extend `SERVER_SIDE_TOOLS`:

```javascript
export const SERVER_SIDE_TOOLS = new Set([
  "get_user_profile",
  "update_user_profile",
  "remember_fact",
  "recall_memory",
]);
```

- [ ] **Step 4: Run tests — expected PASS**

```bash
node --experimental-test-module-mocks --test tests/unit/api/emersus/pipeline/tools.test.js 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add api/emersus/pipeline/tools.js tests/unit/api/emersus/pipeline/tools.test.js
git commit -m "feat(memory): Phase 3 — RECALL_MEMORY tool definition (flag-gated)

Strict-mode schema with nullable query / categories / limit (all in
required per strict-mode rules). SERVER_SIDE_TOOLS includes
'recall_memory' unconditionally so the resolver branch fires if the
flag flips mid-turn."
```

---

## Task 3 — `resolveRecallMemory` handler (TDD)

**Files:**
- Create: `api/emersus/pipeline/recall-memory-handler.js`
- Create: `tests/unit/api/emersus/pipeline/recall-memory-handler.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/api/emersus/pipeline/recall-memory-handler.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecallMemory } from '../../../../../api/emersus/pipeline/recall-memory-handler.js';

function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) return { ok: false, status: 404, json: async () => ({}), text: async () => 'no route' };
    return {
      ok: route.ok !== false,
      status: route.status ?? 200,
      json: async () => route.body,
      text: async () => JSON.stringify(route.body),
    };
  };
  impl.calls = calls;
  return impl;
}

const CTX = { supabaseUserId: '00000000-0000-0000-0000-000000000001' };
const DEPS_BASE = {
  supabaseUrl: 'https://supabase.example',
  serviceRoleKey: 'service-role-key',
  embedText: async () => new Array(1536).fill(0.01),
};

describe('resolveRecallMemory', () => {
  test('happy path: query + categories → embeds + calls RPC with both filters', async () => {
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/recall_memory': {
        body: [
          { id: 'r1', category: 'personal_record', tier: 'C', fact: 'bench 1RM 102.5 kg', metadata: {}, status: 'confirmed', created_at: '2026-03-15T00:00:00Z', last_mentioned_at: '2026-03-15T00:00:00Z', resolved_at: null, similarity: 0.79 },
        ],
      },
    });
    const out = await resolveRecallMemory({
      args: { query: 'bench PR history', categories: ['personal_record'], limit: 6 },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.ok(Array.isArray(out.memories));
    assert.equal(out.memories.length, 1);
    assert.equal(out.memories[0].fact, 'bench 1RM 102.5 kg');
    const body = JSON.parse(fetchImpl.calls[0].init.body);
    assert.equal(body.p_user_id, CTX.supabaseUserId);
    assert.ok(Array.isArray(body.p_embedding));
    assert.equal(body.p_embedding.length, 1536);
    assert.deepEqual(body.p_categories, ['personal_record']);
    assert.equal(body.p_limit, 6);
  });

  test('query only (no categories): embeds, null categories param', async () => {
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/recall_memory': { body: [] },
    });
    await resolveRecallMemory({
      args: { query: 'what about my knee?', categories: null, limit: null },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    const body = JSON.parse(fetchImpl.calls[0].init.body);
    assert.ok(Array.isArray(body.p_embedding));
    assert.equal(body.p_categories, null);
    assert.equal(body.p_limit, 6); // default
  });

  test('categories only (no query): null embedding param, no embed call', async () => {
    let embedCalls = 0;
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/recall_memory': { body: [] },
    });
    await resolveRecallMemory({
      args: { query: null, categories: ['injury', 'medication'], limit: 10 },
      ctx: CTX,
      deps: {
        ...DEPS_BASE,
        fetchImpl,
        embedText: async () => { embedCalls++; return new Array(1536).fill(0.0); },
      },
    });
    assert.equal(embedCalls, 0, 'no embed when query is null');
    const body = JSON.parse(fetchImpl.calls[0].init.body);
    assert.equal(body.p_embedding, null);
    assert.deepEqual(body.p_categories, ['injury', 'medication']);
    assert.equal(body.p_limit, 10);
  });

  test('both null (unproductive call): returns empty without hitting DB', async () => {
    const fetchImpl = stubFetch({ '/rest/v1/rpc/recall_memory': { body: [] } });
    const out = await resolveRecallMemory({
      args: { query: null, categories: null, limit: null },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.deepEqual(out, { memories: [] });
    assert.equal(fetchImpl.calls.length, 0, 'short-circuit');
  });

  test('limit clamped to [1, 20]', async () => {
    const fetchImpl = stubFetch({ '/rest/v1/rpc/recall_memory': { body: [] } });
    await resolveRecallMemory({
      args: { query: null, categories: ['injury'], limit: 999 },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.equal(JSON.parse(fetchImpl.calls[0].init.body).p_limit, 20);

    fetchImpl.calls.length = 0;
    await resolveRecallMemory({
      args: { query: null, categories: ['injury'], limit: 0 },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.equal(JSON.parse(fetchImpl.calls[0].init.body).p_limit, 1);
  });

  test('missing supabaseUserId: returns empty', async () => {
    const fetchImpl = stubFetch({});
    const out = await resolveRecallMemory({
      args: { query: 'anything', categories: null, limit: null },
      ctx: { supabaseUserId: '' },
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.deepEqual(out, { memories: [] });
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('RPC 500: returns empty + error field', async () => {
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/recall_memory': { ok: false, status: 500, body: { message: 'down' } },
    });
    const out = await resolveRecallMemory({
      args: { query: null, categories: ['injury'], limit: null },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.deepEqual(out.memories, []);
    assert.match(out.error, /recall_memory_rpc_failed_500/);
  });

  test('embed failure (query path): returns empty + error, no RPC call', async () => {
    const fetchImpl = stubFetch({ '/rest/v1/rpc/recall_memory': { body: [] } });
    const out = await resolveRecallMemory({
      args: { query: 'what about my knee?', categories: null, limit: null },
      ctx: CTX,
      deps: {
        ...DEPS_BASE,
        fetchImpl,
        embedText: async () => { throw new Error('rate_limit'); },
      },
    });
    assert.deepEqual(out.memories, []);
    assert.match(out.error, /embed_failed/);
    assert.equal(fetchImpl.calls.length, 0);
  });
});
```

- [ ] **Step 2: Run test — expected FAIL** (module not found)

```bash
node --experimental-test-module-mocks --test tests/unit/api/emersus/pipeline/recall-memory-handler.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Write the handler**

```javascript
// api/emersus/pipeline/recall-memory-handler.js
//
// Resolves the recall_memory server-side tool call (spec §5.3). Wrapper
// around the recall_memory RPC that accepts either a semantic query or a
// category filter (or both); returns a pruned list of memories for the
// model to use in its answer. On any failure, returns `{ memories: [],
// error }` so the model gets a clean "nothing found" signal without 5xxing
// the whole turn.

import { embedText as defaultEmbedText } from "../embeddings.js";

const MIN_LIMIT = 1;
const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 6;

function clampLimit(n) {
  const v = Number.isFinite(n) ? Math.floor(n) : DEFAULT_LIMIT;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, v || DEFAULT_LIMIT));
}

export async function resolveRecallMemory({ args, ctx, deps = {} } = {}) {
  const userId = ctx?.supabaseUserId;
  if (!userId) return { memories: [] };

  const query      = typeof args?.query === "string" && args.query.trim() ? args.query.trim() : null;
  const categories = Array.isArray(args?.categories) && args.categories.length ? args.categories : null;
  const limit      = clampLimit(args?.limit);

  // If both null, nothing to look up.
  if (!query && !categories) return { memories: [] };

  const fetchImpl      = deps.fetchImpl      || globalThis.fetch;
  const supabaseUrl    = deps.supabaseUrl    || process.env.SUPABASE_URL;
  const serviceRoleKey = deps.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const embedText      = deps.embedText      || defaultEmbedText;
  if (!supabaseUrl || !serviceRoleKey) return { memories: [], error: "supabase_env_missing" };

  let embedding = null;
  if (query) {
    try {
      embedding = await embedText(query);
    } catch (err) {
      return { memories: [], error: `embed_failed: ${err?.message || err}` };
    }
  }

  let response;
  try {
    response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/recall_memory`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_user_id:    userId,
        p_embedding:  embedding,
        p_categories: categories,
        p_limit:      limit,
      }),
    });
  } catch (err) {
    return { memories: [], error: `rpc_network_error: ${err?.message || err}` };
  }

  if (!response.ok) {
    let detail = "";
    try { detail = await response.text(); } catch { /* ignore */ }
    return { memories: [], error: `recall_memory_rpc_failed_${response.status}: ${detail.slice(0, 200)}` };
  }

  const rows = await response.json().catch(() => []);
  const memories = (Array.isArray(rows) ? rows : []).map((r) => ({
    category: r.category,
    tier: r.tier,
    fact: r.fact,
    metadata: r.metadata || {},
    status: r.status,
    ...(r.similarity != null ? { similarity: Math.round(r.similarity * 100) / 100 } : {}),
    on: r.last_mentioned_at || r.created_at,
  }));

  return { memories };
}
```

- [ ] **Step 4: Run tests — expected PASS**

```bash
node --experimental-test-module-mocks --test tests/unit/api/emersus/pipeline/recall-memory-handler.test.js 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add api/emersus/pipeline/recall-memory-handler.js tests/unit/api/emersus/pipeline/recall-memory-handler.test.js
git commit -m "feat(memory): Phase 3 — resolveRecallMemory handler

Thin wrapper around recall_memory RPC. Embeds query if present;
short-circuits on both-null args; clamps limit to [1,20]. Soft-fails
with {memories: [], error} so the model never 5xxes a turn."
```

---

## Task 4 — Wire into `stream.js`

**Files:** Modify `api/emersus/pipeline/stream.js`

- [ ] **Step 1: Add branch in `resolveAndContinue`**

Right after the `remember_fact` branch added in Phase 1, add:

```javascript
} else if (tc.name === "recall_memory") {
  const { resolveRecallMemory } = await import("./recall-memory-handler.js");
  const result = await resolveRecallMemory({ args: tc.args, ctx });
  toolOutputs.push({
    type: "function_call_output",
    call_id: tc.callId,
    output: JSON.stringify(result),
  });
}
```

- [ ] **Step 2: Run stream tests + full suite**

```bash
node --experimental-test-module-mocks --test tests/unit/api/emersus/pipeline/stream.test.js 2>&1 | tail -5
npm run test:unit 2>&1 | tail -6
```

Expected: 499+ total tests pass (the ~7 additions from tasks 2+3).

- [ ] **Step 3: Commit**

```bash
git add api/emersus/pipeline/stream.js
git commit -m "feat(memory): Phase 3 — wire recall_memory in stream.js resolveAndContinue

Lazy-imported to avoid loading the handler on every turn when the flag
is off. Follows same pattern as remember_fact (Phase 1)."
```

---

## Task 5 — Strict-mode pre-flight

**Files:** Modify `scripts/memory-strict-preflight.js` to probe RECALL_MEMORY

- [ ] **Step 1: Extend the probe script**

Add `RECALL_MEMORY` to the probe. Import and include in the `tools` array:

```javascript
import { REMEMBER_FACT, RECALL_MEMORY } from '../api/emersus/pipeline/tools.js';
// ...
tools: [REMEMBER_FACT, RECALL_MEMORY],
```

Add two new probes that are likely to trigger `recall_memory`:

```javascript
['recall_pr_history',   "What was my deadlift PR from March?"],
['recall_shoulder',     "Remember what I told you about my shoulder?"],
```

- [ ] **Step 2: Run the pre-flight against prod model**

```bash
OPENAI_EMERSUS_MODEL=$(ssh hetzner 'grep ^OPENAI_EMERSUS_MODEL= ~/app/.env | cut -d= -f2- | tr -d "\""') \
OPENAI_API_KEY=$(ssh hetzner 'grep ^OPENAI_API_KEY= ~/app/.env | cut -d= -f2- | tr -d "\""') \
npm run test:memory-preflight 2>&1 | tail -15
```

Expected: 6 probes (4 original + 2 new), all PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/memory-strict-preflight.js
git commit -m "test(memory): extend strict-mode pre-flight to cover RECALL_MEMORY

Adds 2 recall-intent probes + includes RECALL_MEMORY in the tools array
so strict-mode validates both schemas in the same request. Expected
behavior: model either calls recall_memory or answers without it; what
matters is that OpenAI's validator accepts both schemas."
```

---

## Task 6 — PAUSE: prod apply + flag flip + smoke

**Files:** none (ops-only)

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

Webhook auto-redeploys. Code is inert: `MEMORY_RECALL_ENABLED=false` means the tool isn't advertised; the RPC doesn't exist yet either.

- [ ] **Step 2: Apply the RPC migration**

```bash
scp supabase/20260417_recall_memory_rpc.sql hetzner:~/app/supabase/
ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres < ~/app/supabase/20260417_recall_memory_rpc.sql 2>&1"
```

Expected: `BEGIN`, `CREATE FUNCTION`, `GRANT`, `COMMIT`.

- [ ] **Step 3: Sanity-test the RPC via service-role**

```bash
ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres -c \"
  -- Category-only recall against the test user's Phase 1 injury row
  select category, tier, fact, status from public.recall_memory(
    'be8605a9-9b65-49ef-8540-da90a254944a'::uuid,
    null,
    array['injury','medication']::text[],
    6
  );
\""
```

Expected: 1 row, the injury fact.

- [ ] **Step 4: Flip the flag + restart**

```bash
ssh hetzner "sed -i 's/^MEMORY_RECALL_ENABLED=.*/MEMORY_RECALL_ENABLED=true/' ~/app/.env && grep MEMORY_RECALL_ENABLED ~/app/.env && pm2 restart emersus-api --update-env 2>&1 | tail -3"
```

- [ ] **Step 5: End-to-end smoke**

Sign in at `https://emersus.ai/app/` as the Phase 1/2 test account, open a **new thread**, ask a question that should trigger `recall_memory` rather than always-inject:

> *"What did I tell you about my shoulder?"*

Expected: the model calls `recall_memory` (not remember_fact), the handler returns `{memories: [] }` because there's no shoulder fact (only the ACL injury exists), and the model answers honestly ("you haven't mentioned your shoulder yet").

Second probe to force a positive match:

> *"What do you remember about my knee?"*

Expected: model calls `recall_memory` with either `query='knee'` or `categories=['injury','biological_constraint']`, RPC returns the ACL row, model uses it in the answer. Might also be answered from always-inject since injury is Tier A — either is fine.

- [ ] **Step 6: Append changelog entry + memory note**

---

## Self-review checklist

- [ ] **Spec coverage.** Spec §5.3 (recall_memory schema + behavior), §3 (resolved/archived recall), §9.8 (kill switch) all mapped.
- [ ] **Placeholder scan.** No TBD. Task 5 uses the same `cut -d= -f2- | tr -d "\""` pattern for env extraction that already worked in Phase 0+1.
- [ ] **Type consistency.** `p_user_id`, `p_embedding`, `p_categories`, `p_limit` consistent between migration + handler + tests.
- [ ] **Rollback.** `DROP FUNCTION IF EXISTS public.recall_memory(uuid, vector, text[], int)` makes the handler 404 → `{memories: [], error}` → model falls back to profile/evidence. Or flip `MEMORY_RECALL_ENABLED=false`. No code rollback needed.

---

## What comes next (NOT in this plan)

- **Phase 4 — Memory tab + confirmation chip UI** (2 days). Required before Phase 5.
- **Phase 5 — Auto-extractor.** Highest-risk; own plan.
- **Phase 6 — Observability + TTL archival cron.** Smallest; own plan.
