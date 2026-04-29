# Cross-Thread Memory — Phase 0 + 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the cross-thread memory foundation (schema + feature flags) and the explicit-save slice (`remember_fact` tool) end-to-end. After this plan: a user who says *"remember that my left knee is the bad one"* has a durable, RLS-protected row in `public.user_memories` and sees a deterministic confirmation echo in the assistant's reply. Auto-extraction and retrieval do NOT ship here — they belong to later phases in the spec.

**Architecture:** New Postgres table `public.user_memories` with pgvector + HNSW + RLS. One additive key on `profiles.preferences`. A new in-process `resolveRememberFact` handler follows the existing `get_user_profile` server-side-tool pattern in `api/emersus/pipeline/stream.js`. Everything is gated behind env flags defaulting to FALSE; prod flips to TRUE only after the strict-mode pre-flight passes.

**Tech stack:** Postgres 15 · pgvector 0.7+ · Supabase RLS · Node 22 built-in test runner (`node --test`) + `node:assert/strict` · OpenAI Responses API with `strict: true` function-calling.

**Spec reference:** `docs/superpowers/specs/2026-04-16-cross-thread-memory-design.md` — Sections 4 (data model), 5.2 (`remember_fact` schema), 5.4 (strict-mode pre-flight), 9.8 (kill switches), 10.2 Phase 0–1 (scope), 10.3 Phase 0–1 (gates).

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/20260417_user_memories.sql` | Create | Table + indexes + RLS policies + `delete_all_my_memories()` function |
| `supabase/20260417_profile_memory_settings.sql` | Create | Seed `profiles.preferences.memory_autosave=true` for all existing rows |
| `api/emersus/pipeline/memory-flags.js` | Create | Read the three MEMORY_* env vars, export `isEnabled()` accessors |
| `api/emersus/pipeline/tools.js` | Modify | Add `REMEMBER_FACT` tool definition; conditionally include in `TOOL_DEFINITIONS` + `SERVER_SIDE_TOOLS` based on flag |
| `api/emersus/pipeline/stream.js` | Modify | Add `remember_fact` branch to `resolveAndContinue` server-tool switch |
| `.env.example` | Modify | Document the three MEMORY_* flags |
| `tests/unit/api/emersus/pipeline/tools.test.js` | Modify | Add cases for `REMEMBER_FACT` schema shape + flag-gated export |
| `tests/unit/api/emersus/pipeline/memory-flags.test.js` | Create | Unit-test the flag reader (env missing → FALSE, `"true"` → TRUE, etc.) |
| `tests/unit/api/emersus/pipeline/remember-fact-handler.test.js` | Create | Unit-test `resolveRememberFact` (length cap, category enum, Supabase insert shape) |
| `tests/integration/memory-rls-isolation.test.js` | Create | Two-user RLS isolation: insert as A, SELECT as B returns empty |
| `scripts/memory-strict-preflight.js` | Create | One real OpenAI API call per schema edge case. Prints PASS/FAIL. |

Files that MUST NOT be touched by this plan: `api/emersus/pipeline/prompt.js`, `api/emersus/pipeline/sanitize.js`, `api/emersus/workflow.js`. Those belong to Phase 2 (retrieval).

---

## Task 1 — Create `user_memories` migration

**Files:**
- Create: `supabase/20260417_user_memories.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/20260417_user_memories.sql
-- Cross-thread memory table. See docs/superpowers/specs/2026-04-16-cross-thread-memory-design.md §4.1.

begin;

create extension if not exists vector;

create table public.user_memories (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,

  category              text not null,
  tier                  char(1) not null,
  fact                  text not null,
  fact_embedding        vector(1536),
  fact_embedding_model  text not null default 'text-embedding-3-small',
  metadata              jsonb not null default '{}'::jsonb,

  source                text not null,
  source_thread_id      uuid,
  source_turn_ref       text,
  confidence            numeric(3,2),

  status                text not null default 'pending',
  expires_at            timestamptz,
  supersedes_id         uuid references public.user_memories(id),
  created_at            timestamptz not null default now(),
  confirmed_at          timestamptz,
  resolved_at           timestamptz,
  last_mentioned_at     timestamptz not null default now(),

  constraint user_memories_category_valid check (category in (
    'injury','allergy','medication','chronic_condition','pregnancy_status','biological_constraint',
    'goal','target_metric','dietary_protocol','schedule_pattern','coach_program',
    'personal_record','completed_event',
    'deload_window','illness_recovery','travel_constraint','sleep_deficit',
    'exercise_preference','supplement_stack','equipment_inventory',
    'custom'
  )),
  constraint user_memories_status_valid check (status in (
    'pending','confirmed','rejected','resolved','archived'
  )),
  constraint user_memories_tier_valid check (tier in ('A','B','C','D','E','X')),
  constraint user_memories_source_valid check (source in ('auto_extract','explicit','onboarding')),
  constraint user_memories_fact_length check (char_length(fact) between 1 and 500)
);

create index user_memories_user_cat_status_idx
  on public.user_memories (user_id, category, status)
  where status = 'confirmed';

create index user_memories_user_tier_status_idx
  on public.user_memories (user_id, tier, status)
  where status = 'confirmed';

create index user_memories_user_expires_idx
  on public.user_memories (user_id, expires_at)
  where status = 'confirmed';

create index user_memories_embedding_idx
  on public.user_memories using hnsw (fact_embedding vector_cosine_ops)
  where status = 'confirmed';

alter table public.user_memories enable row level security;

create policy user_memories_owner_select on public.user_memories
  for select using (user_id = auth.uid());

create policy user_memories_owner_insert on public.user_memories
  for insert with check (user_id = auth.uid());

create policy user_memories_owner_update on public.user_memories
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Hard-delete-all for the calling user. Audit-logged to guardrail_events
-- before the delete. No DELETE policy on the table — users must go through
-- this SECURITY DEFINER function.
create or replace function public.delete_all_my_memories()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.guardrail_events (event_type, user_id, metadata)
  values (
    'memory_bulk_delete',
    v_uid,
    jsonb_build_object(
      'count', (select count(*) from public.user_memories where user_id = v_uid),
      'requested_at', now()
    )
  );

  delete from public.user_memories where user_id = v_uid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.delete_all_my_memories() from public;
grant execute on function public.delete_all_my_memories() to authenticated;

commit;
```

- [ ] **Step 2: Syntax-check the SQL locally**

Run: `psql --set ON_ERROR_STOP=on --dry-run -f supabase/20260417_user_memories.sql 2>&1 | head -5`

(If `--dry-run` isn't available on the local psql, skip — the apply step in Task 2 catches syntax errors.)

- [ ] **Step 3: Verify guardrail_events.event_type accepts the new value**

Run: `grep -nE "memory_bulk_delete|event_type" supabase/20260405_guardrail_events.sql supabase/20260409_guardrail_events_hard_refusal.sql 2>/dev/null`

Expected: if `event_type` is an enum type, `memory_bulk_delete` must be added via `ALTER TYPE ... ADD VALUE`. If it's a text column with a check constraint, the check constraint must be extended. If it's unconstrained text, nothing to do.

If constrained: add a leading `ALTER TYPE guardrail_event_type ADD VALUE IF NOT EXISTS 'memory_bulk_delete';` (or equivalent) at the top of the migration, BEFORE the `begin;` — `ALTER TYPE ADD VALUE` cannot run inside a transaction.

- [ ] **Step 4: Commit the migration file**

```bash
git add supabase/20260417_user_memories.sql
git commit -m "feat(memory): add user_memories table migration

- Table with pgvector HNSW + partial indexes per tier/category/status
- RLS owner-only policies (no DELETE policy; hard delete via SECURITY DEFINER fn)
- delete_all_my_memories() audits to guardrail_events before deleting
- Category/status/tier/source check constraints match the design spec"
```

---

## Task 2 — Apply `user_memories` migration to prod

**Files:** none (remote DB change)

- [ ] **Step 1: Copy migration to Hetzner**

```bash
scp supabase/20260417_user_memories.sql hetzner:~/app/supabase/
```

- [ ] **Step 2: Apply via `supabase_admin`**

Per memory: self-hosted Supabase requires `supabase_admin` for migrations that reference `auth.users`. Run:

```bash
ssh hetzner "cd ~/app && docker compose exec -T supabase-db psql -U supabase_admin -d postgres -f /supabase/20260417_user_memories.sql 2>&1"
```

Expected output: `BEGIN`, `CREATE EXTENSION`, `CREATE TABLE`, four `CREATE INDEX`, `ALTER TABLE`, three `CREATE POLICY`, `CREATE FUNCTION`, `REVOKE`, `GRANT`, `COMMIT`.

If any line says `ERROR`, stop and debug before proceeding.

- [ ] **Step 3: Verify table + RLS exist**

```bash
ssh hetzner "cd ~/app && docker compose exec -T supabase-db psql -U supabase_admin -d postgres -c \"
  select
    (select count(*) from information_schema.tables where table_schema='public' and table_name='user_memories') as table_exists,
    (select count(*) from pg_policies where schemaname='public' and tablename='user_memories') as policy_count,
    (select count(*) from pg_indexes where schemaname='public' and tablename='user_memories') as index_count;
\""
```

Expected: `table_exists=1, policy_count=3, index_count=4` (4 = primary key + 3 partial btree; the HNSW may count differently depending on Postgres version — check with `\di public.user_memories*` and expect 5 rows including the primary key and HNSW index).

- [ ] **Step 4: Smoke-insert with service role, then clean up**

```bash
ssh hetzner "cd ~/app && docker compose exec -T supabase-db psql -U supabase_admin -d postgres -c \"
  insert into public.user_memories (user_id, category, tier, fact, source) values
    ('00000000-0000-0000-0000-000000000000','custom','X','smoke test','explicit');
  select count(*) from public.user_memories where fact='smoke test';
  delete from public.user_memories where fact='smoke test';
\""
```

Expected: `INSERT 0 1`, `count=1`, `DELETE 1`. Confirms table accepts writes and all constraints pass.

---

## Task 3 — Create `profile_memory_settings` migration

**Files:**
- Create: `supabase/20260417_profile_memory_settings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/20260417_profile_memory_settings.sql
-- Seed profiles.preferences.memory_autosave=true for existing users.
-- See docs/superpowers/specs/2026-04-16-cross-thread-memory-design.md §4.3.

begin;

update public.profiles
set preferences = coalesce(preferences, '{}'::jsonb) ||
                  jsonb_build_object('memory_autosave', true)
where preferences is null
   or not (preferences ? 'memory_autosave');

commit;
```

- [ ] **Step 2: Apply to prod**

```bash
scp supabase/20260417_profile_memory_settings.sql hetzner:~/app/supabase/
ssh hetzner "cd ~/app && docker compose exec -T supabase-db psql -U supabase_admin -d postgres -f /supabase/20260417_profile_memory_settings.sql 2>&1"
```

- [ ] **Step 3: Verify**

```bash
ssh hetzner "cd ~/app && docker compose exec -T supabase-db psql -U supabase_admin -d postgres -c \"
  select count(*) filter (where preferences ? 'memory_autosave') as with_flag,
         count(*) as total
  from public.profiles;
\""
```

Expected: `with_flag = total`.

- [ ] **Step 4: Commit**

```bash
git add supabase/20260417_profile_memory_settings.sql
git commit -m "feat(memory): seed profiles.preferences.memory_autosave=true"
```

---

## Task 4 — Env flags module

**Files:**
- Create: `api/emersus/pipeline/memory-flags.js`
- Create: `tests/unit/api/emersus/pipeline/memory-flags.test.js`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/api/emersus/pipeline/memory-flags.test.js
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('memory-flags', () => {
  const saved = {};
  const keys = [
    'MEMORY_EXTRACTOR_ENABLED',
    'MEMORY_REMEMBER_FACT_ENABLED',
    'MEMORY_RECALL_ENABLED',
  ];

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('all flags default FALSE when env unset', async () => {
    const m = await import(`../../../../../api/emersus/pipeline/memory-flags.js?cacheBust=${Date.now()}`);
    assert.equal(m.isExtractorEnabled(), false);
    assert.equal(m.isRememberFactEnabled(), false);
    assert.equal(m.isRecallEnabled(), false);
  });

  test('"true" (case-insensitive) enables a flag', async () => {
    process.env.MEMORY_REMEMBER_FACT_ENABLED = 'TRUE';
    const m = await import(`../../../../../api/emersus/pipeline/memory-flags.js?cacheBust=${Date.now()}`);
    assert.equal(m.isRememberFactEnabled(), true);
  });

  test('"1" also enables', async () => {
    process.env.MEMORY_RECALL_ENABLED = '1';
    const m = await import(`../../../../../api/emersus/pipeline/memory-flags.js?cacheBust=${Date.now()}`);
    assert.equal(m.isRecallEnabled(), true);
  });

  test('any other value is FALSE', async () => {
    process.env.MEMORY_EXTRACTOR_ENABLED = 'yes';
    const m = await import(`../../../../../api/emersus/pipeline/memory-flags.js?cacheBust=${Date.now()}`);
    assert.equal(m.isExtractorEnabled(), false);
  });
});
```

- [ ] **Step 2: Run test — expected FAIL**

```bash
npm run test:unit -- tests/unit/api/emersus/pipeline/memory-flags.test.js 2>&1 | tail -20
```

Expected: FAIL with `Cannot find module '../../../../../api/emersus/pipeline/memory-flags.js'`.

- [ ] **Step 3: Write the implementation**

```javascript
// api/emersus/pipeline/memory-flags.js
// Reads the three MEMORY_* kill-switch env vars. Default FALSE per spec §9.8 —
// memory subsystem stays dark until an operator explicitly flips a flag.

function readBool(envValue) {
  if (typeof envValue !== 'string') return false;
  const v = envValue.trim().toLowerCase();
  return v === 'true' || v === '1';
}

export function isExtractorEnabled() {
  return readBool(process.env.MEMORY_EXTRACTOR_ENABLED);
}

export function isRememberFactEnabled() {
  return readBool(process.env.MEMORY_REMEMBER_FACT_ENABLED);
}

export function isRecallEnabled() {
  return readBool(process.env.MEMORY_RECALL_ENABLED);
}
```

- [ ] **Step 4: Run tests — expected PASS**

```bash
npm run test:unit -- tests/unit/api/emersus/pipeline/memory-flags.test.js 2>&1 | tail -10
```

Expected: 4 passing tests.

- [ ] **Step 5: Document the flags in `.env.example`**

Append to `.env.example`:

```
# Memory subsystem kill switches (spec §9.8). All default FALSE — the memory
# table and schema can exist in the DB without any runtime path being active.
# Flip to "true" to enable each independent slice.
MEMORY_EXTRACTOR_ENABLED=false         # Phase 5 — auto-extraction
MEMORY_REMEMBER_FACT_ENABLED=false     # Phase 1 — explicit remember_fact tool
MEMORY_RECALL_ENABLED=false            # Phase 3 — recall_memory tool
```

- [ ] **Step 6: Commit**

```bash
git add api/emersus/pipeline/memory-flags.js tests/unit/api/emersus/pipeline/memory-flags.test.js .env.example
git commit -m "feat(memory): add memory-flags env reader + unit tests

Three independent kill switches per spec §9.8. All default FALSE so the
table can exist in prod without any runtime path being active."
```

---

## Task 5 — Two-user RLS isolation integration test

**Files:**
- Create: `tests/integration/memory-rls-isolation.test.js`

- [ ] **Step 1: Inspect existing integration-test auth helpers**

```bash
grep -RnE "createTestUser|signInWithPassword|supabase.*auth" tests/integration/ tests/_helpers/ 2>/dev/null | head -10
```

Use the same helper the other integration tests use to mint two test users. If no helper exists, inline the two sign-in calls (anon key + email/password) following the pattern in `tests/integration/end-to-end-smoke.test.js`.

- [ ] **Step 2: Write the test**

```javascript
// tests/integration/memory-rls-isolation.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

describe('user_memories RLS — two-user isolation', () => {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  // These two test accounts must exist in the target Supabase instance.
  // Provision in the test env via the existing test-user seeding pattern.
  const userA = { email: process.env.TEST_USER_A_EMAIL, password: process.env.TEST_USER_A_PASSWORD };
  const userB = { email: process.env.TEST_USER_B_EMAIL, password: process.env.TEST_USER_B_PASSWORD };

  let clientA, clientB, createdId;

  before(async () => {
    clientA = createClient(url, anon);
    clientB = createClient(url, anon);

    const a = await clientA.auth.signInWithPassword(userA);
    assert.ok(!a.error, `user A sign-in failed: ${a.error?.message}`);
    const b = await clientB.auth.signInWithPassword(userB);
    assert.ok(!b.error, `user B sign-in failed: ${b.error?.message}`);
  });

  after(async () => {
    // Cleanup: delete any rows created by user A.
    if (createdId) {
      await clientA.from('user_memories').delete().eq('id', createdId);
    }
    await clientA.auth.signOut();
    await clientB.auth.signOut();
  });

  test('user A inserts a memory; user B cannot see it', async () => {
    const insert = await clientA.from('user_memories').insert({
      category: 'custom',
      tier: 'X',
      fact: 'RLS isolation test — should not leak',
      source: 'explicit',
    }).select().single();

    assert.ok(!insert.error, `insert failed: ${insert.error?.message}`);
    createdId = insert.data.id;

    // User A sees it
    const selA = await clientA.from('user_memories').select('id').eq('id', createdId);
    assert.equal(selA.data.length, 1);

    // User B must NOT see it
    const selB = await clientB.from('user_memories').select('id').eq('id', createdId);
    assert.equal(selB.error, null);
    assert.equal(selB.data.length, 0, 'RLS leak: user B saw user A\'s memory');
  });

  test('user B cannot UPDATE user A\'s memory', async () => {
    assert.ok(createdId, 'prior test must have created a row');
    const upd = await clientB
      .from('user_memories')
      .update({ fact: 'hacked' })
      .eq('id', createdId);

    // RLS returns success with 0 rows affected (not an error, but no effect).
    // Confirm the row is unchanged from user A's view.
    const sel = await clientA.from('user_memories').select('fact').eq('id', createdId).single();
    assert.equal(sel.data.fact, 'RLS isolation test — should not leak');
  });
});
```

- [ ] **Step 3: Ensure TEST_USER_A/B creds exist in the test env**

Check `.env.local` (or wherever the test env lives) for `TEST_USER_A_EMAIL/PASSWORD` and `TEST_USER_B_EMAIL/PASSWORD`. If missing, provision two test users via the existing pattern (look at how other integration tests set up users — likely a one-line `createUser` helper or a seed script). If no pattern exists, add a top-of-file `before(async () => { ... create users via service-role ... })` block.

- [ ] **Step 4: Run the test**

```bash
npm run test:integration -- tests/integration/memory-rls-isolation.test.js 2>&1 | tail -20
```

Expected: 2 passing tests. If RLS fails (userB sees userA's row), the partial index and/or policy is misconfigured — re-verify Task 2 step 3.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/memory-rls-isolation.test.js
git commit -m "test(memory): RLS two-user isolation test

Gates the Phase 0 schema. Ensures user A's insert is invisible
to user B via both SELECT and UPDATE paths."
```

---

## Task 6 — Add `REMEMBER_FACT` tool definition

**Files:**
- Modify: `api/emersus/pipeline/tools.js`
- Modify: `tests/unit/api/emersus/pipeline/tools.test.js`

- [ ] **Step 1: Read current tools.js exports and structure**

```bash
grep -nE "^export|^const [A-Z_]+\s*=|SERVER_SIDE_TOOLS|TOOL_DEFINITIONS" api/emersus/pipeline/tools.js
```

Locate the block that defines `GET_USER_PROFILE` and the `TOOL_DEFINITIONS` export (around line 341 and 411 per prior search).

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/api/emersus/pipeline/tools.test.js`:

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { REMEMBER_FACT, buildToolDefinitions, SERVER_SIDE_TOOLS } from '../../../../../api/emersus/pipeline/tools.js';

describe('REMEMBER_FACT tool definition', () => {
  test('has strict:true and the right shape', () => {
    assert.equal(REMEMBER_FACT.type, 'function');
    assert.equal(REMEMBER_FACT.name, 'remember_fact');
    assert.equal(REMEMBER_FACT.strict, true);
    const p = REMEMBER_FACT.parameters;
    assert.equal(p.additionalProperties, false);
    assert.deepEqual(p.required.sort(), ['category', 'fact', 'note'].sort());
    assert.deepEqual(p.properties.note.type, ['string', 'null']);
    assert.ok(Array.isArray(p.properties.category.enum));
    assert.ok(p.properties.category.enum.includes('injury'));
    assert.ok(p.properties.category.enum.includes('custom'));
    assert.equal(p.properties.category.enum.length, 21); // 20 whitelist + custom
  });

  test('every whitelist category appears exactly once', () => {
    const set = new Set(REMEMBER_FACT.parameters.properties.category.enum);
    assert.equal(set.size, 21);
  });
});

describe('buildToolDefinitions — flag-gated remember_fact', () => {
  const saved = process.env.MEMORY_REMEMBER_FACT_ENABLED;
  test('excludes remember_fact when flag unset', () => {
    delete process.env.MEMORY_REMEMBER_FACT_ENABLED;
    const defs = buildToolDefinitions();
    assert.ok(!defs.some((d) => d.name === 'remember_fact'));
  });
  test('includes remember_fact when flag=true', () => {
    process.env.MEMORY_REMEMBER_FACT_ENABLED = 'true';
    const defs = buildToolDefinitions();
    assert.ok(defs.some((d) => d.name === 'remember_fact'));
  });
  test('SERVER_SIDE_TOOLS contains remember_fact regardless of flag', () => {
    // The set is a static export; the flag gates the definition emission,
    // not the server-side-resolution membership.
    assert.ok(SERVER_SIDE_TOOLS.has('remember_fact'));
  });
  if (saved === undefined) delete process.env.MEMORY_REMEMBER_FACT_ENABLED;
  else process.env.MEMORY_REMEMBER_FACT_ENABLED = saved;
});
```

- [ ] **Step 3: Run test — expected FAIL**

```bash
npm run test:unit -- tests/unit/api/emersus/pipeline/tools.test.js 2>&1 | tail -20
```

Expected: FAIL (`REMEMBER_FACT` not exported, `buildToolDefinitions` not exported).

- [ ] **Step 4: Modify tools.js**

Find the existing `TOOL_DEFINITIONS` export (~line 411). Replace that line and add the new tool definition + `buildToolDefinitions` function. The exact diff:

Before the existing `export const TOOL_DEFINITIONS = [...]`, add:

```javascript
// ── remember_fact (server-side tool) ────────────────────────────────────
//
// Flag-gated. When MEMORY_REMEMBER_FACT_ENABLED=true, the model can call
// this tool to save an explicit user-requested fact to user_memories.
// Server resolves in stream.js via resolveAndContinue; see spec §5.2.
const MEMORY_CATEGORY_ENUM = [
  'injury','allergy','medication','chronic_condition','pregnancy_status','biological_constraint',
  'goal','target_metric','dietary_protocol','schedule_pattern','coach_program',
  'personal_record','completed_event',
  'deload_window','illness_recovery','travel_constraint','sleep_deficit',
  'exercise_preference','supplement_stack','equipment_inventory',
  'custom',
];

export const REMEMBER_FACT = {
  type: 'function',
  name: 'remember_fact',
  description:
    "Save a fact the user explicitly asked to remember. Use ONLY when the user clearly signals save-intent (e.g., 'remember that…', 'note this for next time', 'make sure you know I…'). Do NOT infer save-intent — if the user didn't explicitly ask, don't call this. For facts that don't fit any whitelist category, use category='custom'.",
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: MEMORY_CATEGORY_ENUM },
      fact:     { type: 'string' },
      note:     { type: ['string', 'null'] },
    },
    required: ['category', 'fact', 'note'],
    additionalProperties: false,
  },
};
```

Replace the existing `TOOL_DEFINITIONS` export:

```javascript
// Static array of always-on tools. remember_fact is flag-gated — see
// buildToolDefinitions() below.
const BASE_TOOL_DEFINITIONS = [
  EMIT_MEAL_PLAN, EMIT_WORKOUT_PLAN, EMIT_WIDGET, LOG_FOOD, GET_USER_PROFILE,
];

export const TOOL_DEFINITIONS = BASE_TOOL_DEFINITIONS; // back-compat — prefer buildToolDefinitions()

// Build the tool list at request time so flags can toggle at runtime.
// Callers in synthesize.js/stream.js MUST switch from TOOL_DEFINITIONS to
// buildToolDefinitions() before Phase 1 ships.
export function buildToolDefinitions() {
  const defs = [...BASE_TOOL_DEFINITIONS];
  if (String(process.env.MEMORY_REMEMBER_FACT_ENABLED || '').toLowerCase() === 'true'
   || process.env.MEMORY_REMEMBER_FACT_ENABLED === '1') {
    defs.push(REMEMBER_FACT);
  }
  return defs;
}

export const SERVER_SIDE_TOOLS = new Set([
  'get_user_profile',
  'update_user_profile',
  'remember_fact',
]);
```

- [ ] **Step 5: Run test — expected PASS**

```bash
npm run test:unit -- tests/unit/api/emersus/pipeline/tools.test.js 2>&1 | tail -20
```

Expected: all tests green, including the previously existing ones.

- [ ] **Step 6: Commit**

```bash
git add api/emersus/pipeline/tools.js tests/unit/api/emersus/pipeline/tools.test.js
git commit -m "feat(memory): add REMEMBER_FACT tool definition (flag-gated)

Strict-mode schema with 21 categories. Flag-gated via buildToolDefinitions()
so prod default is unchanged until MEMORY_REMEMBER_FACT_ENABLED=true.
SERVER_SIDE_TOOLS includes 'remember_fact' unconditionally so the resolver
branch still fires if the flag flips mid-turn."
```

---

## Task 7 — Wire `buildToolDefinitions()` into synthesize.js

**Files:**
- Modify: `api/emersus/pipeline/synthesize.js`

The existing `TOOL_DEFINITIONS` static export is still re-exported for back-compat (Task 6), but synthesize.js needs to actually call `buildToolDefinitions()` for the flag to take effect.

- [ ] **Step 1: Find the current TOOL_DEFINITIONS usage in synthesize.js**

```bash
grep -nE "TOOL_DEFINITIONS|import.*tools" api/emersus/pipeline/synthesize.js
```

- [ ] **Step 2: Swap the static array for the function call**

Change the import to include `buildToolDefinitions` and replace the usage:

```javascript
// Before:
import { TOOL_DEFINITIONS } from "./tools.js";
// …
tools: TOOL_DEFINITIONS,

// After:
import { buildToolDefinitions } from "./tools.js";
// …
tools: buildToolDefinitions(),
```

Same swap anywhere else `TOOL_DEFINITIONS` is passed to OpenAI in the pipeline (search for `TOOL_DEFINITIONS` with `grep -rn TOOL_DEFINITIONS api/emersus/` and fix every call site that feeds OpenAI). The static export stays for non-pipeline callers (tests, etc.) but no chat request should use it after this task.

- [ ] **Step 3: Run the existing synthesize test to ensure nothing regresses**

```bash
npm run test:unit -- tests/unit/api/emersus/pipeline/synthesize.test.js 2>&1 | tail -20
```

Expected: no new failures.

- [ ] **Step 4: Commit**

```bash
git add api/emersus/pipeline/synthesize.js
git commit -m "refactor(memory): call buildToolDefinitions() in synthesize

Lets MEMORY_REMEMBER_FACT_ENABLED take effect at request time. Static
TOOL_DEFINITIONS export preserved for non-pipeline callers."
```

---

## Task 8 — Implement `resolveRememberFact` handler

**Files:**
- Modify: `api/emersus/pipeline/stream.js`
- Create: `tests/unit/api/emersus/pipeline/remember-fact-handler.test.js`

- [ ] **Step 1: Inspect the existing `resolveAndContinue` function**

Already located at `api/emersus/pipeline/stream.js:241`. The switch has two branches (`get_user_profile`, `update_user_profile`). We add a third.

- [ ] **Step 2: Write the failing test**

```javascript
// tests/unit/api/emersus/pipeline/remember-fact-handler.test.js
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRememberFact } from '../../../../../api/emersus/pipeline/remember-fact-handler.js';

// Simple in-memory fake of the Supabase insert chain for isolation.
function fakeSupabase(capture) {
  return {
    from(_table) {
      return {
        insert(row) {
          capture.insertedRows ??= [];
          capture.insertedRows.push(row);
          return {
            select() {
              return {
                single: async () => ({
                  data: { id: 'stub-uuid', ...row },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
}

describe('resolveRememberFact', () => {
  let capture;
  let sb;
  const ctx = { supabaseUserId: '00000000-0000-0000-0000-000000000001', threadId: 'thread-x', _openaiResponseId: 'resp-y' };

  beforeEach(() => {
    capture = {};
    sb = fakeSupabase(capture);
  });

  test('happy path: valid fact writes a confirmed explicit row', async () => {
    const out = await resolveRememberFact({
      args: { category: 'injury', fact: 'torn ACL left knee', note: null },
      ctx,
      supabase: sb,
    });
    assert.equal(out.saved, true);
    assert.equal(typeof out.id, 'string');
    assert.equal(out.echo, "Saved — I'll remember that across future chats.");
    assert.equal(capture.insertedRows.length, 1);
    const row = capture.insertedRows[0];
    assert.equal(row.user_id, ctx.supabaseUserId);
    assert.equal(row.category, 'injury');
    assert.equal(row.tier, 'A');
    assert.equal(row.status, 'confirmed');
    assert.equal(row.source, 'explicit');
    assert.equal(row.fact, 'torn ACL left knee');
    assert.equal(row.confidence, 1.00);
    assert.equal(row.source_thread_id, 'thread-x');
    assert.equal(row.source_turn_ref, 'resp-y');
  });

  test('custom category maps to tier X', async () => {
    await resolveRememberFact({
      args: { category: 'custom', fact: 'prefer evening sessions because I work in restaurants', note: null },
      ctx,
      supabase: sb,
    });
    assert.equal(capture.insertedRows[0].tier, 'X');
  });

  test('fact >500 chars rejected without DB call', async () => {
    const long = 'a'.repeat(501);
    const out = await resolveRememberFact({
      args: { category: 'custom', fact: long, note: null },
      ctx,
      supabase: sb,
    });
    assert.equal(out.saved, false);
    assert.match(out.error, /fact.*length/i);
    assert.equal(capture.insertedRows, undefined);
  });

  test('unknown category rejected', async () => {
    const out = await resolveRememberFact({
      args: { category: 'astrology_sign', fact: 'leo', note: null },
      ctx,
      supabase: sb,
    });
    assert.equal(out.saved, false);
    assert.match(out.error, /category/i);
  });

  test('missing supabaseUserId rejected (defensive)', async () => {
    const out = await resolveRememberFact({
      args: { category: 'injury', fact: 'torn ACL', note: null },
      ctx: { supabaseUserId: '' },
      supabase: sb,
    });
    assert.equal(out.saved, false);
    assert.match(out.error, /not_authenticated/i);
  });
});
```

- [ ] **Step 3: Run test — expected FAIL**

```bash
npm run test:unit -- tests/unit/api/emersus/pipeline/remember-fact-handler.test.js 2>&1 | tail -15
```

Expected: FAIL (module not found).

- [ ] **Step 4: Implement the handler in a new file**

```javascript
// api/emersus/pipeline/remember-fact-handler.js
// Resolves the remember_fact server-side tool call. Called from stream.js
// resolveAndContinue. Writes a confirmed-explicit row to user_memories.
// See spec §5.2.

const CATEGORY_TO_TIER = {
  injury: 'A', allergy: 'A', medication: 'A',
  chronic_condition: 'A', pregnancy_status: 'A', biological_constraint: 'A',
  goal: 'B', target_metric: 'B', dietary_protocol: 'B',
  schedule_pattern: 'B', coach_program: 'B',
  personal_record: 'C', completed_event: 'C',
  deload_window: 'D', illness_recovery: 'D', travel_constraint: 'D', sleep_deficit: 'D',
  exercise_preference: 'E', supplement_stack: 'E', equipment_inventory: 'E',
  custom: 'X',
};

const TIER_TTL_DAYS = { A: null, B: 120, C: null, D: 21, E: 180, X: null };

function computeExpiresAt(tier) {
  const d = TIER_TTL_DAYS[tier];
  if (!d) return null;
  const ts = new Date(Date.now() + d * 24 * 3600 * 1000);
  return ts.toISOString();
}

export async function resolveRememberFact({ args, ctx, supabase }) {
  const category = args?.category;
  const fact = args?.fact;
  const note = args?.note ?? null;

  if (!ctx?.supabaseUserId) {
    return { saved: false, error: 'not_authenticated' };
  }
  if (!category || !(category in CATEGORY_TO_TIER)) {
    return { saved: false, error: `unknown category: ${category}` };
  }
  if (typeof fact !== 'string' || fact.length < 1 || fact.length > 500) {
    return { saved: false, error: 'fact length must be 1..500 chars' };
  }

  const tier = CATEGORY_TO_TIER[category];
  const row = {
    user_id: ctx.supabaseUserId,
    category,
    tier,
    fact,
    source: 'explicit',
    source_thread_id: ctx.threadId || null,
    source_turn_ref: ctx._openaiResponseId || null,
    confidence: 1.00,
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
    expires_at: computeExpiresAt(tier),
    metadata: note ? { note } : {},
  };

  const { data, error } = await supabase
    .from('user_memories')
    .insert(row)
    .select()
    .single();

  if (error) {
    return { saved: false, error: error.message || 'insert_failed' };
  }
  return {
    saved: true,
    id: data.id,
    echo: "Saved — I'll remember that across future chats.",
  };
}
```

- [ ] **Step 5: Run test — expected PASS**

```bash
npm run test:unit -- tests/unit/api/emersus/pipeline/remember-fact-handler.test.js 2>&1 | tail -15
```

Expected: 5 passing tests.

- [ ] **Step 6: Wire the handler into stream.js resolveAndContinue**

In `api/emersus/pipeline/stream.js`, around line 244 (the existing `if (tc.name === "get_user_profile")` branch). Add a new branch AFTER the `update_user_profile` branch:

```javascript
} else if (tc.name === 'remember_fact') {
  // Lazy-import so the module isn't loaded when the flag is off / tool isn't called.
  const { resolveRememberFact } = await import('./remember-fact-handler.js');
  const { getSupabaseUserClient } = await import('../supabase-user-client.js'); // see note below
  const supabase = getSupabaseUserClient(ctx);
  const result = await resolveRememberFact({ args: tc.args, ctx, supabase });
  toolOutputs.push({
    type: 'function_call_output',
    call_id: tc.callId,
    output: JSON.stringify(result),
  });
}
```

Note on `getSupabaseUserClient`: this helper must return a Supabase client bound to the user's JWT (so RLS applies). If no such helper exists in the codebase, create `api/emersus/supabase-user-client.js`:

```javascript
// api/emersus/supabase-user-client.js
import { createClient } from '@supabase/supabase-js';

export function getSupabaseUserClient(ctx) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const jwt = ctx?.userJwt;
  if (!url || !anon) throw new Error('supabase_env_missing');
  if (!jwt) throw new Error('user_jwt_missing');
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

Before that file is created, verify whether an existing helper already exists:

```bash
grep -RnE "createClient.*SUPABASE_URL" api/ | head -10
```

If a pattern already exists (likely in `auth-middleware.js` or `rpc-proxy.js`), reuse that. `ctx.userJwt` must be set in `sanitize.js` — verify by grepping:

```bash
grep -n "userJwt\|user_jwt" api/emersus/pipeline/sanitize.js
```

If it isn't set, add a one-line copy in the sanitize stage from the request Authorization header.

- [ ] **Step 7: Commit**

```bash
git add api/emersus/pipeline/remember-fact-handler.js \
        api/emersus/pipeline/stream.js \
        tests/unit/api/emersus/pipeline/remember-fact-handler.test.js
# Only include supabase-user-client.js if it was newly created in this task:
[ -f api/emersus/supabase-user-client.js ] && git add api/emersus/supabase-user-client.js
git commit -m "feat(memory): resolveRememberFact handler + stream.js wiring

Writes explicit-save rows as status='confirmed', source='explicit',
tier derived from category, with per-tier TTL. Returns deterministic
echo string for the model to weave into its reply."
```

---

## Task 9 — Strict-mode pre-flight against prod model

**Files:**
- Create: `scripts/memory-strict-preflight.js`

Per spec §5.4 + memory `feedback_openai_strict_mode`: unit tests don't catch strict-mode violations. Must make one real API call.

- [ ] **Step 1: Write the pre-flight script**

```javascript
// scripts/memory-strict-preflight.js
// Spec §5.4 pre-flight. Makes a real OpenAI Responses API call per schema
// edge case. Exit 0 on all pass, 1 on any failure. Called before the first
// prod deploy that flips MEMORY_REMEMBER_FACT_ENABLED=true.

import { REMEMBER_FACT } from '../api/emersus/pipeline/tools.js';

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_EMERSUS_MODEL || 'gpt-4.1-mini';

if (!API_KEY) {
  console.error('OPENAI_API_KEY required');
  process.exit(1);
}

async function probe(name, userMessage) {
  console.log(`\n[probe] ${name}`);
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: 'user', content: userMessage }],
      tools: [REMEMBER_FACT],
      store: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`  FAIL: HTTP ${res.status}`);
    console.error(`  ${text.slice(0, 500)}`);
    return false;
  }
  console.log(`  PASS: HTTP ${res.status}`);
  return true;
}

const probes = [
  ['minimal',        'Remember that my left knee is the bad one.'],
  ['custom_category','Remember that I prefer evening sessions because I work in restaurants.'],
  ['note_populated', 'Remember that I take creatine 5g daily; started last month.'],
  ['no_save_intent', 'What\'s a good protein target for a 75 kg lifter?'], // expects NO tool call
];

let allPass = true;
for (const [name, msg] of probes) {
  const ok = await probe(name, msg);
  if (!ok) allPass = false;
}

process.exit(allPass ? 0 : 1);
```

- [ ] **Step 2: Add an npm script**

In `package.json` under `scripts`, add:

```json
"test:memory-preflight": "node scripts/memory-strict-preflight.js"
```

- [ ] **Step 3: Run the pre-flight**

```bash
OPENAI_EMERSUS_MODEL=$(ssh hetzner "grep OPENAI_EMERSUS_MODEL ~/app/.env | cut -d= -f2 | tr -d '\"'") \
OPENAI_API_KEY=$(ssh hetzner "grep ^OPENAI_API_KEY= ~/app/.env | cut -d= -f2 | tr -d '\"'") \
npm run test:memory-preflight 2>&1
```

⚠ This command pipes the prod API key through the local shell. Alternative: paste the key interactively into a local `.env.local` and run without the ssh exec. Either way, **do not commit or log the key**.

Expected: 4 probes, all PASS. If any FAIL with a 400, the schema has a strict-mode violation (most commonly a required field missing or an `additionalProperties: true` slipped in). Fix in `tools.js` before proceeding.

- [ ] **Step 4: Commit the script only (not the key)**

```bash
git add scripts/memory-strict-preflight.js package.json
git commit -m "test(memory): strict-mode pre-flight script for REMEMBER_FACT

Runs 4 probes against the real OpenAI Responses API to catch
strict-mode schema violations that unit tests miss. Per spec §5.4
and the 2026-04-16 update_user_profile incident retro."
```

---

## Task 10 — Deploy + enable `MEMORY_REMEMBER_FACT_ENABLED` in prod

**Files:** none (env var flip + deploy)

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

Hetzner webhook auto-deploys (git pull + npm install + npm run build + pm2 restart). Verify:

```bash
ssh hetzner "pm2 logs webhook --lines 30 --nostream 2>&1 | tail -25"
```

Expected to see: `git pull`, `npm install`, `✓ built in …ms`, `[PM2] ✓ emersus-api`, `[timestamp] deploy complete`.

- [ ] **Step 2: Confirm the flag is still OFF (deploy changes no behavior yet)**

```bash
ssh hetzner "grep -E '^MEMORY_' ~/app/.env"
```

Expected: empty or the three flags all commented / absent. If any are accidentally TRUE, STOP and fix before proceeding.

- [ ] **Step 3: Smoke test `get_user_profile` still works (regression check)**

Open `https://emersus.ai/app/`, ask a question that triggers profile use (e.g., "suggest a meal plan based on my goals"). Verify the response streams correctly and sources render. Confirms the tools.js refactor (Task 6/7) didn't break existing server-side-tool resolution.

- [ ] **Step 4: Flip the flag on prod**

```bash
ssh hetzner "cd ~/app && sed -i 's/^MEMORY_REMEMBER_FACT_ENABLED=.*/MEMORY_REMEMBER_FACT_ENABLED=true/' .env || echo 'MEMORY_REMEMBER_FACT_ENABLED=true' >> .env"
ssh hetzner "cd ~/app && grep MEMORY_REMEMBER_FACT_ENABLED .env"
ssh hetzner "pm2 restart emersus-api --update-env"
```

Per memory `reference_pm2_env_gotcha`: the emersus-api process uses `api/lib/load-env.js` which re-reads `~/app/.env`, so `--update-env` is sufficient. Verify:

```bash
ssh hetzner "pm2 logs emersus-api --lines 10 --nostream 2>&1 | tail -10"
```

- [ ] **Step 5: End-to-end prod smoke test**

In a browser signed in as your test account at `https://emersus.ai/app/`, start a new thread and send:

> *"Remember that my left knee is the bad one — torn ACL from 2022."*

Expected behavior:
- Assistant reply contains the deterministic echo: **"Saved — I'll remember that across future chats."**
- Response streams normally (no error state).

Then verify the DB row:

```bash
ssh hetzner "cd ~/app && docker compose exec -T supabase-db psql -U supabase_admin -d postgres -c \"
  select id, user_id, category, tier, fact, status, source, confidence
  from public.user_memories
  order by created_at desc
  limit 5;
\""
```

Expected: top row with `category='injury'`, `tier='A'`, `status='confirmed'`, `source='explicit'`, `confidence=1.00`, and the fact text roughly matching the input.

- [ ] **Step 6: If anything is wrong, flip the flag off**

```bash
ssh hetzner "cd ~/app && sed -i 's/^MEMORY_REMEMBER_FACT_ENABLED=.*/MEMORY_REMEMBER_FACT_ENABLED=false/' .env && pm2 restart emersus-api --update-env"
```

Investigate locally, push fix, re-enable.

- [ ] **Step 7: Document shipped state**

Append a one-liner to `changelog.md`:

```
- 2026-04-16 — Cross-thread memory Phase 0+1 — user_memories table (schema + RLS + HNSW) + remember_fact explicit-save tool shipped behind MEMORY_REMEMBER_FACT_ENABLED flag. Retrieval (Phase 2), recall_memory (Phase 3), UI tab (Phase 4), auto-extractor (Phase 5) still dark. — supabase/20260417_user_memories.sql, api/emersus/pipeline/{tools,stream,memory-flags,remember-fact-handler}.js, tests/unit/api/emersus/pipeline/{memory-flags,remember-fact-handler,tools}.test.js, tests/integration/memory-rls-isolation.test.js, scripts/memory-strict-preflight.js
```

(`.md` edits stay local per project convention — don't commit.)

---

## Self-review checklist

Run after all tasks complete.

- [ ] **Spec coverage.** Every requirement in spec §§4.1, 4.3, 5.2, 5.4, 9.4 (delete fn), 9.8 (kill switches), 10.2 Phase 0–1 is mapped to a task above. Retrieval (§6), UI (§7), extractor (§5.1), `recall_memory` (§5.3), TTL cron (§10.2 Phase 6) are all explicitly deferred to later plans — not gaps in this plan.
- [ ] **Placeholder scan.** No "TBD" or "figure out later". Every step has a concrete command or code block. One soft-dependency flagged: Task 8 Step 6 assumes `ctx.userJwt` exists in the pipeline context; if it doesn't, the step instructs the implementer to add a one-line copy in `sanitize.js`.
- [ ] **Type consistency.** `resolveRememberFact` parameter shape (`{args, ctx, supabase}`) matches the test fixture and the stream.js call site. `SERVER_SIDE_TOOLS` membership for `remember_fact` is consistent between Task 6 (add) and Task 8 (assumed, branch triggers only if present).
- [ ] **Rollback plan.** Task 10 Step 6 describes the flag-flip-off path. DB migration is forward-only but the table is feature-flagged — an abandoned Phase 0+1 leaves a dormant table + a dormant branch in `resolveAndContinue`, neither of which affects non-memory traffic.

---

## What comes next (NOT in this plan)

- **Phase 2 — Retrieval.** New `retrieve-memory.js` stage + `cross_thread_memory` prompt field + refresh-on-mention. Plan filename: `docs/superpowers/plans/2026-04-17-cross-thread-memory-phase-2.md`.
- **Phase 3 — `recall_memory` tool.** Mirrors this plan's structure for a third tool.
- **Phase 4 — Memory tab + chip UI.** Largest phase; warrants its own plan.
- **Phase 5 — Auto-extractor.** Highest-risk phase; own plan with extensive golden-set testing.
- **Phase 6 — Observability + TTL sweep.** Smallest phase; own plan.
