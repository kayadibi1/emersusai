# Grounding Mode Classification — Design

**Date:** 2026-04-26
**Status:** Design approved, pending implementation plan
**Scope:** Measurement only. Prevention and runtime blocking are explicit non-goals for this spec.

## Problem

Today's grounding system enforces that every factual claim sentence carry an inline `[N]` marker pointing to a real retrieved source (`api/emersus/pipeline/grounding-verifier.js`). It does **not** verify that the cited source semantically supports the claim. This admits four distinct failure modes that look identical in current logs (all show `status: grounded, cited_fraction: 1.0`):

- **Mode 1 — Mis-attribution.** Claim is supported by some source in the retrieval set, but the model cited a different `[N]`. Underlying fact is real; attribution is wrong.
- **Mode 2 — Over-generalization / partial support.** Claim's cited source supports the gist but the answer dropped scope qualifiers (population, dose, duration), or the cited source only partially supports the claim with no other source fully supporting. Technically grounded; effectively misleading.
- **Mode 3 — Fabrication-with-citation.** No retrieved source supports or contradicts the claim. Model filled in from training data and attached `[N]` to satisfy the contract.
- **Mode 4 — Contradicted-with-citation.** Cited source actively contradicts the claim. Worst-case failure — most damaging because the citation lends false authority to a wrong assertion. Discovered during second-pass review (existing fidelity grader's `contradicted` verdict already separates this case; the original taxonomy missed it).

These four have very different remediation paths. We cannot decide where to invest until we know the rate of each. This spec designs a measurement system that distinguishes them with calibrated reliability.

## Existing infrastructure we extend, not rebuild

Reading `scripts/grade-grounding-samples.js` shows the existing prod-shadow grader already classifies cited claims into `supported | weak | decoy | contradicted` via gpt-5.4. That maps to: `supported ≈ correct`, `weak ≈ mode_2`, `decoy ≈ mode_3`, `contradicted ≈ mode_4`. **What's actually missing is mode_1 detection** — the existing grader only scores cited sources, never uncited ones, so it cannot detect "claim is supported but you cited the wrong paper."

This spec's net delta on the existing grader:

1. **Atomic-claim extraction** (replaces regex `extractCitedClaims` in `grade-grounding-samples.js:58` with LLM extraction that splits multi-claim sentences and surfaces uncited factual claims).
2. **Score uncited sources too** (not just cited) — required to detect mode_1.
3. **Qualifier-diff sub-task** within the per-claim judge call (sharpens mode_2 detection — distinguishes "qualifier dropped" from "wrong paper cited").
4. **New `chat_claim_modes` table** for per-claim per-source storage that the existing flat `grader_result` jsonb can't cleanly express.
5. **Pre-deployment prod sampling enablement.** `chat_grounding_samples` is currently empty — `GROUNDING_SAMPLE_RATE` is unset in prod. Sampling must be enabled before the grader has anything to grade.

## Goals

- Per-claim classification into `{correct, mode_1_misattribution, mode_2_overgen, mode_3_fabrication, mode_4_contradicted, no_marker}`.
- Calibrated against human ground truth before any number is reported as fact.
- Runs offline on the existing 200-fixture eval set (first signal) and as an extension of the existing prod-shadow grader (ongoing trend).
- No new cost on user-facing requests; cost confined to existing offline + sampled prod-shadow paths.

## Non-goals

- Prevention (changing the generation contract to verifiable quotes). Deferred — decision driven by the rates this spec produces.
- Runtime blocking (regenerate-before-stream when fabrication detected). Deferred for the same reason.
- Replacing existing grounding-verifier marker-presence checks. This system runs *alongside* the existing verifier, not instead of it.

## Section 1 — Algorithm

### 1.1 Pipeline per answer

1. **Atomic-claim extraction.** Single gpt-5.4 call per answer. Replaces the regex `isFactualClaim()` + `extractCitedClaims` heuristics. Returns `[{claim_text, cited_ids: [int]}]`. One factual claim per output item — multi-claim sentences ("creatine improves 1RM and reduces fatigue [3,7]") are split into atomic claims, each carrying the citation set of its source sentence. Procedural advice and conversational text must NOT be emitted as claims (calibration Pass A measures this directly).
2. **Per-claim batched entailment.** One gpt-5.4 call per claim, structured-output mode. Prompt scores all retrieved sources at once and surfaces both qualifier diffs and contradictions. Sketch (real prompt is iterated during calibration):
   > Given the claim and these N retrieved sources, return for each source:
   > - `direction ∈ {supports, contradicts, unrelated}`
   > - `support_score ∈ {0, 1, 2}` — applies only when `direction=supports`. 0 = no support, 1 = partial/qualified, 2 = full direct
   > - `scope_qualifiers_in_source_missing_from_claim` — list, populated when `direction=supports` (e.g., "trained men only", "over 8 weeks", "> 5 g/day")
3. **Source content scored against:** `excerpt + title` of each retrieved source object. Verified against real `chat_grounding_samples.sources_json` rows — schema is `{title, journal, publication_year, publication_type, url, similarity, is_title_only_match, excerpt}`. The `excerpt` field is the chunk text, no separate abstract field exists. When `is_title_only_match=true`, only `title` is scored (this is the existing v4 retrieval signal that the row matched on title only).
4. **Bucket assignment by precedence** (worst wins, to avoid undercounting):
   - **mode_4_contradicted** — at least one cited source has `direction=contradicts`. Worst-case; takes precedence over everything else because false authority is more damaging than absence of support.
   - **mode_3_fabrication** — no source has `direction=supports` with `support_score ≥ 1` AND no source has `direction=contradicts`. Pure topical absence.
   - **mode_1_misattribution** — best uncited `support_score = 2` AND best cited `support_score < 2`. Right paper exists in the set, model cited the wrong one.
   - **mode_2_overgen** — best cited `support_score = 1`, OR (best cited `support_score = 2` AND `qualifier_diff` non-empty). Captures both the partial-support case and the full-support-with-dropped-qualifiers case. Closes the fall-through gap from the original spec.
   - **correct** — best cited `support_score = 2` AND `qualifier_diff` empty.
   - **no_marker** — claim has no `[N]`. Row still inserted with `mode='no_marker'` and source scores still computed, so we can also measure whether unmarked claims happen to be unsupported.
5. **Tracked but not bucketed: when both cited *and* uncited sources score 2.** Claim is `correct` but `alternate_supporting_sources` (jsonb) records the uncited 2-scorers. Lets us measure attribution quality (did the model pick a sub-optimal source even when its choice was technically valid?) independently, without penalizing it as mis-attribution since user trust is intact.

### 1.2 Multi-citation handling

A sentence with `[3, 7]` is decomposed into atomic claims first. Each atomic claim carries the citation set of its source sentence. The bucketing rule treats "cited" as "is in the citation set," so a 2-source citation passes mode_1 only if *neither* cited source scores 2 while some uncited source does.

### 1.3 Cost model

- 1 extraction call + ~5 classification calls per answer.
- gpt-5.4 at ~$0.001/call short context = ~$0.006/answer.
- 200-fixture offline eval ≈ $1.20/run.
- Prod-shadow cost depends on actual sample volume × `GROUNDING_SAMPLE_RATE`. Real number is verified in step 1 of rollout (read recent `chat_grounding_samples` insert rate) before deploying step 10. Initial budget cap: $200/month — revisit sample rate or batching if real volume pushes higher.

### 1.4 Storage

New table `chat_claim_modes` (migration in `supabase/migrations/`):

| column | type | note |
|---|---|---|
| `id` | bigserial PK | |
| `sample_id` | bigint FK → `chat_grounding_samples.id` | one-to-many |
| `claim_text` | text | atomic claim |
| `cited_source_ids` | int[] | from the answer |
| `source_scores_json` | jsonb | `[{source_index, direction, support_score, qualifiers_missing}]` for all retrieved sources |
| `mode` | text check in (correct, mode_1_misattribution, mode_2_overgen, mode_3_fabrication, mode_4_contradicted, no_marker) | |
| `qualifier_diff_json` | jsonb | qualifier list for the cited source (used by mode_2 / correct) |
| `alternate_supporting_sources` | jsonb | uncited sources scoring 2 when cited also scores 2 — for attribution-quality tracking without bucket penalty |
| `judge_model` | text | e.g., `gpt-5.4` |
| `judge_prompt_version` | text | matches a constant in `claim-modes.js`, e.g., `claim-extraction-v1`, `claim-classify-v1`. Bumped on every prompt edit |
| `grading_status` | text check in (ok, judge_error, malformed_json, partial) | how the grading attempt resolved |
| `created_at` | timestamptz default now() | |

Aggregations roll up to per-answer mode rates → daily/weekly trends in an extended `scripts/grounding-trend.js`. Aggregations exclude rows where `grading_status != 'ok'`.

Idempotency: re-grading is allowed by inserting new rows with bumped `judge_prompt_version`. Old rows are kept for historical comparison rather than overwritten. Trend reports filter to the latest version per sample.

### 1.5 Error handling and partial results

- Each judge call wrapped in try/catch with one retry on transient failures (timeout, 5xx, rate limit). On second failure, the row is inserted with `grading_status='judge_error'` and `mode=null` so the per-sample retry pass can find it later.
- Malformed JSON output (judge returns prose instead of structured data) recorded as `grading_status='malformed_json'`. Same retry policy.
- Partial results within an answer: if 3 of 5 claims grade successfully and 2 fail, the 3 successes are persisted, the 2 failures recorded as `judge_error` rows. Per-answer aggregations require all-or-nothing flag (`answer_fully_graded` is computed = "no error rows for this sample_id and current judge_prompt_version").
- Idempotency check: grader skips claims where a row already exists for `(sample_id, claim_text, judge_prompt_version)` AND `grading_status='ok'`. Failed rows can be reattempted.

## Section 2 — Calibration

No mode rate is reported as fact until calibration gates pass.

### 2.1 Pass A — Extraction calibration

- 30 answers sampled from the offline eval result file `scripts/eval/results/grounding-eval-full-100-v2-2026-04-23T20-23-35-074Z.json` (since `chat_grounding_samples` is currently empty — see Section 3.3 step 5). Stratified across answer length and topic. Re-run on real prod samples after sampling is enabled in step 12 if extraction needs further calibration.
- Hand-label every factual claim sentence (~150 claims expected).
- Run `extractAtomicClaims` on the same answers.
- Metrics: precision, recall, F1 of extracted-vs-hand-labeled claim sets.
- **Gate: F1 ≥ 0.85.** If below, iterate the extraction prompt and re-run. No mode metrics until extraction passes.

### 2.2 Pass B — Mode-classification calibration

- 50 (claim, retrieved sources) tuples total: **40 natural + 10 synthetic mode_3.**
- Natural set: drawn from existing offline eval results (same source as Pass A), stratified across answer length and topic. Modes correct/1/2/4 will populate organically.
- Synthetic mode_3 set (method A — retrieval-mismatch):
  1. Pick 10 specific factual prompts (e.g., creatine loading protocol, beta-alanine dosing).
  2. For each, force a deliberately off-topic retrieval (bad query rewrite or topic-mismatched embedding).
  3. Generate the answer with the misaligned retrieval.
  4. Manually verify each is genuinely mode_3 (claim asserted, marker present, no support in the misaligned retrieval set, model did not refuse or self-label as inference).
  5. Discard and re-roll any that came out clean.
- **Why method A and not source-removal:** validates the judge against the *real* failure pattern (model writes plausible-looking citation when retrieval misses), not a synthetic bookkeeping check.
- Mode_1 examples come from the natural 40. If natural mode_1 count is < 5 after labeling, calibration report flags low-N rather than synthesizing.

### 2.3 Labeling workflow

- Final labels are **Sidar's**, not the LLM's. The judge under test is gpt-5.4; using another LLM as ground truth measures inter-LLM agreement, not correctness.
- claude-opus-4-7 acts as **labeling assistant** (productivity multiplier):
  - Pre-labels all 50 tuples with reasoning + confidence per item.
  - Sidar reviews. High-confidence-and-agree → accept fast (~30 of 50, ~30 sec/item).
  - Low-confidence or disagree → Sidar relabels from scratch (~20 × 2–3 min = ~45 min).
- Total labeling time: ~1 hour (vs ~3 hours cold).
- Free byproduct: claude-vs-Sidar agreement score. If high across multiple recalibrations, future runs can lean more on the assistant.

### 2.4 Calibration metrics & gates

- Confusion matrix: judge mode × Sidar mode.
- Per-mode F1: `correct`, `mode_1`, `mode_2`, `mode_3`, `mode_4`.
- Cohen's kappa overall.
- **Gates: per-mode F1 ≥ 0.75 AND kappa ≥ 0.6 — applied to any mode with ≥ 5 calibration examples.** Modes with < 5 examples are reported with low-confidence caveat rather than blocking ship; calibration set is supplemented at next refresh.
- Report **separates synthetic mode_3 F1 from organic mode_3 F1** so we know which we trust.
- Cost summary table reflects this: production rate of any mode below the 5-example threshold ships with a flag, not a blocker.

### 2.5 Calibration failure modes

If gates fail:
1. Iterate judge prompt (most common fix — e.g., explicit qualifier-comparison instruction for mode_2).
2. Switch to a larger judge model.
3. Decompose mode_2 into a separate qualifier-extraction-and-diff call.

Re-calibrate on every judge-prompt change, judge-model bump, or quarterly. Calibration set versioned at `scripts/eval/fixtures/grounding-modes-calibration.v1.json` for reproducibility.

## Section 3 — Code layout & rollout

### 3.1 New code

- `api/emersus/pipeline/claim-modes.js` — single entry point used by both offline eval and prod-shadow grader. Two functions:
  - `extractAtomicClaims(answerText)` → claims + cited IDs
  - `classifyClaimModes(claims, retrievedSources)` → per-claim mode + scores + qualifier diffs
- `scripts/eval/calibration/`
  - `prelabel-extraction.js` — runs claude-opus-4-7 on 30 raw answers; writes `extraction-prelabels.v1.json`.
  - `prelabel-classification.js` — runs claude-opus-4-7 on 50 tuples; writes `classification-prelabels.v1.json`.
  - `score-calibration.js` — given final human labels, produces F1 / kappa / confusion-matrix report. Hard-fails if gates not met.
- `scripts/eval/fixtures/grounding-modes-calibration.v1.json` — versioned calibration set.
- `supabase/migrations/<timestamp>_chat_claim_modes.sql` — table per Section 1.4.

### 3.2 Extended code

- `scripts/eval/grounding-eval.js` — after each answer, call `claim-modes.js`, append per-claim modes to JSON + roll up to per-answer rates in MD output.
- `scripts/grade-grounding-samples.js` — after existing per-sample grading, also call `claim-modes.js` and insert into `chat_claim_modes`.
- `scripts/grounding-trend.js` — extend to report daily and weekly mode rates alongside `cited_fraction`.

### 3.3 Rollout order (= implementation plan order)

1. **Verify input shape.** Sample real `chat_grounding_samples.sources_json` rows once they exist (post-step 12) to confirm the `{title, journal, publication_year, publication_type, url, similarity, is_title_only_match, excerpt}` schema still holds (this matches what was observed in `scripts/eval/results/grounding-eval-full-100-v2-2026-04-23T20-23-35-074Z.json`). If schema drifts, lock the algorithm to an extracted helper rather than inline field access.
2. SQL migration for `chat_claim_modes`.
3. `claim-modes.js` module + unit tests. Includes named prompt-version constants (e.g., `EXTRACTION_PROMPT_V1`, `CLASSIFY_PROMPT_V1`), exported and written to the DB row alongside the verdict.
4. Pre-labeling scripts.
5. Source 30 prod answers — but **prod sample table is currently empty** (`GROUNDING_SAMPLE_RATE` unset in `~/app/.env`). For Pass A, use existing `grounding-eval-full-100-v2-2026-04-23T20-23-35-074Z.json` answers + their evidence as labeling source. Re-run on real prod samples after step 11 if needed.
6. Run pre-label on 30 answers → Sidar reviews → final extraction calibration set saved.
7. Pass A scoring; iterate extraction prompt until F1 ≥ 0.85. Bump `EXTRACTION_PROMPT_V1` → `V2` on every prompt change.
8. Build synthetic mode_3 set (10 prompts via retrieval-mismatch).
9. Run pre-label on 40 natural + 10 synthetic = 50 tuples → Sidar reviews → final classification calibration set saved.
10. Pass B scoring; iterate judge prompt until per-mode F1 ≥ 0.75 (where N ≥ 5) and kappa ≥ 0.6.
11. Wire into `grounding-eval.js` → run on 200-fixture set → **first real numbers**, write up briefly.
12. **Enable prod sampling.** Set `GROUNDING_SAMPLE_RATE=0.05` (5% sample rate as a starting point — adjustable based on volume) in `~/app/.env`, `pm2 restart emersus-api --update-env`, verify samples land in `chat_grounding_samples`.
13. Wire into prod-shadow grader (extend `scripts/grade-grounding-samples.js`) + trend report.
14. Deploy grader cron. Monitor for one week.
15. Ship a short report: rates per mode + concrete examples per mode. This artifact informs whether prevention is the right next investment.

### 3.4 Stop conditions

The "prevention" payoff that the rates inform is verifiable-quote-style enforcement. That technique directly addresses modes 1, 3, and 4 (a quote either matches the cited source's text or it doesn't). Mode 2 (qualifier-drop) requires a different remediation — prompt-side instruction to keep population/dose/duration qualifiers — and is informed by these rates separately.

- **After step 11** (offline numbers): if mode_3 + mode_4 combined < 1% and mode_1 < 5%, verifiable-quote prevention work is likely overkill. Project succeeds with measurement-only. Mode_2 rate is reported separately and informs prompt-tuning rather than architecture work.
- **After step 15** (prod numbers): same gates against prod data. If rates are higher than offline, prevention work earns its slot.

## Section 4 — Expected calibration outcomes (honest forecast)

The four modes are not equally separable. Realistic forecast per mode, given gpt-5.4 as judge and ~50 calibration tuples:

| Mode | Forecast separability | Why |
|---|---|---|
| **mode_3 fabrication** | Clean. Likely F1 > 0.85. | "No source on the topic at all" is a coarse judgment LLMs do well; existing grader's `decoy` verdict already validates this. Synthetic set ensures sufficient N. |
| **mode_4 contradicted** | Clean. Likely F1 > 0.80. | Direction (supports vs contradicts) is sharper than degree (1 vs 2). Existing grader already produces `contradicted` verdicts; we're surfacing them, not inventing. |
| **mode_1 misattribution** | Clean *when* uncited score is clearly > cited score. Likely F1 ≥ 0.75. | Discriminative when the right paper is dramatically better; degraded when scores are close (the both-score-2 case is handled by `alternate_supporting_sources`, removing it from mode_1). |
| **mode_2 overgen** | **Noisiest.** F1 may sit near 0.70 in v1. | Score=1 vs score=2 boundary, plus qualifier-diff judgment, are both fuzzy. May require a dedicated qualifier-diff sub-prompt as a v2 mitigation. |
| **correct** | Clean as the residual. | Whatever doesn't trip a failure mode. |

Hard-baked safeguards against false-precision:
- We do not ship any mode rate whose calibration F1 < 0.75. The report says "mode_X rate is N% (calibrated, F1=0.82)" or "mode_X rate not reportable — calibration failed."
- We separately report synthetic-mode_3 F1 vs natural-mode_3 F1.
- Any mode with calibration N < 5 ships with a low-confidence flag, not a hard number.
- If mode_2 fails calibration, we ship rates for {correct, mode_1, mode_3, mode_4} with mode_2 folded into "ungraded mid-range" until v2.

This is the realistic deliverable, not a guarantee that all four modes will be cleanly separable on first try.

## Cost summary

| Item | One-time | Recurring |
|---|---|---|
| Calibration runs | ~$2 | ~$2 per recalibration (quarterly) |
| Offline eval (200 fixtures) | ~$1.20/run | ~$5/month at weekly cadence |
| Prod-shadow grading | — | ~$150/month worst case at 5% sample rate (initial setting in step 12) |
| Sidar labeling time | ~1 hour | ~30 min per quarterly recalibration |

## Risks

- **Judge instability across calibrations.** A judge-prompt tweak that improves mode_2 F1 may regress mode_1. Calibration must always score all four modes before accepting any change.
- **Selection bias in prod-shadow.** Random 5% sampling may under-represent hard/long-tail queries that drive mode_3. Acceptable for v1; revisit if mode rates look implausibly clean. Stratifying samples by query difficulty (e.g., low-similarity retrieval scores) is a v2 mitigation if needed.
- **Atomic-claim extraction is the upstream dependency.** If extraction misses claims, all downstream rates are biased low. If extraction emits non-factual sentences (procedural advice, hedges) as claims, every retrieved source scores 0 → false mode_3. This is why Pass A gates are stricter than Pass B and run first.
- **Mode_2 is the hardest to detect** — qualifier drift is subtle. If Pass B fails primarily on mode_2, decomposing into a dedicated qualifier-comparison call (per Section 2.5) is the planned mitigation.
- **Small natural mode_3 sample.** If organic mode_3 is rare in calibration, the production mode_3 number carries a low-confidence caveat until enough organic examples accumulate. This is acknowledged honestly in the report rather than papered over.
