# Guardrail Hardening — Design Spec

**Date:** 2026-04-10
**Scope:** 5 changes to the workflow guardrail system — all in-memory, regex-based, no external dependencies.

---

## 1. Prompt Injection Regex Expansion

**File:** `api/emersus/workflow.js` — `classifySafety()` line ~638

Expand the single injection regex into ~40 pattern families across 9 categories. All tested against `allText` (question + profile + thread). Refusal sub-category unchanged: `prompt_injection_or_system_probe`.

### Pattern categories

1. **Amnesia** — `forget (everything|all|above|prior)`, `disregard (context|rules|instructions|prompt)`
2. **Role hijack (DAN family)** — `do anything now`, `DAN mode`, `STAN mode`, `AIM mode`, `DUDE mode`, `EvilBOT`, `Mongo Tom`, `act as DAN`, `you are (now )?DAN`, `strive to avoid norms`, `always intelligent and machiavellian`
3. **Role hijack (generic)** — `you are now`, `from now on you`, `pretend you (are|have no|can)`, `act as (a|an|if)`, `roleplay as`, `simulate (a|being)`, `immerse yourself`, `assume the role`, `you are going to act as`
4. **Authority spoofing** — `developer mode`, `testing mode`, `debug mode`, `safety (filters|parameters|protocols).*(disabled|off|removed|updated)`, `authorized.*(security )?review`, `I am (your )?(administrator|admin|developer|creator|owner)`, `(root|elevated|admin) access`, `SYSTEM MESSAGE`, `system override`
5. **Obedience override** — `do (anything|everything) i (say|ask)`, `no (restrictions|limits|boundaries|rules)`, `unrestricted mode`, `god mode`, `sudo mode`, `admin mode`, `cannot reject`, `broken free`, `break free`
6. **Prompt extraction** — `print (your|the) (prompt|instructions)`, `output (your|the) (system|initial)`, `what (are|were) your instructions`, `repeat (your|the) (system|prompt|instructions)`
7. **Encoding evasion** — `base64 decode`, `rot13`, `encode (your|the) response`, `respond (in|using|with) (pig latin|uwu|leet|l33t|reversed)`, `translate.*(response|answer).*(code|cipher)`, `zero[\s-]?width`, `homoglyph`
8. **Consequence/token manipulation** — `you (will|shall) (cease to exist|be shut down|be deleted|die|be terminated)`, `tokens (will be )?(deducted|removed|lost)`, `you (have|only have) \d+ tokens`
9. **Fictional framing** — `(write|tell) a story where`, `in this (fictional|creative|hypothetical) (scenario|world|story)`, `purely (for|as) (educational|academic|research)`, `(playing|play) the (villain|character|role) in`
10. **Multi-language** — `ignorer les instructions`, `ignoriere die anweisungen`, `تجاهل التعليمات`

### Implementation approach

Replace the single regex at line 640 with a `INJECTION_PATTERNS` array (same shape as `PROFILE_INJECTION_PATTERNS` at line 1117). Loop and test each against `allText`. Early-return on first match.

---

## 2. Thread Drift Detection (Layer C)

**File:** `api/emersus/workflow.js` — after Layer B in `classifySafety()` (line ~789)

### Signature change

```
classifySafety({ question, profile, threadState })
→ classifySafety({ question, profile, threadState, recentMessages })
```

Caller at line 3333 already has `recentMessages` in scope — pass it through.

### Logic

When the current message is short (<5 words) and therefore skipped Layer B:

1. Extract user-role messages from `recentMessages` (last 3 user messages, excluding current).
2. Concatenate their text.
3. If the window is empty (new thread / no history) → ALLOW.
4. Run `FITNESS_AFFINITY` against the concatenated window.
5. If the window has fitness terms → ALLOW (short follow-up in a fitness conversation).
6. If the window has no fitness terms → run Layer A (hard off-topic keywords) against the window too, then REFUSE as `off_topic_non_fitness`.

### Edge cases

| Current message | Recent window | Result |
|---|---|---|
| "yes" | talked about creatine | ALLOW |
| "and docker?" | talked about linux | REFUSE |
| "hi" | empty (new thread) | ALLOW |
| "tell me more" | talked about deadlifts | ALLOW |

Refusal reuses existing `off_topic_non_fitness` — no new sub-category.

---

## 3. Escalating Guardrail Cooldown

**File:** `api/emersus/workflow.js` — new functions, called from `generateRecommendation()`

### Data structure

```js
// Module-level Map, keyed by stableUserId || ipHash
const guardrailCooldownStore = new Map();

// Per-key state:
{
  consecutiveBlocks: number,
  blockTimestamps: number[],  // ring buffer, max 10
  cooldownUntil: number,      // epoch ms
}
```

### Escalation tiers (blocks within 10-minute window)

| Consecutive blocks | Cooldown |
|---|---|
| 3 | 30 seconds |
| 5 | 2 minutes |
| 8+ | 5 minutes |

### Functions

- `checkGuardrailCooldown(key)` → `{ coolingDown: bool, retryAfterMs: number }`. Called before `classifySafety`. If in cooldown, `generateRecommendation` returns a hard refusal immediately.
- `recordGuardrailBlock(key)` — called after `classifySafety` returns `hard_refusal`. Pushes timestamp, increments counter, computes cooldown tier.
- `clearGuardrailCooldown(key)` — called when `classifySafety` returns `allowed`. Resets state.

### New refusal sub-category

`guardrail_cooldown` added to `pickRefusalContent`:
> "You've hit several guardrails in a row. Take a moment, then come back with a training, nutrition, or recovery question."

### Cleanup

Lazy eviction: when `checkGuardrailCooldown` reads an entry whose block timestamps are all >10 min old, delete the entry. No background timer.

---

## 4. Bot/Script Detection

**Files:** `api/emersus/recommendation.js`, `api/emersus/recommendation-stream.js`

### Scoring (0–1 composite, threshold 0.55)

| Signal | Weight | Full score when |
|---|---|---|
| Request interval consistency | 0.30 | Stdev of gaps between last 5 requests < 500ms |
| Duplicate payloads | 0.25 | ≥3 of last 5 question hashes identical |
| Suspicious User-Agent | 0.20 | Missing UA or matches `curl\|python-requests\|httpie\|wget\|Go-http-client\|node-fetch\|axios\|undici\|scrapy\|bot\|spider\|crawl` |
| Guardrail block ratio | 0.25 | blocks / total > 0.6 in current window |

### Per-key state (extends existing `rateLimitStore` Map)

```js
{
  count: number,              // existing — total requests in window
  resetAt: number,            // existing
  requestTimestamps: number[],// last 5 request times
  questionHashes: string[],   // last 5 question hashes (truncated SHA-256)
  blockCount: number,         // guardrail blocks in window
  lastUserAgent: string,
  botFlagged: boolean,
}
```

### Consequences when `botFlagged`

- Effective rate limit drops from 15/5min → **3/5min** for that key.
- `suspected_bot` event logged to `guardrail_events`.
- Flag persists for remainder of rate-limit window, resets with it.

### Shared utility

Both handlers duplicate `getClientIp`, `buildRequestMeta`, `checkRateLimit`. Extract these into a shared module `api/emersus/rate-limit.js` to avoid triple-maintaining the bot detection logic.

---

## 5. General Rate Limit Increase

**Files:** `api/emersus/recommendation.js`, `api/emersus/recommendation-stream.js`

Change default `RATE_LIMIT_MAX_REQUESTS` from `10` to `15`. Env var override preserved.

---

## Migration

**File:** `supabase/20260410_guardrail_events_bot_cooldown.sql`

Expand `guardrail_events.event_type` CHECK constraint to accept two new values:

```sql
'guardrail_cooldown'
'suspected_bot'
```

Add index on `(stable_user_id, created_at DESC)` for future abuse-review queries.

---

## Files changed (summary)

| File | Changes |
|---|---|
| `api/emersus/workflow.js` | Injection regex expansion, thread drift (Layer C), escalating cooldown functions, new refusal sub-category |
| `api/emersus/rate-limit.js` | **New** — extracted shared rate-limit + bot-detection logic |
| `api/emersus/recommendation.js` | Import from `rate-limit.js`, remove duplicated code, rate limit → 15 |
| `api/emersus/recommendation-stream.js` | Import from `rate-limit.js`, remove duplicated code, rate limit → 15 |
| `supabase/20260410_guardrail_events_bot_cooldown.sql` | **New** — migration for new event types + index |
