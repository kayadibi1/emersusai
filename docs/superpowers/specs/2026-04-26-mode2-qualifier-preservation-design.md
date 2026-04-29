# Mode-2 Qualifier-Preservation Verifier (MQPV) — Design

**Status:** approved 2026-04-26 (brainstorm)
**Goal:** drive mode_2 over-generalization rate from validated 56% → ≤10% (target ~5%) under prod chat conditions.
**Constraint:** OpenAI only — no new vendor.

---

## 1. Why this exists

Mode_2 over-generalization is the dominant grounding-quality issue in current Emersus chat. The validated baseline (Z2-live, 200-chat bench, human-graded 2026-04-26) shows:

- **56.2% of cited claims drop a qualifier** that's present in the cited source (population, dose, duration, study design, comparator, effect size, intervention, outcome).
- Pre-Rule-7 baseline was 68%; Rule 7 (prompt instruction to preserve qualifiers) brought it to 57%. Rule 7 alone has plateaued.
- Mode_3 fabrication is at ~0% (validated by human grading: both flagged "fabrications" in the Z2-live bench were judge artifacts, not real fabrications). The Anthropic Citations API pattern would not move mode_2.
- Z2 retrieval (HyDE + zerank-2, shipped today) didn't reduce mode_2; in fact mode_2 went 52.5% → 56.2% because more retrieved sources → more qualifiers in scope to drop.

**Mode_2 is a synthesis-side problem, not retrieval-side.** Every mode_2 case in the human-graded subset had the dropped qualifier present in the source text. The model reads it and chooses to omit at write-time.

The next mechanism for reducing mode_2 must intervene at synthesis output, not at retrieval input.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Target mode_2 rate | **≤10% (aim ~5%)** |
| 2 | New vendor allowed? | **No — OpenAI only** |
| 3 | Source qualifier extraction location | **2** — Inline at chat time |
| 4 | Streaming UX vs verification rigor | **1** — Post-stream corrective rewrite (preserve streaming) |
| 5 | Qualifier schema | **3** — Open-ended key-value pairs (not fixed PICO) |
| 6 | Rewrite scope | **1** — Whole-response rewrite (single LLM call regardless of #claims to fix) |
| 7 | Rewrite trigger | **1** — Any missing qualifier triggers rewrite |
| 8 | Failure-mode handling | **3** — Retry-with-hedge fallback (rewrite #1: preserve; rewrite #2: preserve OR explicitly hedge) |
| 9 | Rollout strategy | Bench-driven scale-back (no real-traffic shadow window — production launch is months away) |

---

## 3. Architecture

```
prose stream completes (existing pipeline unchanged)
  ↓
[NEW] extract qualifiers (parallel per cited source)
  → gpt-5.4-mini, open-ended K/V dict per source
  → cached per pmid within chat
  ↓
[NEW] validate
  → gpt-5.4-mini single batch call
  → input: full prose + per-source qualifier dicts
  → output: list of {claim_text, source_idx, missing_qualifiers}
  ↓
[branch on validation result]
  no missing → ship original prose

  missing → rewrite #1: gpt-5.4-mini "preserve qualifiers"
    ↓ re-validate
    no missing → ship rewritten prose

    still missing → rewrite #2: gpt-5.4-mini "preserve OR explicitly hedge"
      ↓ re-validate (informational only — outcome doesn't gate ship)
      ship final prose regardless
  ↓
emit SSE prose_updated event with final prose
emit SSE done event with updated grounding badge
```

---

## 4. Components

### 4.1 `api/emersus/pipeline/mode2-qualifier-extract.js` (new, ~120 LOC)

Per-source qualifier extractor. Open-ended K/V — extractor decides which qualifiers exist for each paper.

```js
export async function extractQualifiers(source, { model = "gpt-5.4-mini" } = {}) {
  // source = { pmid, title, excerpt, abstract?, full_text? }
  // returns { qualifiers: { [key]: value }, error?, cost_usd, latency_ms }
}
```

Prompt (sketch):
> Extract any qualifiers present in this scientific source — population, dose, duration, intervention, comparator, outcome, study design, effect size, sample size, or any other qualifying conditions the findings depend on. Return JSON: `{"qualifiers": {[key]: value}}`. Use whatever keys best describe the source. Empty `{}` if no clear qualifiers.

Cached within a chat by source_id (same paper cited twice → one extraction). v1 ships without cross-chat cache; v2 adds Redis.

### 4.2 `api/emersus/pipeline/mode2-validate.js` (new, ~150 LOC)

Whole-response judge. Takes the streamed prose plus per-source qualifier dicts; returns missing-qualifier deltas per claim.

```js
export async function validateQualifierPreservation({
  prose,           // full streamed prose
  citedSources,    // [{ id, qualifiers: {...} }, ...]
  model = "gpt-5.4-mini",
}) {
  // returns {
  //   per_claim_missing: [{ claim_text, source_idx, missing_qualifiers: [...] }],
  //   total_missing: int,
  //   qualifiers_dropped_breakdown: { [qualifier_type]: count },
  //   cost_usd: number,
  //   latency_ms: number,
  // }
}
```

Reuses `extractAtomicClaims` from `claim-modes.js` to find factual claims (already filters meta-statements, hedges, conversational offers).

Validator prompt (sketch):
> For each claim, check whether the cited source's qualifiers are preserved in the claim text. A qualifier is "preserved" if its value (or a clear semantic equivalent) appears in the claim text, OR if the claim explicitly hedges that the qualifier limits generalization. Return JSON: `{per_claim: [{claim_text, source_idx, missing: [qualifier_keys_that_were_dropped]}, ...]}`.

### 4.3 `api/emersus/pipeline/mode2-rewriter.js` (new, ~150 LOC)

Whole-response rewriter, two modes.

```js
export async function rewriteForQualifierPreservation({
  originalProse,
  validationResult,    // output of validate.js
  citedSources,
  mode,                // "preserve" or "preserve_or_hedge"
  model = "gpt-5.4-mini",
}) {
  // returns { prose, cost_usd, latency_ms }
}
```

Two prompt modes:

**Mode A: "preserve":**
> Rewrite the response below, preserving all qualifiers from cited sources that the validator flagged as dropped. Maintain natural prose flow and the original message structure. The list of (claim, missing qualifiers) is: [...]

**Mode B: "preserve_or_hedge":**
> Rewrite the response. For each flagged claim, EITHER preserve the missing qualifiers in the prose, OR explicitly hedge — e.g., "the cited source is in {population}, generalization beyond is uncertain." Either approach is acceptable. The list of (claim, missing qualifiers) is: [...]

### 4.4 `api/emersus/pipeline/mode2-pipeline.js` (new, ~80 LOC)

Orchestrator that ties extract + validate + rewrite together with the retry-with-hedge fallback. Single entry point called from `stream.js`.

```js
export async function runMode2Pipeline(ctx) {
  // Returns {
  //   rewritten_prose: string | null,  // null if no rewrite happened
  //   telemetry: {
  //     rewrites_attempted: 0|1|2,
  //     initial_failures: int,
  //     after_r1_failures: int | null,
  //     final_failures: int,
  //     extraction_cost_usd, validation_cost_usd, rewrite_cost_usd,
  //     extraction_latency_ms, validation_latency_ms, rewrite_latency_ms,
  //     total_latency_ms,
  //     qualifiers_dropped_breakdown: { [type]: count },
  //     validation_json: object,
  //   },
  // }
}
```

Handles all the failure-mode logic from §7 (extractor errors → empty qualifier set; validator errors → ship original; rewrite errors → ship best-available; length-ratio fallback). Caller (`stream.js`) just inspects `rewritten_prose` and swaps if non-null.

### 4.5 `api/emersus/pipeline/stream.js` (modify)

After the existing `verifyAnswerGrounding` call (line 507), insert MQPV pipeline:

```js
// pseudocode insertion in finalizePostStream()
ctx.grounding = verifyAnswerGrounding({...});  // existing

if (mode2VerifierEnabled() && ctx.evidence?.items?.length) {
  ctx.mode2 = await runMode2Pipeline(ctx);
  if (ctx.mode2.rewritten_prose) {
    ctx.prose = ctx.mode2.rewritten_prose;
    // Re-run grounding verifier on the new prose so badge reflects final state
    ctx.grounding = verifyAnswerGrounding({
      answerText: ctx.prose,
      evidenceItems: ctx.evidence?.items || [],
      mode: groundingEnforcementEnabled() ? "citation" : "legacy",
    });
  }
}

sendSSE(res, { type: "done", ... });
```

`runMode2Pipeline` orchestrates: extract → validate → conditional rewrites → re-validate → return rewritten prose + telemetry.

Between prose-stream-end and the final `done` SSE, server emits `{type: "verifying"}` so the client can show a "checking sources" indicator on the just-rendered message.

### 4.6 `api/emersus/pipeline/prompt.js` (modify)

Add **Rule 8** to the existing grounding contract:

> 8. Your output will be checked for qualifier preservation. For each cited claim, preserve the source's population, dose, duration, study design, comparator, and effect size — OR explicitly hedge that generalization is uncertain ("the cited source is in trained men only," etc.). Dropping a qualifier without hedging will trigger an automatic rewrite.

This pre-emptively reduces qualifier drops before the validator catches them, lowering rewrite frequency.

### 4.7 `shared/react-chat-app.js` (modify)

Handle two new SSE event types:

- `{type: "verifying"}` — display a subtle "checking sources" indicator on the just-rendered assistant message; chat stays scrollable, no blocking.
- `{type: "prose_updated", content: "..."}` — replace the assistant message's prose content in place; preserve scroll position; no re-animation.

Existing event handlers in `react-chat-app.js:4586-4710` already handle similar updates. New types slot into the same dispatch.

### 4.8 `scripts/eval/mode2-bench.js` (new, ~250 LOC)

Bench harness that runs the prod chat workflow with MQPV enabled, captures telemetry to `chat_grounding_samples` with `synthetic=true`. Critical optimization: split into phases like `anchor-verifier-bench.js`:

- **gen phase:** run prod chat workflow against fixtures, capture `(question, sources, original_streamed_prose)` to `mode2-bench-source-{ts}.json`. ~$3-5 for 1000 chats.
- **mqpv phase:** read source file, for each captured chat run extract+validate+rewrite pipeline, write per-chat telemetry to chat_grounding_samples. ~$2 for 1000 chats.
- **A/B phase:** re-run mqpv phase with ablation flags (skip rewrite #2; skip qualifier types) on the same captured source chats. Bench cost ~$2 per ablation × N ablations.

CLI:
```
node scripts/eval/mode2-bench.js --mode=gen --samples=1000 --runId=mode2-v1
node scripts/eval/mode2-bench.js --mode=mqpv --sourceFile=mode2-bench-source-{ts}.json --runId=mode2-v1
node scripts/eval/mode2-bench.js --mode=mqpv --sourceFile=... --runId=mode2-v1-no-r2 --skipRewrite2
node scripts/eval/mode2-bench.js --mode=mqpv --sourceFile=... --runId=mode2-v1-no-effect-size --skipQualifier=effect_size
```

### 4.9 `scripts/mode2-trend.js` (new, ~200 LOC)

Reads `chat_grounding_samples` (filterable to `synthetic=true` for bench, `false` for real, or both), emits markdown report with:

- **Cost dashboard** — avg cost/chat by phase (extract/validate/rewrite); total spend; projection at 10× / 100× traffic.
- **Effectiveness dashboard** — mode_2 rate before MQPV (`initial_failures / atomic_claims`) vs after (`final_failures / atomic_claims`); per-rewrite incremental reduction.
- **Activation distribution** — % chats with 0/1/2 rewrites; p50/p95/p99 added latency.
- **Qualifier breakdown** — which qualifier types are dropped most; which are most-preserved by rewrite.
- **Auto-flagged recommendations:**
  - "Drop rewrite #2" if it activates <2% of chats AND incremental mode_2 reduction is <2pp
  - "Drop validation on qualifier X" if X is dropped <5% of mode_2 cases AND removing it doesn't change rewrite trigger rate by >1pp
  - "Tighten cost ceiling" if avg cost/chat exceeds 1.5× projected baseline
  - "Latency regression" if p95 added latency exceeds 10s for >5% chats
  - "Rewriter ineffective" if rewrite #1 produces same-or-more mode_2 in >10% of chats

---

## 5. Schema additions to `chat_grounding_samples`

```sql
ALTER TABLE chat_grounding_samples ADD COLUMN synthetic boolean DEFAULT false;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_enabled boolean DEFAULT false;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_rewrites_attempted smallint;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_initial_failures int;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_after_r1_failures int;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_final_failures int;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_extraction_cost_usd numeric;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_validation_cost_usd numeric;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_rewrite_cost_usd numeric;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_extraction_latency_ms int;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_validation_latency_ms int;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_rewrite_latency_ms int;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_total_latency_ms int;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_qualifiers_dropped_breakdown jsonb;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_pre_prose text;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_post_prose text;
ALTER TABLE chat_grounding_samples ADD COLUMN mode2_validation_json jsonb;
```

`synthetic` distinguishes bench rows from real-prod rows. The same trend script reads both.

---

## 6. Cost / latency budget

Per-chat (using gpt-5.4-mini at ~$0.15/M input, ~$0.60/M output):

| Phase | Avg cost | Avg latency | Trigger rate |
|---|---:|---:|---:|
| Extract qualifiers (~6 sources, parallel; cached per pmid in chat) | $0.0012 | 2-3s | 100% |
| Validate (1 batch judge call) | $0.0005 | 1-2s | 100% |
| Rewrite #1 (only when triggered) | $0.005 | +3s | ~70% |
| Rewrite #2 (only when needed) | $0.005 | +3s | ~5% |

**Avg cost/chat ~$0.005**. **Avg latency ~6-8s post-stream typical**, ~12-15s worst case (5% of chats).

At eventual 30K msgs/mo: **~$150/mo** for MQPV. Manageable.

If bench-driven scale-back drops rewrite #2 (predicted <2% activation) and skips low-incidence qualifier types: budget could fall to ~$0.003/chat → ~$90/mo at 30K msgs.

---

## 7. Failure / fallback

| Failure | Behavior |
|---|---|
| Qualifier extractor LLM timeout/error on a source | Skip that source's qualifiers; validator finds nothing missing for that source. Fail-safe to original prose. |
| Validator LLM timeout/error | Ship original streamed prose unchanged. Log error. |
| Rewrite LLM timeout/error | Ship original prose. Log error. Don't attempt rewrite #2 if #1 failed. |
| Rewrite #2 also produces missing qualifiers | Ship the rewrite #2 output regardless (informational re-validate, not gating). |
| Rewriter changes prose voice radically | Detected via simple length-ratio check (rewritten / original outside [0.6, 1.5]); fall back to original prose + log warning. |
| `MODE2_VERIFIER_ENABLED=false` | Skip MQPV entirely. Original streamed prose ships as today. Default state. |

---

## 8. Rollout

Production launch is months away. We won't have natural prod-traffic data for scale-back decisions, so we'll drive scale-back from synthetic bench data using `mode2-bench.js` and `mode2-trend.js`.

### Phase 1 — Build (week 1)

- Build all 4 NEW pipeline files (extract, validate, rewriter, bench)
- Schema migration on `chat_grounding_samples`
- Wire MQPV into `stream.js` behind `MODE2_VERIFIER_ENABLED` flag (default false)
- Update synthesis prompt with Rule 8

### Phase 2 — Bench (week 1-2)

- Run mode2-bench in **gen mode** to produce 1000 captured chats (fixtures: `retrieval-v2.json` × 5 reps, or freshly-generated 1000 fixtures)
- Run **mqpv mode** on those captures with full MQPV (all qualifiers, both rewrites)
- Run **mode2-trend** to produce baseline cost/effectiveness report
- Run ablation passes (skip rewrite #2; skip per-qualifier; lower trigger threshold) and compare via trend report
- Decide: which qualifiers to keep validating, whether to ship rewrite #2

### Phase 3 — Frontend (week 2)

- Add SSE `verifying` and `prose_updated` event handlers in `react-chat-app.js`
- Add visual "checking sources" indicator (subtle, attached to last message)
- Smoke-test the in-place prose-update behavior

### Phase 4 — Ship (week 2-3)

- Flip `MODE2_VERIFIER_ENABLED=true` for emersus-api in prod env
- Flip `MODE2_REWRITE_2_ENABLED` based on bench finding (likely true initially, drop if telemetry confirms)
- Per-qualifier validation flags (`MODE2_VALIDATE_POPULATION=true`, etc.) configured per bench finding
- Verify with first 100 real-prod chats via the now-active `chat_grounding_samples` sampling
- Re-run mode2-trend on real-prod data after 1 month to compare synthetic vs real

### Synthetic ≠ real distribution caveat

The bench uses LLM-generated retrieval-v2 fixtures. Real user queries skew differently — more conversational, more compound, more domain mixing. The synthetic mode_2 rate is likely an *upper bound* on prod (real users probably ask narrower questions where qualifier-preservation matters less). Bench-driven decisions should be conservative for prod. Once real traffic comes online, the same trend script reports both populations side-by-side.

---

## 9. Open knobs (deferred to implementation iteration)

- **Exact wording of Rule 8** in synthesis prompt — needs A/B against current prompt to measure preemptive mode_2 reduction
- **Validator prompt design** — open-ended K/V means the judge has to reason about which qualifiers are present and which matter; iterate during dev
- **"Verifying" UX visual** — spinner attached to last message? Shimmer over the streamed prose? Just a brief pause? (Defer to product call during Phase 3)
- **Length-ratio fallback bounds** [0.6, 1.5] — heuristic; tune from bench data
- **Hedge wording template** in rewrite mode B — "the cited source is in {population}, generalization beyond is uncertain" is one option; alternatives could be tested

---

## 10. v2 backlog (not in scope)

- **Cross-chat Redis cache** for qualifier extractions — saves ~70% extraction cost at scale once corpus warm-up reaches steady state
- **Critical-qualifier weighting** — rewrite only when high-impact qualifier types drop (population, study_design); skip low-impact (effect_size only)
- **Pre-stream structured-tool-call enforcement** — for highest-stakes claims, force structured emission rather than post-stream rewriting; drives floor closer to 0% but kills streaming UX for those claims
- **Per-domain qualifier extraction prompts** — different prompts for nutrition vs mental health vs surgical, since qualifier sets differ
- **Real-prod mode2-trend dashboard** — automate the trend report as a daily cron once production launches

---

## 11. Out of scope (explicit non-goals)

- **No mode_3 fabrication blocking.** Already at ~0% per validation. Building Anthropic-Citations-style infrastructure on OpenAI is engineering effort against a non-problem.
- **No mode_1 misattribution fix.** Smaller volume (~0.9% precision-corrected) and orthogonal mechanism.
- **No retrieval changes.** Mode_2 is a synthesis-side problem; Z2 is already shipped.
- **No streaming UX abandonment.** The post-stream rewrite path preserves streaming TTFT.
- **No new vendor.** OpenAI tool-calling + server-side validation only.

---

## 12. Implementation skeleton

| File | Status | LOC est. |
|---|---|---:|
| `api/emersus/pipeline/mode2-qualifier-extract.js` | NEW | ~120 |
| `api/emersus/pipeline/mode2-validate.js` | NEW | ~150 |
| `api/emersus/pipeline/mode2-rewriter.js` | NEW | ~150 |
| `api/emersus/pipeline/mode2-pipeline.js` (orchestrator) | NEW | ~80 |
| `api/emersus/pipeline/stream.js` | EXTEND | +30 |
| `api/emersus/pipeline/prompt.js` | EXTEND | +15 |
| `shared/react-chat-app.js` | EXTEND | +50 |
| `supabase/20260427_mode2_telemetry.sql` | NEW | ~25 |
| `scripts/eval/mode2-bench.js` | NEW | ~250 |
| `scripts/mode2-trend.js` | NEW | ~200 |
| `tests/unit/api/emersus/pipeline/mode2-validate.test.js` | NEW | ~80 |
| `tests/unit/api/emersus/pipeline/mode2-rewriter.test.js` | NEW | ~80 |
| `tests/unit/api/emersus/pipeline/mode2-qualifier-extract.test.js` | NEW | ~60 |
| `tests/unit/scripts/eval/mode2-bench-metrics.test.js` | NEW | ~80 |

Total new code: ~1370 LOC. ~3-4 days for build + ~2-3 days for bench/scale-back + ~1-2 days for frontend = **~6-9 days work**.
