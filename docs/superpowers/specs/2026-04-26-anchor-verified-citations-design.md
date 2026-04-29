# Anchor-Verified Citations (AVC) v1 — Design

**Status:** approved 2026-04-26 (brainstorm session)
**Scope:** v1 = backend research script. No prod wiring, no UI, no SSE, no DB writes.
**Goal:** measure whether the AVC verifier's signal is good enough to ship as a real grounding mechanism. Decision is made from a markdown report, not from production telemetry.

---

## 1. Why this exists

We have shipped:
- **Z2 retrieval** (HyDE + dense + zerank-2) — top-K candidates are now reliably on-topic.
- **Rule 7** prompt update — explicitly instructs the model to preserve population/dose/duration/effect-size from cited sources.
- **`chat_claim_modes`** post-hoc grader — labels each claim as mode_1 (well-grounded), mode_2 (over-generalized), or mode_3 (fabricated). 5%-sampled prod-shadow.

Current state: mode_3 fabrication is at 0%. mode_2 over-generalization sits at 57% post-Rule-7 (down from 68% baseline). Rule 7 alone is plateauing. To push mode_2 lower we need a verifier that **structurally confirms** the model preserved each numeric/study-spec specifier — not just hopes the prompt persuaded it.

Anthropic's Citations API achieves this on Claude by emitting verbatim spans the server can verify. We can't migrate to Claude (widget structured outputs + cost), but we can clone the *semantics* on top of OpenAI: extract specifier "anchors" from each claim, attribute each anchor to a specific cited source, verify the source actually backs the anchor.

v1 doesn't ship that to production. v1 measures whether the verifier signal is reliable enough that v2 *could* ship it.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Verification bar | **C** — Hybrid two-channel (atomic strict, synthesis soft) |
| 2 | Architecture pattern | **3** — Two-pass: stream prose → post-stream verify |
| 3 | Atomic claim taxonomy | **B** — Numeric + study-specification (population, intervention, comparator, outcome, dose, duration, effect-size) |
| 4 | On verification failure | **2** — Honest flag (per-anchor badge with hover-to-truth) — *deferred to v2* |
| 5 | Verification mechanism | **3** — Specifier extraction + field match |
| 6 | Field schema | **4** — Schema-free anchor matching with binary per-anchor pass/fail |
| 7 | Source scope | **2** — Full paper text when available, fallback to chunk + abstract |
| 8 | Relationship to existing systems | **2** — Augment, run alongside `chat_claim_modes` |
| 9 | Multi-source attribution | **3** — Per-anchor source attribution at extract time |
| 10 | v1 deployment | Backend-only research script. No frontend, no SSE, no DB writes. |
| 11 | Sample source | **B** — Generate fresh by running prod chat pipeline against fixtures |
| 12 | Sample size | 1000 chats |

---

## 3. Architecture

```
                                 ┌─────────────────────────────────────┐
                                 │  scripts/eval/anchor-verifier-bench │
                                 │              .js                    │
                                 └────────────────┬────────────────────┘
                                                  │
        ┌─────────────────────────────────────────┼─────────────────────────────────┐
        │                                         │                                 │
        ▼                                         ▼                                 ▼
┌──────────────────┐              ┌──────────────────────────┐         ┌────────────────────────┐
│ load 1000 prompts│              │  for each prompt:        │         │  Claude judge audit    │
│ from fixtures    │              │    runChatWorkflow()     │         │  on ~50 random         │
│ (retrieval-v2 +  │              │    → captured chat:      │         │  "failed" anchors      │
│  generated)      │              │      Q, sources, answer  │         │  → false-reject rate   │
└──────────────────┘              └────────────┬─────────────┘         └──────────┬─────────────┘
                                               │                                  │
                                               ▼                                  │
                                  ┌──────────────────────────┐                    │
                                  │  extractAnchors(claim,   │                    │
                                  │    sources)              │ ◄── NEW: extension │
                                  │  → per-claim anchors:    │     of claim-modes │
                                  │  [{text, attributed_src, │                    │
                                  │    source_quote_or_null, │                    │
                                  │    scope_used}]          │                    │
                                  └────────────┬─────────────┘                    │
                                               │                                  │
                                               ▼                                  │
                                  ┌──────────────────────────┐                    │
                                  │  resolveSourceScope(srcId│                    │
                                  │    ) ◄── NEW helper      │                    │
                                  │  returns chunk +         │                    │
                                  │  full_text + abstract    │                    │
                                  └────────────┬─────────────┘                    │
                                               │                                  │
                                               ▼                                  │
                                  ┌──────────────────────────┐                    │
                                  │  verify per-anchor:      │                    │
                                  │    1. substring fastpath │                    │
                                  │    2. judge fallback     │                    │
                                  │    → pass/fail per anchor│                    │
                                  └────────────┬─────────────┘                    │
                                               │                                  │
                                               └────────────┬─────────────────────┘
                                                            │
                                                            ▼
                                            ┌─────────────────────────────────┐
                                            │  emit:                          │
                                            │   results/anchor-bench-{ts}.md  │
                                            │   results/anchor-bench-{ts}.json│
                                            └─────────────────────────────────┘
```

---

## 4. Components

### 4.1 `scripts/eval/anchor-verifier-bench.js` (new, ~250 LOC)

Entry point. Responsibilities:

- Load 1000 prompts (see §5).
- For each prompt, invoke `runChatWorkflow()` from `api/emersus/workflow.js` directly (no HTTP). Captures `{question, sources, answer_text, claim_modes_output}`.
- For each captured chat, call the new `extractAnchors()` (§4.2) to get per-claim anchors.
- Run the verifier (§6) over each anchor.
- Aggregate metrics. Emit markdown + JSON report (§7).
- Select ~50 random "failed" anchors via simple random sampling without replacement across the full FAIL set, format as a Claude-as-judge audit batch, write to a separate file (`anchor-bench-{ts}-audit.jsonl`) for scripted Claude review. Stratification by `kind_hint` is deferred to v2 if v1 audit shows kind-specific FRR variance.

Concurrency: 4–8 chats in flight at once (limited by OpenAI rate limits). Total wall clock ~30 min for 1000 chats.

### 4.2 `api/emersus/pipeline/claim-modes.js` (extension, ~80 added LOC)

Already does atomic-claim extraction + mode classification. Add a parallel anchor-extraction emission:

```js
export async function extractClaimModesAndAnchors({ answer, sources, ... }) {
  // existing claim-modes work
  // PLUS: for each atomic claim, emit anchors
  return {
    claims: [
      {
        claim_text: "...",
        cited_source_ids: [2, 4],
        mode: "mode_2",          // existing
        qualifier_diff_json: ..., // existing
        anchors: [                // NEW
          {
            text: "5g/day",
            kind_hint: "dose",
            attributed_source_id: 2,
            source_quote: "creatine 5 g per day",
            scope_used: "chunk",
            verify_method: "substring",
          },
          { ... },
        ],
      },
    ],
  };
}
```

The new function is reusable from both v1 (the bench) and a future prod path. v1 calls it from the bench only; v2 (deferred) wires it into `workflow.js`.

### 4.3 `api/emersus/pipeline/anchor-source-scope.js` (new, ~80 LOC)

For a given source_id, build the scope payload the verifier searches:

```js
export async function resolveSourceScope(sourceId, fallbackChunk) {
  // returns {
  //   chunk:     string,        // always present (the chunk that was retrieved)
  //   full_text: string | null, // research_articles.full_text if has_full_text=true
  //   abstract:  string | null, // research_articles.abstract
  // }
}
```

Single Supabase select for `(abstract, full_text, has_full_text)` per unique pmid in the chat. Cached within a single chat's verification pass to avoid duplicate fetches across multiple anchors citing the same source.

### 4.4 `api/emersus/pipeline/anchor-verify.js` (new, ~120 LOC)

Pure functions, no I/O. Given an anchor and the resolved source scope:

```js
export function verifyAnchor(anchor, sourceScope) {
  // Returns { result: "PASS_VERBATIM" | "PASS_JUDGED" | "FAIL", scope_actually_matched, judge_response }
  //
  // Algorithm:
  //   1. If anchor.source_quote is null → FAIL (extractor couldn't find backing)
  //   2. Try substring match against all three scopes (chunk, full_text, abstract)
  //      with normalization (case, whitespace, unit-format). The first scope that
  //      contains a normalized match wins; record which scope actually matched
  //      (may differ from extractor's claimed scope_used).
  //   3. If no substring match in any scope, escalate to LLM judge
  //      (gpt-5.4-mini single call: "Does this source explicitly state X?")
  //   4. Return PASS_VERBATIM, PASS_JUDGED, or FAIL with the metadata.
}

export function normalizeForSubstring(text) {
  // lowercase, collapse whitespace, unify number/unit formats:
  //   "5 g" / "5g" / "5 grams" → "5g"
  //   "8 wk" / "8 weeks" / "eight weeks" → "8wk"
}
```

The verifier independently re-searches all three scopes rather than trusting the extractor's `scope_used` claim — this catches the case where the extractor hallucinated which scope it found the quote in.

---

## 5. Sample generation (decision: B)

1000 prompts, generated fresh by running the prod chat pipeline against `scripts/eval/fixtures/retrieval-v2.json`. The fixture set already covers 200 stratified queries; we expand to 1000 by:

- 200 fixtures × 5 reps (sampling temperature variance) — covers within-query variance
- OR: regenerate 1000 fresh fixtures via `scripts/eval/generate-fixtures.js` (existing, ~$0.50)

Recommendation: **fresh 1000 fixtures.** Within-query variance is less interesting than corpus coverage. The existing generator stratifies across MeSH topics, query difficulty, format, and population angle — exactly the dimensions we want anchor-verifier behavior to be characterized on.

Cost to generate sample: ~$1 in chat costs (gpt-5.4-mini, 1000 chats with HyDE+zerank).

Output of the sample-generation pass: `scripts/eval/results/anchor-bench-source-{ts}.json` containing the 1000 captured `(question, sources, answer)` triples. The verifier pass reads from this file, so re-runs of the verifier don't re-incur chat costs.

---

## 6. Anchor extraction + verification

### 6.1 Anchor extraction prompt (gpt-5.4-mini, single call per chat)

Input:
- `answer_text` — full chat response with `citesrcN` markers
- `sources` — array of `{id, chunk_text, abstract, full_text_excerpt}` for each cited source

Output (structured JSON via `text.format` strict schema):

```json
{
  "claims": [
    {
      "sentence": "5 g/day creatine increased 1RM by 7% in trained men over 8 weeks citesrc2.",
      "cited_source_ids": [2],
      "anchors": [
        {
          "text": "5 g/day",
          "kind_hint": "dose",
          "attributed_source_id": 2,
          "source_quote": "creatine 5 g per day for 8 weeks",
          "scope_used": "chunk"
        },
        {
          "text": "7%",
          "kind_hint": "effect_size",
          "attributed_source_id": 2,
          "source_quote": "1RM bench press increased by 6.8%",
          "scope_used": "chunk"
        },
        {
          "text": "trained men",
          "kind_hint": "population",
          "attributed_source_id": 2,
          "source_quote": "resistance-trained men aged 20-25",
          "scope_used": "abstract"
        },
        {
          "text": "8 weeks",
          "kind_hint": "duration",
          "attributed_source_id": 2,
          "source_quote": "creatine 5 g per day for 8 weeks",
          "scope_used": "chunk"
        }
      ]
    }
  ]
}
```

Anchor `kind_hint` is informational only — extractor's guess at category. Verifier doesn't enforce or use it for v1; it's stored for analytics ("which kinds fail most often?").

### 6.2 Verification (deterministic, per anchor)

```
verify(anchor):
  if anchor.source_quote == null:
    return FAIL  // extractor couldn't find backing — v1 trusts this verdict
  for scope in [chunk, full_text, abstract] of attributed_source_id:
    if normalized(anchor.source_quote) is substring of normalized(scope):
      return PASS_VERBATIM (record which scope actually matched)
  // Substring failed on all three scopes; escalate to judge
  judged = judge("Does this source explicitly state '{anchor.text}'? Source: {chunk + full_text + abstract}.")
  return PASS_JUDGED or FAIL based on judge response
```

Note: verifier re-checks all three scopes rather than trusting the extractor's `scope_used` claim. The extractor's claim is informational; the verifier's independent search is authoritative.

Note: v1 does NOT do an extractor-recall check. If the extractor returns `source_quote: null` for an anchor, the verifier accepts that as FAIL without independently scanning the source for the anchor text. The Spearman correlation against `chat_claim_modes.mode_2` partially measures recall failures — if the extractor systematically misses anchors that ARE backed, correlation tanks and we'll see it in the report. If correlation is weak, v2 adds a secondary recall-check pass.

Normalization for substring path:
- Lowercase
- Collapse whitespace
- Unify number formats: "5 g" / "5g" / "5 grams" → "5g"
- Unify time units: "8 wk" / "8 weeks" / "eight weeks" → "8wk"
- Number-words: "eight" → "8", "twelve" → "12", up to twenty
- No further stemming in v1 — added in v2 if FRR is too high

### 6.3 Reconciling decisions 5 (specifier extraction + field match) and 6 (schema-free)

Decision 5 (extract specifier facts, match field-by-field) and decision 6 (schema-free, binary per-anchor) appear in tension. The reconciliation in this spec:

- **Decision 5's "specifier extraction"** is implemented by the extractor LLM identifying anchor phrases. The extractor categorizes each via `kind_hint` (dose/duration/population/etc.) but the `kind_hint` is informational only — it's stored for analytics ("what kinds fail most?") but the verifier doesn't enforce or use it.
- **Decision 6's "schema-free, binary"** governs match logic: for each anchor, the only question is "is the source_quote present in the source's content?" Yes → PASS, no → FAIL. There's no field-level merge step.

So the system extracts as if there's a schema (kind_hint) but verifies as if there isn't (presence-only).

Per-claim badge:
- All anchors PASS → `green`
- Any anchor FAIL → `red`
- Zero anchors extracted → `neutral` (synthesis-class claim, not verified by AVC; falls back to existing `chat_claim_modes` mode)

---

## 7. Report format

Two files:
- `scripts/eval/results/anchor-bench-{timestamp}.md` — human-readable summary
- `scripts/eval/results/anchor-bench-{timestamp}.json` — full per-claim, per-anchor records for downstream analysis

### 7.1 Markdown report sections

**Headline metrics**

| Metric | Value |
|---|---:|
| Total chats run | 1000 |
| Total atomic claims emitted | _ |
| Total anchors extracted | _ |
| Anchors PASS (verbatim) | _ (_%) |
| Anchors PASS (judged) | _ (_%) |
| Anchors FAIL | _ (_%) |
| Claims with ≥1 failed anchor | _ (_%) |
| Claims with no anchors (synthesis-class) | _ (_%) |

**Per-mode breakdown** (cross-check against existing `chat_claim_modes`)

| Existing mode | Anchor-fail rate | Spearman ρ vs binary anchor-fail |
|---|---:|---:|
| mode_1 (well-grounded) | _ | — |
| mode_2 (over-generalized) | _ | — |
| mode_3 (fabricated) | _ | — |
| Overall correlation (mode_2 vs anchor-fail, claim-level) | — | _ |

**Source scope distribution**

| Scope used to find backing | Count | % of passing anchors |
|---|---:|---:|
| chunk | _ | _% |
| full_text | _ | _% |
| abstract | _ | _% |

**Latency + cost**

| Phase | p50 | p95 |
|---|---:|---:|
| extraction LLM call | _ ms | _ ms |
| substring fast-path | _ ms | _ ms |
| judge fallback (when invoked) | _ ms | _ ms |
| total per chat | _ ms | _ ms |
| extractor cost per chat | $_ | — |
| extrapolated cost @ 30K chats/mo | $_/mo | — |

**False-rejection audit**

| Sampled "failed" anchors | 50 |
|---|---:|
| Claude-judged false rejections | _ |
| Estimated FRR | _% (95% CI: _-_%) |

**Per-kind anchor-fail breakdown**

| anchor.kind_hint | Total | FAIL | FAIL% |
|---|---:|---:|---:|
| dose | _ | _ | _% |
| duration | _ | _ | _% |
| effect_size | _ | _ | _% |
| population | _ | _ | _% |
| intervention | _ | _ | _% |
| comparator | _ | _ | _% |
| outcome | _ | _ | _% |
| (other) | _ | _ | _% |

### 7.2 JSON shape

```json
{
  "run_id": "anchor-bench-2026-04-27T...Z",
  "n_chats": 1000,
  "config": { "extractor_model": "gpt-5.4-mini", "judge_model": "gpt-5.4-mini" },
  "headline": { ... },
  "per_chat": [
    {
      "question": "...",
      "claims": [
        { "sentence": "...", "anchors": [{ ..., "verify_result": "PASS_VERBATIM" }] }
      ]
    }
  ],
  "audit_subset": [ /* 50 random FAIL anchors selected for Claude review */ ]
}
```

---

## 8. Ship-decision rule

Wire the prod path (v2) iff **all three** hold:

1. **False-rejection rate ≤15%** on the Claude-judged audit subset
2. **Spearman ρ ≥ 0.4** between anchor-fail-rate and existing `chat_claim_modes.mode == mode_2` at claim level (the verifier should agree with the existing grader on what's broken)
3. **Per-chat extractor cost ≤$0.002** (so full deployment fits ~$60/mo at 30K chats/mo)

If any fails:
- High FRR → iterate the extractor prompt; consider adding a "no anchors needed if claim is general" escape; tune the substring normalization.
- Low correlation → the verifier is detecting something different from mode_2; possibly valid signal (mode_1 anchor-fails = false rejections; mode_3 → still 0% so untestable) but not the targeted improvement.
- High cost → switch to substring-only (no judge fallback) and re-measure; if substring-only is too brittle, consider precomputed paper-facts at ingestion time.

---

## 9. v2 backlog (not in v1)

- Wire `extractClaimModesAndAnchors` into the prod chat path (replaces the existing `claim-modes.js` call site)
- Add `anchors_json jsonb` column to `chat_claim_modes`
- Extend SSE `event.grounding` payload with per-claim `anchors`
- Extend `shared/emersus-renderer.js` to render per-anchor badges on `citesrcN` markers
- Hover surface showing matched source quote (PASS) or "no backing found in source N for: 'anchor_text'" (FAIL)
- Decide sampling cadence at deployment (every chat vs hybrid substring-only / sampled-judge)

## 10. v3 backlog (further out)

- Precomputed paper-facts at ingestion time via Gemini batch (~$30 one-shot for 3.3M corpus); eliminates per-chat full-paper extraction cost
- Pre-emit verification — feed verifier output back as a regenerate trigger when red-anchor density crosses a threshold
- Subsume `chat_claim_modes` mode classification into anchor-failure-pattern taxonomy (single source of truth)

---

## 11. Implementation skeleton

| File | Status | LOC est. |
|---|---|---:|
| `scripts/eval/anchor-verifier-bench.js` | NEW | ~250 |
| `api/emersus/pipeline/claim-modes.js` | EXTEND (add `extractClaimModesAndAnchors`) | +80 |
| `api/emersus/pipeline/anchor-source-scope.js` | NEW | ~80 |
| `api/emersus/pipeline/anchor-verify.js` | NEW (substring + judge logic, pure functions) | ~120 |
| `tests/unit/api/emersus/pipeline/anchor-verify.test.js` | NEW | ~80 |
| `tests/unit/api/emersus/pipeline/anchor-source-scope.test.js` | NEW | ~50 |

Total new code: ~660 LOC. No DB migration. No prod path changes. Bench script is the ONLY entry point.

---

## 12. Open knobs / risks

**Extractor reliability.** The extractor is a single LLM call per chat. If it occasionally fails to extract anchors that ARE in the claim (recall failure), we'd under-report mode_2 problems and miss real issues. Mitigation: the false-rejection audit catches cases where the extractor said "no backing" but Claude says it's there. We don't separately measure recall failure (extractor returning empty anchor list when anchors should exist), but the Spearman correlation against `chat_claim_modes.mode_2` partially measures this — if recall is bad, correlation tanks.

**Judge fallback creep.** If the substring fast-path catches <30% of anchors, the judge fallback dominates cost. Substring normalization needs to be robust enough that verbatim quotes pass deterministically; otherwise we're just paying judge cost for everything.

**Source scope mismatch.** When the extractor says `scope_used: "chunk"` but the source_quote isn't actually in the chunk (extractor hallucinated the scope), the verifier substring check will fail. This shows up as an anchor FAIL even though the substring exists in `full_text`. Mitigation: verifier independently re-checks the source_quote against ALL three scopes, not just the one the extractor claimed.

**Bias from synthetic fixtures.** Generated fixtures are biologically asking generated questions — there's a representation gap from real prod traffic. Headline metrics will be in the right order of magnitude but absolute values may shift. Mitigation: once v2 ships, the prod-path metrics override these v1 numbers.

---

## 13. Out of scope (explicit non-goals)

- **No frontend changes.** No SSE event extension. No badge rendering. No client state.
- **No DB writes.** Bench script outputs files only; nothing inserted into `chat_claim_modes`, `chat_grounding_samples`, or any other prod table.
- **No prod chat path modification.** The new `extractClaimModesAndAnchors` function exists but isn't called from `workflow.js` in v1.
- **No regenerate-on-failure logic.** Verifier observes; doesn't intervene.
- **No analytics dashboard.** Markdown report is the deliverable.
- **No automated CI integration.** Bench runs are manual, on demand.
