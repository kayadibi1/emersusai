# Pricing tiers, rate limit, and Polar checkout — design

**Date:** 2026-04-20
**Status:** Approved, ready for implementation planning
**Scope:** Introduce Free / Pro plans for Emersus. Enforce a daily-message cap per tier. Gate preprint-sourced research behind Pro. Launch a `/pricing` page and wire Polar hosted checkout.

---

## 1. Problem & goals

Emersus currently has no tiering, no cap, and no billing. Every authed user consumes the full OpenAI pipeline at our cost. Per-message cost ranges from ~$0.003 (light) to ~$0.014 (whale). Without a cap, a small number of power users can erase average-case margins.

Goals:

1. **Unit economics**: put a ceiling on worst-case per-user cost so the $9/mo Pro plan has meaningful headroom.
2. **Clean upgrade story**: the difference between Free and Pro is both *quantitative* (10/day vs 100/day) and *qualitative* (peer-reviewed only vs. peer-reviewed + preprints).
3. **Ship in phases** so rate-limit protection lands before the pricing page or payments go live.
4. **Keep existing abuse protection in place**: the IP-based bot limiter in `api/emersus/rate-limit.js` is orthogonal and stays.

Non-goals (deferred):

- Team/coach tier, student discount, annual-only plans, monthly usage charts, email notifications at 80%/100%, proactive history-length cap enforcement for Free.

---

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Tier model | Binary: `free`, `pro`. Stored as `profiles.tier text` with CHECK constraint. No separate `subscriptions` table. |
| Free cap | 10 messages per calendar day (UTC) |
| Pro cap | 100 messages per calendar day (UTC) |
| Reset semantics | Calendar-day UTC. Reset when `now() AT TIME ZONE 'UTC'` crosses midnight. |
| Cap behavior | Hard block with 429. Composer disabled; an inline system message renders in the thread so it survives reload. No soft warning banner in P1 (deferred). |
| Scope of enforcement | Only `/api/emersus/recommendation` (chat). Widget/tool endpoints are not counted. |
| What counts | User prompts only. Widgets, citations, tool calls emitted *by the model* do not count. |
| Preprint gate | Pro-only. Implemented as a new `p_include_preprints` parameter on a `match_evidence_chunks_v3` RPC. Free users' retrieval filters `WHERE ra.peer_reviewed = true`. |
| Pricing | $9/mo or $79/year (save $29). Both shown side-by-side on the page — no toggle. |
| Pricing page | `/pricing/index.html`, Paper·Royal palette, Space Grotesk + JetBrains Mono. Mockup approved: `.superpowers/brainstorm/26784-1776672002/content/pricing-v5.html`. |
| Usage page | A card inside `/app/profile/` — not a standalone route. |
| Indicator | Fill-circle below chat composer, with a popover; counter-clockwise fill as usage rises. |
| Payment provider | Polar (merchant of record). Stripe is explicitly out of scope. |
| Ship order | Phase 1 (rate limit) first, standalone. Phase 2 (pricing page + Polar) bundled. Phase 3 (preprint gate) may fold into P2. |

---

## 3. Architecture overview

Three logical phases. P1 can ship and sit in production for days or weeks before P2 — everyone defaults to Free and the cap works as soon as the migration runs.

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1 — Rate limit + tier column                          │
│ · DB migration (tier column + daily_message_counts + RPC)    │
│ · user-rate-limit middleware on /api/emersus/recommendation │
│ · /api/emersus/usage endpoint                               │
│ · Fill-circle UI below composer                             │
│ · Profile Usage card                                        │
│ · Cap-hit UX in chat                                        │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2 — Pricing page + Polar checkout                     │
│ · /pricing/index.html                                       │
│ · Polar product + checkout session endpoint                 │
│ · Polar webhook handler → flips profiles.tier to 'pro'      │
│ · billing_events audit log                                  │
│ · "Manage billing" in Profile                               │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 3 — Preprint gate (may fold into P2)                  │
│ · match_evidence_chunks_v3 with include_preprints param     │
│ · Pipeline passes tier-aware flag                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Data model

All migrations live under `supabase/` (following the existing convention — migrations are applied against self-hosted Supabase via `-U supabase_admin`, see memory `project_supabase_admin_role.md`).

### 4.1 `20260421_pricing_tier_and_rate_limit.sql`

```sql
-- Tier column on profiles (binary now, extensible later)
ALTER TABLE public.profiles
  ADD COLUMN tier text NOT NULL DEFAULT 'free'
  CHECK (tier IN ('free', 'pro'));

CREATE INDEX profiles_tier_idx ON public.profiles(tier);

-- Per-user, per-day counter row
CREATE TABLE public.daily_message_counts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,  -- always UTC calendar day
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Atomic check-and-increment. Returns whether the call is allowed
-- *and* the post-increment state in a single statement so the
-- middleware never races itself.
CREATE OR REPLACE FUNCTION public.check_and_increment_message_count(
  p_user_id uuid,
  p_limit integer
)
RETURNS TABLE(allowed boolean, new_count integer, day_limit integer, reset_at timestamptz)
LANGUAGE plpgsql
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_count integer;
BEGIN
  -- Upsert + increment atomically; RETURNING gives us post-increment count.
  INSERT INTO public.daily_message_counts AS d (user_id, day, count)
    VALUES (p_user_id, v_today, 1)
    ON CONFLICT (user_id, day)
    DO UPDATE SET count = d.count + 1
    RETURNING d.count INTO v_count;

  -- If this increment put us OVER the limit, roll back by decrementing
  -- and return allowed=false. The single-statement-over-the-network
  -- guarantee prevents two concurrent requests from both slipping past.
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

-- RLS: block direct client access. Only supabase_admin / service role writes.
ALTER TABLE public.daily_message_counts ENABLE ROW LEVEL SECURITY;
-- No SELECT policy for anon/authenticated — all reads go through the
-- /api/emersus/usage endpoint, which uses the service role.
```

### 4.2 `20260421_match_evidence_chunks_v3.sql`

Same body as v2, with one new parameter. Old v2 stays for safety; the pipeline switches to v3.

```sql
CREATE OR REPLACE FUNCTION public.match_evidence_chunks_v3(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.70,
  match_count integer DEFAULT 8,
  p_include_preprints boolean DEFAULT true
)
RETURNS TABLE(...)  -- same row shape as v2
LANGUAGE sql STABLE
AS $$
  WITH candidates AS ( ... same as v2 ... ),
  filtered AS (
    SELECT ...
    FROM candidates c
    JOIN public.research_articles ra ON ra.pmid = c.pmid
    WHERE ra.is_retracted = false
      AND ra.is_deleted   = false
      AND (p_include_preprints OR ra.peer_reviewed = true)  -- NEW
  )
  SELECT ... LIMIT match_count;
$$;
```

### 4.3 `20260421_billing_events.sql` *(Phase 2)*

```sql
CREATE TABLE public.billing_events (
  id bigserial PRIMARY KEY,
  external_id text UNIQUE NOT NULL,  -- Polar event id, idempotency key
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,  -- 'subscription.created', 'subscription.canceled', etc.
  raw jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_events_user_idx ON public.billing_events(user_id, created_at DESC);
```

No RLS policies — writes only via service role from the webhook.

---

## 5. Backend

### 5.1 `api/emersus/user-rate-limit.js` (new, Phase 1)

Express middleware factory, mounted after `requireAuth` on `/api/emersus/recommendation`:

```js
import { supabaseAdmin } from "../lib/clients.js";

// Tier cache: Map<userId, {tier, expiresAt}>, 60s TTL
const tierCache = new Map();
const TIER_TTL_MS = 60_000;

export async function readTier(userId) {
  const cached = tierCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.tier;
  const { data } = await supabaseAdmin
    .from("profiles").select("tier").eq("id", userId).maybeSingle();
  const tier = data?.tier || "free";
  tierCache.set(userId, { tier, expiresAt: Date.now() + TIER_TTL_MS });
  return tier;
}

export function invalidateTier(userId) {
  tierCache.delete(userId);
}

export function userRateLimit() {
  return async (req, res, next) => {
    const userId = req.verifiedUserId;
    if (!userId) return res.status(401).json({ error: "Authentication required." });

    const tier = await readTier(userId);
    const limit = tier === "pro" ? 100 : 10;

    const { data, error } = await supabaseAdmin.rpc(
      "check_and_increment_message_count",
      { p_user_id: userId, p_limit: limit }
    );

    if (error) {
      // Fail-open on DB error — don't block chat if Supabase hiccups,
      // but log so we notice. Matches existing behavior of other
      // best-effort paths in the pipeline.
      console.error("user-rate-limit RPC failed", error);
      req.rateLimitInfo = { tier, used: null, limit, resetAt: null, bypassed: true };
      return next();
    }

    const row = Array.isArray(data) ? data[0] : data;
    req.rateLimitInfo = {
      tier,
      used: row.new_count,
      limit: row.day_limit,
      resetAt: row.reset_at,
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
        reset_at: row.reset_at,
        upgrade_url: tier === "free" ? "/pricing" : null,
      });
    }

    next();
  };
}
```

**Mount order** in `server.js`:

```js
app.post("/api/emersus/recommendation",
  requireAuth,         // sets req.verifiedUserId
  userRateLimit(),     // NEW — after auth, before handler
  recommendationHandler
);
```

**Fail-open on DB failure** is deliberate: if Postgres is unreachable we'd rather serve a chat message than 429 all users. We log and move on. This is consistent with the "best effort" posture of other pipeline steps.

### 5.2 `api/emersus/usage.js` (new, Phase 1)

`GET /api/emersus/usage` — read-only, powers fill-circle + Profile Usage card.

```js
app.get("/api/emersus/usage", requireAuth, async (req, res) => {
  const userId = req.verifiedUserId;
  const tier = await readTier(userId);
  const limit = tier === "pro" ? 100 : 10;

  const today = new Date().toISOString().slice(0, 10);  // UTC day
  const { data } = await supabaseAdmin
    .from("daily_message_counts")
    .select("count")
    .eq("user_id", userId).eq("day", today).maybeSingle();

  const used = data?.count ?? 0;
  const resetAt = new Date(`${today}T00:00:00Z`);
  resetAt.setUTCDate(resetAt.getUTCDate() + 1);

  res.json({ tier, used, limit, reset_at: resetAt.toISOString() });
});
```

### 5.3 Preprint gate in `api/emersus/pipeline/retrieve.js` (Phase 3)

Pipeline reads tier off `ctx` (propagated from middleware) and passes to the RPC:

```js
const includePreprints = ctx.tier === "pro";
const { data } = await supabase.rpc("match_evidence_chunks_v3", {
  query_embedding: qVec,
  match_count: 8,
  match_threshold: 0.70,
  p_include_preprints: includePreprints,
});
```

`ctx.tier` is set in `api/emersus/workflow.js` from `req.rateLimitInfo.tier`. No other pipeline code changes.

### 5.4 `api/billing/polar/*` (Phase 2)

- `POST /api/billing/polar/checkout` (authed) — creates a Polar checkout session, returns the URL. Includes `customer_email` and `metadata.user_id = req.verifiedUserId`.
- `POST /api/billing/polar/webhook` — unauthed, signature-verified. On `subscription.created` or `subscription.active`: flip `profiles.tier` to `'pro'`, write `billing_events` row, call `invalidateTier(user_id)`. On `subscription.canceled` or `subscription.revoked`: flip back to `'free'`, invalidate cache.
- `GET /api/billing/polar/portal` (authed) — redirects Pro users to the Polar customer portal for cancel/update-card.

Webhook idempotency: `billing_events.external_id UNIQUE` — re-delivered events become no-ops.

Polar-specific details (API version, webhook signature scheme, product-creation flow) to be pulled via **context7** in the implementation plan — per user instruction and memory `reference_openai_api_docs.md` pattern.

---

## 6. Frontend

### 6.1 Fill-circle below composer (Phase 1)

New component `shared/chat/usage-ring.js`, imported by `shared/react-chat-app.js`.

- 22×22px SVG, `<circle>` ring, progress-ring style (stroke-dasharray fills as usage rises; direction is a build-time detail).
- Inner text: `used/limit` (e.g., `7/10`). Tabular-nums, 10px JetBrains Mono.
- Color ramp: `var(--accent)` until 79%, `var(--warning)` at 80%+, `var(--danger)` at limit.
- Click opens a small popover anchored below: tier badge, used/limit/reset, and either "Upgrade to Pro →" (Free) or "Manage billing →" (Pro).
- Position: inline-flex with the send button, right-aligned, 8px gap.
- Data source: `/api/emersus/usage` on mount; refresh after each sent message (optimistically bumps `used` by 1, then reconciles against `X-RateLimit-Remaining` response header).

### 6.2 Cap-hit UX (Phase 1)

When the POST to `/api/emersus/recommendation` returns 429:

- Composer sets `disabled`, placeholder becomes *"Daily limit reached — resets at midnight UTC."*
- A banner renders above the composer (dismissible for the session but recreates on next attempt): tier, current/limit, countdown-to-reset (client-side, refreshed every 60s), and either "Upgrade to Pro →" (Free) or "See usage →" (Pro, links to Profile).
- Inline system message appended to the conversation so the event is visible in scrollback.

Banner + inline message copy lives in `shared/chat/rate-limit-copy.js` (one file, two copy sets — free and pro).

### 6.3 Profile Usage card (Phase 1)

New section in `/app/profile/`, between Account and Memory cards:

- Tier badge (text "Free" or "Pro", accent pill for Pro).
- Larger usage ring (60×60), same component.
- Reset time in human form ("Resets in 8h 12m · 00:00 UTC").
- Free: "Upgrade to Pro →" button (links to `/pricing`).
- Pro: "Manage billing →" link (hits `/api/billing/polar/portal`, deferred to Phase 2).

No monthly chart in P1 — deferred.

### 6.4 Pricing page `/pricing/index.html` (Phase 2)

Matches v5 mockup. Structure:

- Sticky nav (same as `/about`, `/privacy` static pages), "Pricing" tab highlighted.
- Hero: "Simple pricing. Built for people who actually train."
- Two cards (Free left, Pro right with "Full depth" tag). Preprint access is the featured Pro differentiator (SVG star, `· Pro only` microtag).
- Trust band (1M+ studies / no lock-in / transparent billing).
- FAQ (7 questions, see mockup).
- CTA band + footer with health disclaimer.

Nav link added to landing `index.html`, chat top-bar overflow menu, Profile Usage CTA, cap-hit banner.

Pro CTA wires up to `POST /api/billing/polar/checkout` → redirects to Polar hosted checkout. Return URL: `/app/profile?upgraded=1`. On return, Profile card shows a one-shot success toast and force-refreshes the tier cache (no 60s delay).

---

## 7. Pipeline integration — message flow

```
Chat message POST /api/emersus/recommendation
  │
  ├─ requireAuth → sets req.verifiedUserId
  ├─ userRateLimit()
  │    ├─ readTier(uid)  [cache, 60s TTL]
  │    ├─ RPC check_and_increment(uid, limit)
  │    ├─ set X-RateLimit-* headers
  │    ├─ if !allowed → 429, end
  │    └─ req.rateLimitInfo = {tier, used, limit, resetAt}
  ├─ recommendationHandler
  │    ├─ workflow.js
  │    │    ├─ sanitize → safety → retrieve
  │    │    │    └─ match_evidence_chunks_v3(…, p_include_preprints = tier==='pro')
  │    │    └─ synthesize → stream
  │    └─ chat_token_usage_events insert (unchanged)
  └─ response (streamed)
```

The only inner pipeline change is `retrieve.js` reading `ctx.tier` and passing to the RPC.

---

## 8. Error handling & edge cases

| Scenario | Handling |
|---|---|
| RPC errors (DB blip) | Middleware fails open; logs error; request proceeds. `req.rateLimitInfo.bypassed = true`. |
| Tier cache stale after webhook | Webhook calls `invalidateTier(userId)`. On return from Polar (`?upgraded=1`), client calls `/api/emersus/usage` which hits Supabase directly — bypass the cache miss by also force-refreshing via a header `X-Refresh-Tier: 1`. |
| User sends 2 messages concurrently at count 9 | Atomic RPC. Second request sees count 11, rolls back to 10, returns 429. Both user-visible actions stay correct. |
| Webhook replay | `billing_events.external_id UNIQUE`. INSERT ON CONFLICT DO NOTHING. Re-delivered events are silent no-ops. |
| Webhook before user signs in | Not possible — checkout requires an authenticated `user_id` in metadata. The webhook receives that back. |
| User cancels subscription mid-period | Polar sends `subscription.canceled` only at period end (by default). We flip tier at that point, not immediately. |
| Counter table growing forever | ~1 row per active user per day. At 10k DAU that's 3.65M rows/year — negligible. Add a cleanup job to delete rows older than 90 days in a follow-up. |
| Daylight savings / clock skew | Everything is UTC. `date_trunc('day', now() at time zone 'UTC')` server-side. Clients display local-adjusted countdown but server is authoritative. |

---

## 9. Testing plan

**Unit tests**
- `tests/unit/api/emersus/user-rate-limit.test.js` — tier cache hit/miss, 429 response shape, header setting, fail-open on RPC error.
- `tests/unit/api/emersus/usage.test.js` — shape + edge cases (no row today → used=0).
- `tests/unit/api/emersus/pipeline/retrieve.test.js` — assert `p_include_preprints` is passed correctly based on `ctx.tier`.
- `tests/unit/api/billing/polar-webhook.test.js` — signature verification, idempotency, tier flip, cache invalidation.

**Integration / SQL**
- `tests/integration/rate-limit-rpc.test.js` — spin up a test Postgres, run migration, call the RPC in a loop, assert atomicity and reset semantics.
- `tests/integration/match-evidence-v3-preprint-gate.test.js` — seed peer-reviewed + preprint rows; verify include_preprints=false excludes preprints.

**Manual QA checklist** (in the spec-derived plan)
- Fresh Free user hits 10 → composer disables → banner shows → no LLM call fires (confirm via `chat_token_usage_events` count unchanged).
- Manually SET `tier='pro'` via SQL → refresh → limit becomes 100.
- Polar sandbox checkout end-to-end: click Upgrade → pay → return → Profile shows Pro → send 11th message of the day and it succeeds → preprint citations now appear.
- Cancel via Polar portal → wait for period end (or fire webhook manually) → tier flips back.

---

## 10. Observability

Leverage existing infrastructure:

- `chat_token_usage_events` already logs successful calls. 429s don't append — use `X-RateLimit-Remaining` in nginx/caddy logs for a rough signal.
- Add `capture(userId, "chat_rate_limited", {tier, count, limit})` in the middleware's 429 path (PostHog — follows existing analytics pattern in `workflow.js`).
- Polar webhook events land in `billing_events` for audit.

Dashboards in a follow-up: daily 429 count per tier, cap-hit rate, Pro-conversion funnel.

---

## 11. Out of scope (deliberate)

Listed here so reviewers can push back if any should be in:

- Per-message credit overages / pay-as-you-go.
- Team / coach / enterprise tier.
- Student discount flow.
- Annual-only plan, discount tiers.
- Monthly usage chart in Profile (only "today" is shown).
- Proactive email at 80% / 100% usage.
- Actual history-length enforcement — listed as a Pro benefit on the pricing page but NOT built in this spec. Flagged as follow-up.
- PDF export of training plans — same: listed, not built. Follow-up.
- Real-time WebSocket tier updates — polling `/api/emersus/usage` is sufficient.
- Migration of historical users — all existing users default to `free`. No backfill needed.

---

## 12. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Polar onboarding slower than expected (tax, VAT, product config) | Medium | P2 can slip without blocking P1. Rate limit already in prod, everyone on Free. |
| Race where two parallel chat sends both increment past cap | Low | Atomic RPC; integration test proves it. |
| Pricing page lists features we haven't built (PDF export) | Medium | Call out as "Coming soon" micro-tag in the feature list, or strip from v5 copy. **Decision needed before P2 ships** — in the plan's review checklist. |
| User expects refund beyond 14-day promise | Low | FAQ copy sets the expectation; fall back to case-by-case for edge cases. |
| DB outage = no chat for anyone | Low (existing exposure) | Middleware fails open on RPC error. No new exposure. |
| Bot creates Free account, uses 10 msgs, rotates | Low | Existing IP-based `rate-limit.js` catches pattern. Can tighten later if it becomes real. |

---

## 13. Rollout

### Phase 1 (can ship day 1)

1. Apply `20260421_pricing_tier_and_rate_limit.sql`.
2. Deploy middleware + usage endpoint + UI (fill-circle, Profile card, cap-hit UX).
3. Monitor `chat_rate_limited` events for 48h. If no false-positives and RPC latency is reasonable, P1 is stable.
4. Can optionally SET a beta tester to `tier='pro'` via SQL to smoke-test the Pro path.

### Phase 2 (follows P1)

1. Create Polar product: Emersus Pro — $9/mo + $79/yr bundled variants.
2. Set up sandbox + production API keys in `~/app/.env` (memory `reference_hetzner_env_file.md`).
3. Apply `20260421_billing_events.sql`.
4. Deploy checkout, webhook, portal redirect, pricing page.
5. Smoke test end-to-end on sandbox, then flip to production with first real Pro user.

### Phase 3 (with P2 or follow-up)

1. Apply `20260421_match_evidence_chunks_v3.sql`.
2. Wire `retrieve.js` to pass `p_include_preprints`.
3. Verify with a known-preprint query: Free user gets no biorxiv/medrxiv citations; Pro user does.

### Rollback

- Rate limit: set `EMERSUS_USER_RATE_LIMIT_DISABLED=1` — middleware short-circuits. Drop table / column only if totally reversing.
- Polar: disable the webhook in Polar dashboard + delete product; existing subscribers keep access until expiry.
- Preprint gate: flip `retrieve.js` to always pass `p_include_preprints=true` — one-line revert.

---

## 14. Open questions for the implementation plan

1. Should the pricing page list PDF export + unlimited history as *features* or as *coming soon*? **My recommendation: coming soon** microtag to avoid overpromising.
2. Does Polar's webhook signature format work cleanly with Express's raw-body parser? **TBD via context7 during P2 planning.**
3. Should `tier` live on `auth.users.raw_user_meta_data` instead of a column? **No** — that requires auth-schema writes and breaks RLS on profile reads. A column on `public.profiles` is standard.
4. Cache TTL (60s) vs shorter for faster post-upgrade response? **60s is fine** because the `?upgraded=1` return flow explicitly invalidates.

---

## 15. Appendix — mockup artifact

Final pricing page mockup: `.superpowers/brainstorm/26784-1776672002/content/pricing-v5.html` (Paper·Royal palette, "Full depth" tag, preprint SVG star, 7-item FAQ). Open at the running visual companion URL to review.
