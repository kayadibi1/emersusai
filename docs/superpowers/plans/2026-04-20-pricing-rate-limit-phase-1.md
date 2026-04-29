# Pricing tiers & rate limit — Phase 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-user daily message cap (Free: 10/day, Pro: 100/day, UTC calendar reset) with a tier column on profiles, an atomic check-and-increment RPC, middleware on the chat endpoint, a fill-ring usage indicator under the composer, a cap-hit block UX, and a usage card in Profile. Everyone stays on `tier='free'` — Pro is populated by Phase 2 (Polar).

**Architecture:** Postgres-backed counter keyed by `(user_id, UTC day)`. Atomic UPSERT-then-rollback-if-over-limit RPC avoids races. Express middleware reads a 60s-cached tier, calls the RPC, returns 429 on block or sets `req.rateLimitInfo` on success. React composer mounts a `UsageRing` that polls `/api/emersus/usage`. 429 responses disable the composer and render an inline system message in the thread. No code touches the retrieval pipeline in Phase 1 — that's Phase 3.

**Tech Stack:** Self-hosted Supabase (Postgres 15 + pgvector) · Express 5 · React 18 via esm.sh · `node:test` + `node:assert/strict` · existing `api/emersus/auth-middleware.js` for JWT verification · existing `tests/_helpers/test-db.js` for integration tests.

**Scope:** Phase 1 only. Phase 2 (pricing page + Polar checkout + billing webhook) and Phase 3 (preprint gate via `match_evidence_chunks_v3`) are separate plans to be written after P1 ships. See `docs/superpowers/specs/2026-04-20-pricing-tiers-and-rate-limit-design.md` for the full spec.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `supabase/20260421_profile_tier_column.sql` | Add `tier` enum-text column to `profiles`. |
| `supabase/20260421_daily_message_counts.sql` | Counter table + `check_and_increment_message_count` plpgsql RPC. |
| `api/emersus/user-rate-limit.js` | `readTier`, `invalidateTier`, `userRateLimit()` middleware. |
| `api/emersus/usage.js` | `GET /api/emersus/usage` handler. |
| `shared/chat/rate-limit-copy.js` | Banner + inline message copy (Free + Pro variants). |
| `shared/chat/usage-ring.js` | `<UsageRing />` React component (SVG ring + popover). |
| `tests/integration/daily-message-counts-rpc.test.js` | Atomicity + reset semantics of the RPC. |
| `tests/unit/api/emersus/user-rate-limit.test.js` | Middleware + tier cache. |
| `tests/unit/api/emersus/usage.test.js` | Usage endpoint. |

### Modified files

| Path | Change |
|---|---|
| `server.js` | Mount `userRateLimit()` on `/api/emersus/recommendation`; mount `/api/emersus/usage`. |
| `shared/react-chat-app.js` | Mount `<UsageRing />` near the send button; handle 429 response; disable composer + inline system message on cap hit; refresh usage after each send. |
| `app/profile/profile.js` | Add Usage card (tier badge, larger ring, reset countdown, CTA). |

---

## Task 1: Migration — `profiles.tier` column

**Files:**
- Create: `supabase/20260421_profile_tier_column.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/20260421_profile_tier_column.sql
--
-- Adds the billing tier column used by the per-user rate-limit middleware
-- and (later) the Polar webhook. Binary enum for now: 'free' | 'pro'.
-- Existing rows default to 'free' so deployment is zero-downtime.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free'
  CHECK (tier IN ('free', 'pro'));

CREATE INDEX IF NOT EXISTS profiles_tier_idx ON public.profiles(tier);
```

- [ ] **Step 2: Apply to local/Hetzner Supabase**

Bash shell on Windows — pipe SQL through SSH (memory `feedback_migration_scp_conflict.md` — never `scp` tracked files):

```bash
cat supabase/20260421_profile_tier_column.sql | ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres"
```

Expected:

```
ALTER TABLE
CREATE INDEX
```

- [ ] **Step 3: Verify schema**

```bash
ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres -c \"\\d public.profiles\" | grep tier"
```

Expected output contains: `tier | text | ... default 'free'::text`.

- [ ] **Step 4: Commit**

```bash
git add supabase/20260421_profile_tier_column.sql
git commit -m "feat(db): add profiles.tier column for billing tiers"
```

---

## Task 2: Migration — `daily_message_counts` + atomic RPC

**Files:**
- Create: `supabase/20260421_daily_message_counts.sql`
- Create: `tests/integration/daily-message-counts-rpc.test.js`

- [ ] **Step 1: Write the failing integration test first**

```js
// tests/integration/daily-message-counts-rpc.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withTestClient, resetSchema } from "../_helpers/test-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(__dirname, "../../supabase/20260421_daily_message_counts.sql");

async function setup(client) {
  // Stub auth.users so the FK compiles. In real prod auth.users exists.
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);
  await client.query(readFileSync(MIGRATION, "utf8"));
}

test("check_and_increment: allows up to limit, blocks past it", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const { rows: [u] } = await client.query(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`);

    for (let i = 1; i <= 3; i++) {
      const { rows } = await client.query(
        `SELECT * FROM public.check_and_increment_message_count($1, 3)`,
        [u.id]
      );
      assert.equal(rows[0].allowed, true, `call ${i} should be allowed`);
      assert.equal(rows[0].new_count, i);
      assert.equal(rows[0].day_limit, 3);
    }

    const { rows } = await client.query(
      `SELECT * FROM public.check_and_increment_message_count($1, 3)`,
      [u.id]
    );
    assert.equal(rows[0].allowed, false, "4th call must be blocked");
    assert.equal(rows[0].new_count, 3, "counter rolled back to cap");

    const { rows: stored } = await client.query(
      `SELECT count FROM public.daily_message_counts WHERE user_id = $1`,
      [u.id]
    );
    assert.equal(stored[0].count, 3, "stored count capped at limit");
  });
});

test("check_and_increment: isolates by user", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const { rows: [a] } = await client.query(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`);
    const { rows: [b] } = await client.query(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`);
    for (let i = 0; i < 2; i++) {
      await client.query(`SELECT * FROM public.check_and_increment_message_count($1, 2)`, [a.id]);
    }
    const { rows } = await client.query(
      `SELECT * FROM public.check_and_increment_message_count($1, 2)`,
      [b.id]
    );
    assert.equal(rows[0].allowed, true);
    assert.equal(rows[0].new_count, 1);
  });
});

test("check_and_increment: returns reset_at as next-UTC-midnight", async () => {
  await resetSchema();
  await withTestClient(async (client) => {
    await setup(client);
    const { rows: [u] } = await client.query(`INSERT INTO auth.users DEFAULT VALUES RETURNING id`);
    const { rows } = await client.query(
      `SELECT * FROM public.check_and_increment_message_count($1, 10)`,
      [u.id]
    );
    const resetAt = new Date(rows[0].reset_at);
    const today = new Date();
    const expected = new Date(Date.UTC(
      today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1
    ));
    assert.equal(resetAt.toISOString(), expected.toISOString());
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm run test:integration -- --test-name-pattern="check_and_increment"
```

Expected: three failures (`relation "public.check_and_increment_message_count" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/20260421_daily_message_counts.sql
--
-- Per-user, per-UTC-day message counter. Powers the rate-limit middleware
-- on /api/emersus/recommendation. One row per (user_id, day) — rows stay
-- around for analytics; a cleanup job is a P1 follow-up.
--
-- The RPC is atomic: the INSERT...ON CONFLICT...RETURNING delivers the
-- post-increment count in one SQL statement, and if we overshot the cap
-- we immediately decrement. No read-then-write race window — two parallel
-- chat sends at count=N-1 can't both slip past.

CREATE TABLE IF NOT EXISTS public.daily_message_counts (
  user_id  uuid      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day      date      NOT NULL,
  count    integer   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- RLS: no client access. All reads/writes go through the service role.
ALTER TABLE public.daily_message_counts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_and_increment_message_count(
  p_user_id uuid,
  p_limit   integer
)
RETURNS TABLE(allowed boolean, new_count integer, day_limit integer, reset_at timestamptz)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_count integer;
BEGIN
  INSERT INTO public.daily_message_counts AS d (user_id, day, count)
    VALUES (p_user_id, v_today, 1)
    ON CONFLICT (user_id, day)
    DO UPDATE SET count = d.count + 1
    RETURNING d.count INTO v_count;

  IF v_count > p_limit THEN
    UPDATE public.daily_message_counts
       SET count = count - 1
     WHERE user_id = p_user_id AND day = v_today;
    RETURN QUERY SELECT false, v_count - 1, p_limit,
                        (v_today + interval '1 day')::timestamptz;
  ELSE
    RETURN QUERY SELECT true, v_count, p_limit,
                        (v_today + interval '1 day')::timestamptz;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_increment_message_count(uuid, integer)
  TO service_role;
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm run test:integration -- --test-name-pattern="check_and_increment"
```

Expected: three passing tests.

- [ ] **Step 5: Apply to Hetzner Supabase**

```bash
cat supabase/20260421_daily_message_counts.sql | ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres"
```

Expected:

```
CREATE TABLE
ALTER TABLE
CREATE FUNCTION
GRANT
```

- [ ] **Step 6: Commit**

```bash
git add supabase/20260421_daily_message_counts.sql tests/integration/daily-message-counts-rpc.test.js
git commit -m "feat(db): daily_message_counts table + atomic check-and-increment RPC"
```

---

## Task 3: Tier cache helpers — `readTier`, `invalidateTier`

**Files:**
- Create: `api/emersus/user-rate-limit.js`
- Create: `tests/unit/api/emersus/user-rate-limit.test.js`

- [ ] **Step 1: Write the failing test for tier cache**

```js
// tests/unit/api/emersus/user-rate-limit.test.js
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readTier, invalidateTier, _resetTierCacheForTests } from
  "../../../../api/emersus/user-rate-limit.js";

function stubSupabase(tier) {
  let calls = 0;
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            calls++;
            return { data: tier ? { tier } : null, error: null };
          },
        }),
      }),
    }),
    _calls: () => calls,
  };
}

describe("readTier", () => {
  beforeEach(() => _resetTierCacheForTests());

  test("returns 'free' when profile row missing", async () => {
    const db = stubSupabase(null);
    const t = await readTier("u-1", { supabase: db });
    assert.equal(t, "free");
  });

  test("returns the tier from the DB", async () => {
    const db = stubSupabase("pro");
    const t = await readTier("u-1", { supabase: db });
    assert.equal(t, "pro");
  });

  test("caches for 60s — second call does not hit DB", async () => {
    const db = stubSupabase("pro");
    await readTier("u-1", { supabase: db });
    await readTier("u-1", { supabase: db });
    assert.equal(db._calls(), 1, "only one DB call for two reads");
  });

  test("invalidateTier forces a refresh", async () => {
    const db = stubSupabase("pro");
    await readTier("u-1", { supabase: db });
    invalidateTier("u-1");
    await readTier("u-1", { supabase: db });
    assert.equal(db._calls(), 2);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm run test:unit -- --test-name-pattern="readTier"
```

Expected: module-not-found error (`api/emersus/user-rate-limit.js` does not exist).

- [ ] **Step 3: Create the module with tier cache**

```js
// api/emersus/user-rate-limit.js
//
// Per-user daily-message rate limit middleware for /api/emersus/recommendation.
// Two responsibilities:
//   1. Tier cache — Map<userId, {tier, expiresAt}>, 60s TTL. Reads
//      profiles.tier. Cached because we consult it on every chat send
//      and the tier only changes on Polar webhook (which calls
//      invalidateTier).
//   2. userRateLimit() middleware — calls the RPC atomically, returns
//      429 on block, sets req.rateLimitInfo otherwise.

import { supabaseAdmin } from "../lib/clients.js";

const TIER_TTL_MS = 60_000;
const tierCache = new Map();

export function _resetTierCacheForTests() {
  tierCache.clear();
}

export function invalidateTier(userId) {
  tierCache.delete(userId);
}

export async function readTier(userId, { supabase = supabaseAdmin } = {}) {
  const cached = tierCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.tier;

  const { data, error } = await supabase
    .from("profiles")
    .select("tier")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // Fail open to 'free' on lookup error. The RPC is still the
    // authoritative gate, and defaulting to the more restrictive tier
    // means a transient blip can't accidentally grant Pro.
    return "free";
  }

  const tier = data?.tier ?? "free";
  tierCache.set(userId, { tier, expiresAt: Date.now() + TIER_TTL_MS });
  return tier;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm run test:unit -- --test-name-pattern="readTier"
```

Expected: four passing tests.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/user-rate-limit.js tests/unit/api/emersus/user-rate-limit.test.js
git commit -m "feat(rate-limit): tier cache helpers (readTier, invalidateTier)"
```

---

## Task 4: `userRateLimit()` middleware

**Files:**
- Modify: `api/emersus/user-rate-limit.js`
- Modify: `tests/unit/api/emersus/user-rate-limit.test.js`

- [ ] **Step 1: Add failing middleware tests**

Append to `tests/unit/api/emersus/user-rate-limit.test.js`:

```js
import { userRateLimit } from "../../../../api/emersus/user-rate-limit.js";

function stubSupabaseWithRpc({ tier, rpc }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { tier }, error: null }),
        }),
      }),
    }),
    rpc: async (_name, _args) => rpc,
  };
}

function mockReqRes(userId = "u-42") {
  const headers = {};
  const res = {
    _status: 200,
    _body: null,
    setHeader: (k, v) => { headers[k] = String(v); },
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  const req = { verifiedUserId: userId, headers: {} };
  return { req, res, headers };
}

describe("userRateLimit middleware", () => {
  beforeEach(() => _resetTierCacheForTests());

  test("allows under the cap; sets headers + rateLimitInfo", async () => {
    const db = stubSupabaseWithRpc({
      tier: "free",
      rpc: { data: [{ allowed: true, new_count: 3, day_limit: 10,
                      reset_at: "2026-04-21T00:00:00Z" }], error: null },
    });
    const mw = userRateLimit({ supabase: db });
    const { req, res, headers } = mockReqRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.rateLimitInfo.tier, "free");
    assert.equal(req.rateLimitInfo.used, 3);
    assert.equal(req.rateLimitInfo.limit, 10);
    assert.equal(headers["X-RateLimit-Limit"], "10");
    assert.equal(headers["X-RateLimit-Remaining"], "7");
  });

  test("blocks at the cap with 429 + upgrade_url for Free", async () => {
    const db = stubSupabaseWithRpc({
      tier: "free",
      rpc: { data: [{ allowed: false, new_count: 10, day_limit: 10,
                      reset_at: "2026-04-21T00:00:00Z" }], error: null },
    });
    const mw = userRateLimit({ supabase: db });
    const { req, res } = mockReqRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res._status, 429);
    assert.equal(res._body.error, "daily_limit_reached");
    assert.equal(res._body.tier, "free");
    assert.equal(res._body.upgrade_url, "/pricing");
  });

  test("blocks Pro with null upgrade_url", async () => {
    const db = stubSupabaseWithRpc({
      tier: "pro",
      rpc: { data: [{ allowed: false, new_count: 100, day_limit: 100,
                      reset_at: "2026-04-21T00:00:00Z" }], error: null },
    });
    const mw = userRateLimit({ supabase: db });
    const { req, res } = mockReqRes();
    await mw(req, res, () => {});
    assert.equal(res._status, 429);
    assert.equal(res._body.upgrade_url, null);
  });

  test("fails open on RPC error — calls next, flags bypassed", async () => {
    const db = stubSupabaseWithRpc({
      tier: "free",
      rpc: { data: null, error: { message: "connection reset" } },
    });
    const mw = userRateLimit({ supabase: db });
    const { req, res } = mockReqRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.rateLimitInfo.bypassed, true);
    assert.equal(res._status, 200);
  });

  test("401 when req.verifiedUserId missing", async () => {
    const db = stubSupabaseWithRpc({
      tier: "free",
      rpc: { data: [{ allowed: true }], error: null },
    });
    const mw = userRateLimit({ supabase: db });
    const { res } = mockReqRes();
    const req = { verifiedUserId: null, headers: {} };
    await mw(req, res, () => {});
    assert.equal(res._status, 401);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm run test:unit -- --test-name-pattern="userRateLimit middleware"
```

Expected: five failures (`userRateLimit is not a function`).

- [ ] **Step 3: Implement the middleware**

Append to `api/emersus/user-rate-limit.js`:

```js
export function userRateLimit({ supabase = supabaseAdmin } = {}) {
  return async (req, res, next) => {
    const userId = req.verifiedUserId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const tier = await readTier(userId, { supabase });
    const limit = tier === "pro" ? 100 : 10;

    const { data, error } = await supabase.rpc(
      "check_and_increment_message_count",
      { p_user_id: userId, p_limit: limit }
    );

    if (error) {
      // Fail open: chat stays online if the DB blips. The IP-based
      // limiter in rate-limit.js still protects the public surface.
      console.error("[user-rate-limit] RPC error:", error.message || error);
      req.rateLimitInfo = { tier, used: null, limit, resetAt: null, bypassed: true };
      return next();
    }

    const row = Array.isArray(data) ? data[0] : data;
    const resetAtIso = new Date(row.reset_at).toISOString();
    req.rateLimitInfo = {
      tier,
      used: row.new_count,
      limit: row.day_limit,
      resetAt: resetAtIso,
      allowed: row.allowed,
    };

    res.setHeader("X-RateLimit-Limit", row.day_limit);
    res.setHeader("X-RateLimit-Remaining", Math.max(row.day_limit - row.new_count, 0));
    res.setHeader("X-RateLimit-Reset", Math.ceil(new Date(row.reset_at).getTime() / 1000));

    if (!row.allowed) {
      return res.status(429).json({
        error: "daily_limit_reached",
        tier,
        count: row.new_count,
        limit: row.day_limit,
        reset_at: resetAtIso,
        upgrade_url: tier === "free" ? "/pricing" : null,
      });
    }

    next();
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm run test:unit -- --test-name-pattern="userRateLimit middleware"
```

Expected: five passing tests.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/user-rate-limit.js tests/unit/api/emersus/user-rate-limit.test.js
git commit -m "feat(rate-limit): userRateLimit middleware with 429 + fail-open"
```

---

## Task 5: Wire middleware into the chat route

**Files:**
- Modify: `server.js` (add import + middleware on `/api/emersus/recommendation`)

- [ ] **Step 1: Add the import**

Open `server.js` and find the existing import block around the existing rate-limit import:

```js
import { publicRateLimitMiddleware } from "./api/emersus/rate-limit.js";
```

Add directly below it:

```js
import { userRateLimit } from "./api/emersus/user-rate-limit.js";
```

- [ ] **Step 2: Mount the middleware**

Find the route registration (around `server.js:95`):

```js
app.post("/api/emersus/recommendation", requireAuth, recommendationHandler);
```

Replace with:

```js
app.post("/api/emersus/recommendation", requireAuth, userRateLimit(), recommendationHandler);
```

Order is critical: `requireAuth` populates `req.verifiedUserId`, which `userRateLimit()` reads.

- [ ] **Step 3: Smoke test locally**

```bash
npm run dev
```

In another terminal, authenticate and hit the endpoint a few times (or manually: send a chat message in the browser against local dev). Expected: `X-RateLimit-Limit: 10` and `X-RateLimit-Remaining` decrementing on each request. Check `daily_message_counts` on Hetzner Supabase:

```bash
ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres -c 'SELECT * FROM daily_message_counts;'"
```

Expected: one row per user who sent a message today.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(chat): enforce per-user daily rate limit on /recommendation"
```

---

## Task 6: `GET /api/emersus/usage` endpoint

**Files:**
- Create: `api/emersus/usage.js`
- Create: `tests/unit/api/emersus/usage.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/api/emersus/usage.test.js
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { usageHandler } from "../../../../api/emersus/usage.js";
import { _resetTierCacheForTests } from "../../../../api/emersus/user-rate-limit.js";

function mockRes() {
  return {
    _status: 200,
    _body: null,
    status(c) { this._status = c; return this; },
    json(b) { this._body = b; return this; },
  };
}

function stubSupabase({ tier, count }) {
  return {
    from: (table) => ({
      select: () => ({
        eq: (col, val) => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === "daily_message_counts" ? (count != null ? { count } : null) : { tier },
              error: null,
            }),
          }),
          maybeSingle: async () => ({
            data: table === "profiles" ? { tier } : null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

describe("GET /api/emersus/usage", () => {
  beforeEach(() => _resetTierCacheForTests());

  test("no row today → used=0, limit=10 for free tier", async () => {
    const req = { verifiedUserId: "u-1" };
    const res = mockRes();
    await usageHandler(req, res, { supabase: stubSupabase({ tier: "free", count: null }) });
    assert.equal(res._status, 200);
    assert.equal(res._body.tier, "free");
    assert.equal(res._body.used, 0);
    assert.equal(res._body.limit, 10);
    assert.ok(res._body.reset_at.endsWith("T00:00:00.000Z"));
  });

  test("pro tier → limit=100", async () => {
    const req = { verifiedUserId: "u-2" };
    const res = mockRes();
    await usageHandler(req, res, { supabase: stubSupabase({ tier: "pro", count: 42 }) });
    assert.equal(res._body.tier, "pro");
    assert.equal(res._body.used, 42);
    assert.equal(res._body.limit, 100);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm run test:unit -- --test-name-pattern="GET /api/emersus/usage"
```

Expected: module-not-found.

- [ ] **Step 3: Implement the handler**

```js
// api/emersus/usage.js
//
// GET /api/emersus/usage — returns {tier, used, limit, reset_at}.
// Powers the UsageRing below the chat composer and the Usage card in
// /app/profile/. Cheap — one SELECT on daily_message_counts plus the
// tier-cache lookup in readTier().

import { supabaseAdmin } from "../lib/clients.js";
import { readTier } from "./user-rate-limit.js";

function nextUtcMidnightIso() {
  const d = new Date();
  const next = new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1
  ));
  return next.toISOString();
}

function utcTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function usageHandler(req, res, { supabase = supabaseAdmin } = {}) {
  const userId = req.verifiedUserId;
  if (!userId) return res.status(401).json({ error: "Authentication required." });

  const tier = await readTier(userId, { supabase });
  const limit = tier === "pro" ? 100 : 10;

  const { data } = await supabase
    .from("daily_message_counts")
    .select("count")
    .eq("user_id", userId)
    .eq("day", utcTodayIso())
    .maybeSingle();

  const used = data?.count ?? 0;
  res.json({ tier, used, limit, reset_at: nextUtcMidnightIso() });
}

export default usageHandler;
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm run test:unit -- --test-name-pattern="GET /api/emersus/usage"
```

Expected: two passing tests.

- [ ] **Step 5: Commit**

```bash
git add api/emersus/usage.js tests/unit/api/emersus/usage.test.js
git commit -m "feat(chat): GET /api/emersus/usage for UsageRing + Profile card"
```

---

## Task 7: Mount the usage endpoint

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add import**

Below the existing recommendation handler import (around `server.js:55`), add:

```js
const { default: usageHandler } = await import("./api/emersus/usage.js");
```

- [ ] **Step 2: Mount the route**

Near the existing `app.post("/api/emersus/recommendation", ...)` registration, add:

```js
app.get("/api/emersus/usage", requireAuth, usageHandler);
```

- [ ] **Step 3: Verify**

```bash
npm run dev
```

Then from a signed-in browser session:

```js
fetch('/api/emersus/usage', { headers: { Authorization: `Bearer ${supabase.auth.getSession().data.session.access_token}` } }).then(r => r.json()).then(console.log)
```

Expected: `{tier: "free", used: N, limit: 10, reset_at: "..."}`.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(chat): mount /api/emersus/usage route"
```

---

## Task 8: Rate-limit copy module

**Files:**
- Create: `shared/chat/rate-limit-copy.js`

- [ ] **Step 1: Create the copy module**

```js
// shared/chat/rate-limit-copy.js
//
// Centralized user-facing copy for the rate-limit surface. Two variants —
// free and pro — for the banner, the inline system message in the chat
// thread, and the UsageRing popover. Kept in one file so product tweaks
// don't require editing React components.

export function formatResetCountdown(resetAtIso) {
  const reset = new Date(resetAtIso).getTime();
  const now = Date.now();
  const ms = Math.max(reset - now, 0);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export const COPY = {
  free: {
    bannerTitle: "You've hit today's message limit.",
    bannerBody: (resetAtIso) =>
      `Resets in ${formatResetCountdown(resetAtIso)} (00:00 UTC). Upgrade to Pro for 100 messages per day and preprint access.`,
    bannerCta: { label: "Upgrade to Pro →", href: "/pricing" },
    inlineMessage: "Daily message limit reached (10/day on Free). The composer unlocks at midnight UTC, or upgrade to Pro for 10× the room.",
    placeholder: "Daily limit reached — resets at midnight UTC.",
    ringPopoverTitle: (used, limit) => `${used} of ${limit} free messages used today`,
    ringPopoverBody: (resetAtIso) => `Resets in ${formatResetCountdown(resetAtIso)}.`,
    ringPopoverCta: { label: "Upgrade →", href: "/pricing" },
  },
  pro: {
    bannerTitle: "You've hit today's Pro limit.",
    bannerBody: (resetAtIso) =>
      `You've sent 100 messages today. Resets in ${formatResetCountdown(resetAtIso)} (00:00 UTC).`,
    bannerCta: { label: "See usage", href: "/app/profile#usage" },
    inlineMessage: "Daily message limit reached (100/day on Pro). The composer unlocks at midnight UTC.",
    placeholder: "Daily limit reached — resets at midnight UTC.",
    ringPopoverTitle: (used, limit) => `${used} of ${limit} Pro messages used today`,
    ringPopoverBody: (resetAtIso) => `Resets in ${formatResetCountdown(resetAtIso)}.`,
    ringPopoverCta: { label: "Manage billing", href: "/app/profile#usage" },
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add shared/chat/rate-limit-copy.js
git commit -m "feat(chat): rate-limit copy module (free + pro variants)"
```

---

## Task 9: `<UsageRing />` React component

**Files:**
- Create: `shared/chat/usage-ring.js`

- [ ] **Step 1: Build the component**

```js
// shared/chat/usage-ring.js
//
// SVG progress ring shown next to the send button. Polls /api/emersus/usage
// on mount, exposes an optimistic bump via ref (parent calls bump() right
// after a successful send so the UI doesn't lag the actual count). Click
// opens a popover anchored below.

import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { COPY } from "./rate-limit-copy.js";

const RING_SIZE = 22;
const RING_RADIUS = 9;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

function ringColor(pct) {
  if (pct >= 1) return "var(--danger)";
  if (pct >= 0.8) return "var(--warning)";
  return "var(--accent)";
}

async function fetchUsage(getToken) {
  const token = await getToken();
  if (!token) return null;
  const res = await fetch("/api/emersus/usage", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export const UsageRing = forwardRef(function UsageRing({ getToken }, ref) {
  const [state, setState] = useState(null); // {tier, used, limit, reset_at}
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wrapRef = useRef(null);

  useImperativeHandle(ref, () => ({
    bump() {
      setState((s) => (s ? { ...s, used: Math.min(s.used + 1, s.limit) } : s));
    },
    refresh() {
      fetchUsage(getToken).then((d) => d && setState(d));
    },
    state,
  }), [state]);

  useEffect(() => {
    fetchUsage(getToken).then((d) => d && setState(d));
  }, [getToken]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [popoverOpen]);

  if (!state) return null;

  const pct = Math.min(state.used / state.limit, 1);
  const dashOffset = RING_CIRC * (1 - pct);
  const color = ringColor(pct);
  const copy = COPY[state.tier] || COPY.free;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        onClick={() => setPopoverOpen((v) => !v)}
        aria-label={copy.ringPopoverTitle(state.used, state.limit)}
        style={{
          width: RING_SIZE, height: RING_SIZE,
          background: "transparent", border: "none", padding: 0, cursor: "pointer",
          position: "relative",
        }}
      >
        <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
          <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
                  fill="none" stroke="var(--line)" strokeWidth="2" />
          <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
                  fill="none" stroke={color} strokeWidth="2"
                  strokeDasharray={RING_CIRC} strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`} />
        </svg>
        <span className="mono nums" style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, color: "var(--muted)", pointerEvents: "none",
        }}>
          {state.used}
        </span>
      </button>

      {popoverOpen && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0,
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: 10, padding: "12px 14px", minWidth: 220,
          boxShadow: "0 8px 32px -8px rgba(0,0,0,0.24)", zIndex: 20,
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
            {copy.ringPopoverTitle(state.used, state.limit)}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            {copy.ringPopoverBody(state.reset_at)}
          </div>
          <a href={copy.ringPopoverCta.href} style={{
            display: "inline-block", fontSize: 12, fontWeight: 600,
            color: "var(--accent)", textDecoration: "none",
          }}>{copy.ringPopoverCta.label}</a>
        </div>
      )}
    </div>
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add shared/chat/usage-ring.js
git commit -m "feat(chat): UsageRing component — SVG ring + popover"
```

---

## Task 10: Integrate `<UsageRing />` into the composer + refresh on send

**Files:**
- Modify: `shared/react-chat-app.js`

- [ ] **Step 1: Import the ring**

At the top of `shared/react-chat-app.js`, add:

```js
import { UsageRing } from "./chat/usage-ring.js";
```

- [ ] **Step 2: Add a ring ref in the main chat component**

In the component body near existing refs:

```js
const usageRingRef = useRef(null);
```

- [ ] **Step 3: Render the ring next to the send button**

Locate the composer JSX with the send button (search for "send" or an Lucide `ArrowUp` usage). Place the ring immediately before the send button's wrapping element:

```jsx
<UsageRing
  ref={usageRingRef}
  getToken={async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  }}
/>
```

Wrap the ring + send button in a flex container with 8px gap if they aren't already in one.

- [ ] **Step 4: Bump the ring after a successful send**

Find the existing send handler that POSTs to `/api/emersus/recommendation`. On a successful response (HTTP 2xx), call:

```js
usageRingRef.current?.bump();
```

On a 429 response, call `refresh()` so the ring reflects the server-authoritative count:

```js
usageRingRef.current?.refresh();
```

- [ ] **Step 5: Smoke test**

Send a message in the browser. The ring should decrement from the default-state. Verify the popover opens on click and shows the right tier copy.

- [ ] **Step 6: Commit**

```bash
git add shared/react-chat-app.js
git commit -m "feat(chat): mount UsageRing in composer + bump on send"
```

---

## Task 11: Cap-hit UX — composer disable + inline system message

**Files:**
- Modify: `shared/react-chat-app.js`

- [ ] **Step 1: Add state for the rate-limit block**

In the main chat component:

```js
const [rateLimitBlock, setRateLimitBlock] = useState(null);
// shape: { tier, limit, reset_at } | null
```

- [ ] **Step 2: Detect and store 429 responses**

In the send handler, when the POST returns status 429, parse the JSON and set the block state; also append an inline system message to the thread. Replace the existing error branch for the send call with:

```js
if (res.status === 429) {
  const body = await res.json().catch(() => ({}));
  setRateLimitBlock({
    tier: body.tier ?? "free",
    limit: body.limit ?? 10,
    reset_at: body.reset_at,
  });
  // Append a system turn so it shows in scrollback
  const copy = (await import("./chat/rate-limit-copy.js")).COPY;
  appendSystemMessage(copy[body.tier ?? "free"].inlineMessage);
  usageRingRef.current?.refresh();
  return;
}
```

Where `appendSystemMessage` reuses whatever pattern this file already has for surfacing non-user, non-assistant turns (search `role: "system"` — there should already be one).

- [ ] **Step 3: Disable the composer when blocked**

On the composer's `<textarea>` / input, set `disabled={!!rateLimitBlock}`. On the send button: `disabled={!!rateLimitBlock || ...existing conditions}`. On the placeholder:

```js
placeholder={rateLimitBlock
  ? (await import("./chat/rate-limit-copy.js")).COPY[rateLimitBlock.tier].placeholder
  : existingPlaceholder}
```

*(Use a top-of-file static import for the copy module instead of dynamic imports — dynamic imports inside render are an anti-pattern. Hoist:)*

```js
import { COPY } from "./chat/rate-limit-copy.js";
```

...then `COPY[rateLimitBlock.tier].placeholder`.

- [ ] **Step 4: Render the banner above the composer**

```jsx
{rateLimitBlock && (
  <div style={{
    margin: "0 0 12px", padding: "10px 14px",
    background: "var(--accent-soft)",
    border: "1px solid var(--accent-line)",
    borderRadius: 10, display: "flex", alignItems: "center", gap: 12,
    fontSize: 13,
  }}>
    <div style={{ flex: 1 }}>
      <strong style={{ color: "var(--ink)" }}>
        {COPY[rateLimitBlock.tier].bannerTitle}
      </strong>
      <span style={{ color: "var(--muted)", marginLeft: 6 }}>
        {COPY[rateLimitBlock.tier].bannerBody(rateLimitBlock.reset_at)}
      </span>
    </div>
    <a href={COPY[rateLimitBlock.tier].bannerCta.href} style={{
      background: "var(--accent)", color: "var(--accent-text)",
      padding: "6px 12px", borderRadius: 8,
      fontSize: 12, fontWeight: 600, textDecoration: "none",
      whiteSpace: "nowrap",
    }}>
      {COPY[rateLimitBlock.tier].bannerCta.label}
    </a>
  </div>
)}
```

- [ ] **Step 5: Auto-unblock at reset**

In a `useEffect`, when `rateLimitBlock` is set, schedule a timeout to clear it at `reset_at`:

```js
useEffect(() => {
  if (!rateLimitBlock) return;
  const ms = new Date(rateLimitBlock.reset_at).getTime() - Date.now();
  if (ms <= 0) { setRateLimitBlock(null); return; }
  const t = setTimeout(() => {
    setRateLimitBlock(null);
    usageRingRef.current?.refresh();
  }, ms + 1000);
  return () => clearTimeout(t);
}, [rateLimitBlock]);
```

- [ ] **Step 6: Smoke test cap-hit flow**

1. Temporarily apply `EMERSUS_USER_RATE_LIMIT_TEST_CAP=3` (not implemented — skip, or) manually set tier='free' and repeatedly send 10 messages:

```bash
ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres -c \"UPDATE daily_message_counts SET count = 10 WHERE user_id = '<your-uuid>' AND day = CURRENT_DATE;\""
```

2. Send one more message. Composer should disable, banner + inline system message should render, ring should turn red and read 10/10.
3. Reset manually to verify the composer re-enables:

```bash
ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres -c \"DELETE FROM daily_message_counts WHERE user_id = '<your-uuid>';\""
```

Refresh the page; composer should work again.

- [ ] **Step 7: Commit**

```bash
git add shared/react-chat-app.js
git commit -m "feat(chat): cap-hit UX — composer disable + banner + inline system message"
```

---

## Task 12: Profile Usage card

**Files:**
- Modify: `app/profile/profile.js`

- [ ] **Step 1: Import and add the ring (reused component)**

At the top of `app/profile/profile.js`:

```js
import { UsageRing } from "../../shared/chat/usage-ring.js";
import { COPY, formatResetCountdown } from "../../shared/chat/rate-limit-copy.js";
```

- [ ] **Step 2: Add a `UsageCard` component**

Define near the top of the file:

```jsx
function UsageCard({ supabase }) {
  const [usage, setUsage] = useState(null);
  const ringRef = useRef(null);

  useEffect(() => {
    (async () => {
      const token = (await supabase.auth.getSession()).data?.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/emersus/usage", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setUsage(await res.json());
    })();
  }, []);

  if (!usage) return null;

  const tierLabel = usage.tier === "pro" ? "Pro" : "Free";
  const tierPillStyle = {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 999,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    fontWeight: 600,
    background: usage.tier === "pro" ? "var(--accent)" : "var(--surface-faint)",
    color: usage.tier === "pro" ? "var(--accent-text)" : "var(--muted)",
    border: usage.tier === "pro" ? "none" : "1px solid var(--line)",
  };

  return (
    <section id="usage" style={{
      border: "1px solid var(--line)", borderRadius: 14,
      padding: 24, background: "var(--surface)", marginBottom: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Usage</h2>
        <span style={tierPillStyle}>{tierLabel}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <UsageRing ref={ringRef} getToken={async () =>
          (await supabase.auth.getSession()).data?.session?.access_token ?? null
        } />
        <div>
          <div style={{ fontSize: 15, color: "var(--ink)" }}>
            <strong>{usage.used}</strong>
            <span style={{ color: "var(--muted)" }}> / {usage.limit} messages today</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
            Resets in {formatResetCountdown(usage.reset_at)} · 00:00 UTC
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          {usage.tier === "free" ? (
            <a href="/pricing" style={{
              background: "var(--accent)", color: "var(--accent-text)",
              padding: "8px 14px", borderRadius: 8, fontWeight: 600,
              fontSize: 13, textDecoration: "none",
            }}>Upgrade to Pro →</a>
          ) : (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Billing manager lands in Phase 2
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Render `<UsageCard />` in the profile layout**

Find the existing layout in `app/profile/profile.js` where account cards are rendered in sequence. Insert `<UsageCard supabase={supabase} />` between the Account section and the Memory section (or at the top if the sequence is different — place it above the Memory card either way). Pass the existing `supabase` client prop/context from the surrounding component.

- [ ] **Step 4: Smoke test**

Navigate to `/app/profile/`. Expected: new Usage card renders with "Free" pill, the ring, `N / 10 messages today`, a reset countdown, and the Upgrade CTA. Click the ring — popover should open.

- [ ] **Step 5: Commit**

```bash
git add app/profile/profile.js
git commit -m "feat(profile): Usage card with tier pill, ring, reset countdown"
```

---

## Task 13: End-to-end smoke test on local/prod

**Files:** none — verification only.

- [ ] **Step 1: Unit + integration test sweep**

```bash
npm test
```

Expected: zero failures. If new tests fail, fix before deploying.

- [ ] **Step 2: Local full-flow smoke**

1. Sign up a fresh test user (or use an existing one with `tier='free'`).
2. Confirm the Profile Usage card reads `0 / 10 messages today` on first visit.
3. Send one message in chat; ring moves to `1`, card updates on refresh.
4. Manually set the counter to 10:

   ```bash
   ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres -c \"INSERT INTO daily_message_counts (user_id, day, count) VALUES ('<uuid>', CURRENT_DATE, 10) ON CONFLICT (user_id, day) DO UPDATE SET count = 10;\""
   ```

5. Try to send another message. Expected: 429, banner renders, inline system message appears in thread, composer disables.
6. Reset: `DELETE FROM daily_message_counts WHERE user_id = '<uuid>'`. Refresh. Composer re-enables, ring resets.
7. Test Pro path:

   ```bash
   ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres -c \"UPDATE profiles SET tier = 'pro' WHERE id = '<uuid>';\""
   ```

   Wait up to 60s for cache TTL (or restart the dev server). Confirm `/api/emersus/usage` now returns `tier: "pro", limit: 100`, ring shows `/100`. Flip back to `'free'` when done.

- [ ] **Step 3: Confirm no regressions in existing rate limit**

The IP-based limiter in `api/emersus/rate-limit.js` should still protect public endpoints. Verify the `/api/emersus/contact` or `/api/emersus/check-email` still returns 429 after ~10 rapid hits.

- [ ] **Step 4: No commit — proceed to deploy**

---

## Task 14: Deploy to production

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

This triggers the webhook on Hetzner (memory `reference_hetzner_deploy_build.md`): auto `git pull && npm install && npm run build && pm2 restart emersus-api`.

- [ ] **Step 2: Verify deploy completed**

```bash
ssh hetzner "pm2 logs webhook --lines 40 --nostream"
```

Expected: a recent log group ending in `✓ deploy complete`.

```bash
ssh hetzner "pm2 logs emersus-api --lines 20 --nostream"
```

Expected: recent restart + no error spam.

- [ ] **Step 3: Verify migrations were applied**

Both migrations (`20260421_profile_tier_column.sql`, `20260421_daily_message_counts.sql`) should already have been applied in Tasks 1 & 2. Re-verify:

```bash
ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres -c \"SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='tier';\""

ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres -c \"SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name='check_and_increment_message_count';\""
```

Both should return one row.

- [ ] **Step 4: Post-deploy production smoke**

Hit `https://emersus.ai/app/profile/` signed in as any user. Expected: Usage card visible, ring renders, `/api/emersus/usage` returns 200. Send a few chat messages, watch ring tick up.

- [ ] **Step 5: Update Notion session log**

Per memory `reference_notion_session_log.md`, append a checkpoint entry to the parent page `345168c5-6323-8197-a517-d227e550d9e1` summarizing: migrations applied, files touched, live URL, follow-ups (Phase 2).

- [ ] **Step 6: Update memory**

Write a project memory file at `C:\Users\Sidar\.claude\projects\C--Users-Sidar-Desktop-emersus\memory\project_pricing_rate_limit_phase1.md`:

```md
---
name: Pricing rate limit Phase 1 shipped
description: Free/Pro daily cap live in prod; tier column on profiles; Polar (Phase 2) pending
type: project
---

Phase 1 of the pricing / rate-limit spec (docs/superpowers/specs/2026-04-20-pricing-tiers-and-rate-limit-design.md) deployed 2026-04-20:
- `profiles.tier` column with `'free' | 'pro'` CHECK, default `'free'`
- `daily_message_counts` table + `check_and_increment_message_count` RPC (atomic)
- `api/emersus/user-rate-limit.js` middleware mounted on `/api/emersus/recommendation`
- `GET /api/emersus/usage` endpoint
- `<UsageRing />` in chat composer + Profile Usage card
- 429 + banner + inline system message on cap hit

**Why:** ship economic protection before payments go live. Everyone still on `tier='free'`.
**How to apply:** Phase 2 plan (pricing page + Polar checkout + webhook) is the follow-up. Preprint gate (Phase 3) can fold into Phase 2 or follow.
```

Append index entry to `MEMORY.md`:

```md
- [Pricing rate limit Phase 1](project_pricing_rate_limit_phase1.md) — Free/Pro daily cap live; Polar + pricing page still pending
```

- [ ] **Step 7: Final commit (if memory files are tracked — they aren't per CLAUDE.md, so skip this commit and just save locally)**

```bash
# No commit — docs/*.md and memory/*.md stay local.
echo "Phase 1 complete. Phase 2 plan next."
```

---

## Phase 2 preview (separate plan)

Not in this plan — will be written after Phase 1 deploys. Scope:

- `/pricing/index.html` static page (v5 mockup approved)
- Polar product setup (manual) + env vars in `~/app/.env`
- `POST /api/billing/polar/checkout` endpoint → hosted checkout URL
- `POST /api/billing/polar/webhook` → verifies signature, flips `profiles.tier`, invalidates cache, writes to `billing_events`
- `GET /api/billing/polar/portal` → redirects Pro users to cancel/update
- `billing_events` migration
- Return-URL flow (`/app/profile?upgraded=1`) with one-shot refresh
- Replace the "Billing manager lands in Phase 2" placeholder in the Usage card with a real Manage-billing link
- Nav link to `/pricing` from landing, chat top-bar, and Profile
- Context7 lookups for Polar SDK + webhook signature scheme before implementation

---

## Self-review notes

Spec coverage: every section of `docs/superpowers/specs/2026-04-20-pricing-tiers-and-rate-limit-design.md` covered for Phase 1 (tier column §4.1, counters + RPC §4.1, middleware §5.1, usage endpoint §5.2, UI §6.1–6.3, testing §9, rollout §13 P1). Phase 2 and Phase 3 deliberately excluded — own plans.

Placeholder scan: no `TBD`/`implement later`/`add error handling` vagueness. Every code block is shippable. One deliberate placeholder in Task 12 ("Billing manager lands in Phase 2") — it's intended to be replaced by Phase 2.

Type consistency: `req.rateLimitInfo` shape (`{tier, used, limit, resetAt, allowed}`) used consistently across Tasks 4, 10, 11. Column names (`count`, `day`, `user_id`) consistent between Task 2 migration and the RPC signature. `readTier` / `invalidateTier` / `userRateLimit` names consistent across imports and tests.
