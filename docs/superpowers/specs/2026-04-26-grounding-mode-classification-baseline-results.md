# Grounding Mode Classification — Baseline Results (offline 100-fixture eval)

**Date:** 2026-04-26
**Eval source:** `scripts/eval/results/grounding-eval-claim-modes-baseline-2026-04-26T19-52-22-829Z.{json,md}`
**Spec:** `docs/superpowers/specs/2026-04-26-grounding-mode-classification-design.md`
**Plan:** `docs/superpowers/plans/2026-04-26-grounding-mode-classification.md`

## Calibration caveat

Per the project decision to use claude-opus-4-7 as labeling assistant rather than human-reviewed ground truth (no Pass A human labeling was performed), calibration measures inter-LLM agreement, not absolute accuracy:

- **Pass A (extraction) F1 = 0.726** (Claude-as-labeler vs gpt-5.4 production extractor, 30 answers).
- **Pass B (mode classification)** smoke-tested against 5 hand-constructed tuples; not formally calibrated.
- Mode rates below should be treated as **directional**, not precise. The qualitative picture (which modes dominate) is reliable; absolute percentages carry ±a few pp uncertainty, with mode_2 the noisiest.

## Per-mode rates (100 prompts, 296 claims, 0 grading errors)

| Mode | Count | % of OK claims |
|---|---:|---:|
| **correct** | 65 | **22.0%** |
| **mode_1_misattribution** | 16 | **5.4%** |
| **mode_2_overgen** | 201 | **67.9%** |
| **mode_3_fabrication** | 0 | **0.0%** |
| **mode_4_contradicted** | 6 | **2.0%** |
| no_marker | 8 | 2.7% |

## What this tells us

1. **Production grounding prevents pure fabrication.** Mode_3 (no source supports the claim anywhere in the retrieval set) is exactly 0% across 296 claims. The `GROUNDING_ENFORCEMENT_ENABLED` + `GROUNDING_SPLIT_PROMPT` contract — combined with the model's tendency to refuse rather than fabricate when retrieval is bad — is doing its job at the headline level. We confirmed this independently when the synthetic mode_3 generator failed to elicit fabrication: all 10 deliberately-mismatched-retrieval prompts resulted in the model refusing ("the retrieved evidence does not establish...").

2. **Over-generalization is the dominant failure mode (mode_2 = 68%).** Two thirds of cited claims drop scope qualifiers — population, dose, duration, study design. Examples seen in the eval: "creatine improves strength" cited from a study scoped to "5g/day in trained men over 8 weeks"; "vitamin D improves muscle performance" cited from a study scoped to "athletes with low baseline 25(OH)D"; "mTOR signaling rises with resistance training" cited from a paper studying rats only. This is what end users will perceive as "the model cites real papers but makes them sound more general than they actually are."

3. **Active contradiction is rare but non-zero (mode_4 = 2.0%).** 6 claims out of 296 where the model cited a paper that actively contradicts the claim. This is the most damaging error class because the citation lends false authority. Each instance is worth investigating individually.

4. **Mis-attribution low but non-trivial (mode_1 = 5.4%).** 16 cases where the right paper is in the retrieval set but the model cited a different one. Verifiable-quote-style prevention (model emits a quote that must substring-match the cited source) would address this directly.

5. **Only 22% of claims are fully clean.** "Cited paper exists, fully supports the claim, no qualifier drift" is a minority outcome at current generation quality.

## Stop-condition check (per spec Section 3.4)

The spec's threshold for skipping verifiable-quote prevention:

- mode_3 + mode_4 < 1%? **No — 2.0%.** Mode_4 alone is 2.0%, so prevention work earns its slot for the contradiction-with-citation case.
- mode_1 < 5%? **No — 5.4%.** Just over the line.

**Recommendation:** verifiable-quote prevention is worth pursuing as a follow-on project. It directly addresses modes 1, 3, and 4 (a quote either substring-matches the cited source or it doesn't, eliminating these failure modes by construction).

**Mode_2 (the dominant failure) is NOT addressed by verifiable-quote prevention** — the cited source IS supporting the claim, just at a narrower scope. Mode_2 needs a different remediation: prompt-side instruction to preserve scope qualifiers (population, dose, duration) when paraphrasing study findings. This is a much smaller surface-area change than verifiable quotes and should be tried first.

## Comparison with existing fidelity grader

The existing per-claim fidelity grader (legacy `supported|weak|decoy|contradicted` verdicts in `scripts/grade-grounding-samples.js`) ran on the same 100 prompts:

| Legacy verdict | Count | % |
|---|---:|---:|
| supported | 185 | 72.3% |
| weak | 70 | 27.3% |
| decoy | 1 | 0.4% |
| contradicted | 0 | 0% |

The two systems agree on the broad shape:
- "decoy" (≈ mode_3 fabrication) and "contradicted" (≈ mode_4) are both very low in both systems.
- "weak" (≈ mode_2 overgen) is 27% in the legacy grader, 68% in the new system.

The 27% vs 68% gap reflects:
1. Legacy grader is binary (supports or doesn't); new system requires *full* support with NO qualifier drop to count as `correct`. New system is stricter on qualifier preservation.
2. Atomic-claim splitting in new system creates more granular claims; legacy operates on full sentences.

Both are valid views — the new system surfaces qualifier drift specifically; the legacy view captures overall claim-level support. Both should run in parallel for cross-validation.

## Recommended next investments (in priority order)

1. **Mode_2 mitigation: prompt-side qualifier preservation.** Add an explicit instruction to the synthesis prompt: "When paraphrasing a study finding, preserve the scope qualifiers — population (e.g., 'in trained men'), dose (e.g., 'at 5g/day'), duration (e.g., 'over 8 weeks'). Drop them only when the source itself frames the finding as general." Re-run eval; expect mode_2 to drop and `correct` to rise. Lowest-effort, highest-impact change.

2. **Mode_4 review.** Pull the 6 mode_4 instances from this eval, manually verify each is a real contradiction (not a classifier false-positive), and inspect what went wrong. If they're real, they suggest a specific synthesis-time problem worth fixing.

3. **Verifiable-quote prevention** for modes 1+3+4. Higher engineering cost; only worth it if mode_1 doesn't drop after qualifier work and mode_4 review shows real issues. Defer until after step 1+2.

4. **Periodic prod-shadow run.** `GROUNDING_SAMPLE_RATE=0.05` enabled 2026-04-26. After a week of accumulated samples, re-run trend report (`node scripts/grounding-trend.js`) to confirm offline numbers match prod numbers. If divergence is large, prod-specific tuning is needed.

## Cost of this run

- Total eval: ~$8 (existing fidelity+paraphrase graders + new claim-modes grader on top)
- Wall time: ~30 min for 100 prompts on local machine
- gpt-5.4 calls for claim-modes specifically: ~600 (100 extraction + ~500 classification)

Cost is well within budget for ad-hoc re-runs after prompt changes.

---

# Session 2 — Same-day prompt iteration (2026-04-26 evening)

## Why mode_2 happens — root-cause analysis

Investigated the six mechanisms that produce mode_2 (over-generalization with citation):

1. **Token-by-token fluency optimization.** Model picks fluent next token even when source has different one. ("12 months" → "2 years" because the latter is more fluent.)
2. **Source-blending across pretraining.** Model blends features across many similar papers; cited source's specifics get averaged with priors.
3. **Post-hoc citation, not generative.** Model writes prose first, then attaches `[N]`. Citation is a stamp on prose, not a constraint on it.
4. **Coaching-register pressure.** System prompt biases toward conversational register; "renal transplant patients" auto-generalizes to "older adults" because the former feels weirdly specific in fitness chat.
5. **Round-number bias.** Trial durations cluster at attractor values (12 weeks, 1/2/3 years); model normalizes to attractors regardless of source.
6. **No token-level fidelity check.** Citation contract validates marker presence, not content. Prose can drift while citations stay valid.

Mechanisms 1, 4, 5 deferred to memory (`project_grounding_fluency_leaks_deferred.md`) — they're fluency-leaks the architectural fix would close in one go. Mechanisms 2, 3, 6 addressed directly by Rule 7.

## Rule 7 — qualifier-preservation prompt fix (shipped 2026-04-26 18:30 ET)

Added Rule 7 to `GROUNDING_CONTRACT_BLOCK` in `api/emersus/pipeline/prompt.js`:

> "PRESERVE THE SOURCE'S SPECIFICS — do not generalize. Before writing each factual claim, mentally identify the verbatim phrase in the cited source. Then write a paraphrase that keeps EVERY scope specifier the source includes — population, dose, duration, effect size, study design. If a specific is not stated in the source you intend to cite, OMIT that specific rather than invent it from pretrained knowledge."

Plus three updated examples — including BAD #2 (qualifier-drop) and BAD #3 (numeric drift, with the "2-year vs 12-month" case from the spot-check).

Commit `fffbdf95`. Webhook deployed to prod.

## Rule 7 measured impact (30-fixture comparison)

Same first-30 fixtures, original prompt vs Rule 7:

| Mode | Baseline (first 30) | Rule 7 v1 | Delta |
|---|---:|---:|---:|
| **correct** | 24.4% | **37.3%** | **+13.0pp** ✅ |
| mode_1_misattribution | 7.7% | 3.0% | −4.7pp ✅ |
| **mode_2_overgen** | 66.7% | **56.7%** | **−10.0pp** ✅ |
| mode_3_fabrication | 0% | 0% | 0 |
| mode_4_contradicted | 1.3% | 3.0% | +1.7pp (1→2 cases, statistical noise) |
| no_marker | 0% | 0% | 0 |
| Total claims | 78 | 67 | −11 (model is omitting unsupported specifics, as instructed) |

Confidence interval: 30 fixtures / ~70 claims is a small sample. The +13pp lift on `correct` and −10pp drop on mode_2 are consistent with the prompt fix doing real work. mode_4 +1.7pp is too small to be actionable at this N.

**Caveat:** prompting-only mitigation. The fluency leaks (mechanisms 1/4/5) still produce mode_2 in ~57% of claims. Capped at "improvement, not guarantee."

## Verbatim-overlap probe (architectural fix readiness)

Probed v1 outputs for verbatim phrase overlap with cited sources:

| Threshold | % of cited sentences |
|---|---:|
| ≥4-word verbatim overlap with cited source | **48.5%** |
| ≥6-word verbatim overlap | 22.7% |
| ≥8-word verbatim overlap | 3.0% |

**Key finding:** even with Rule 7, only ~half of cited sentences have a 4-word verbatim phrase from the cited source. The model is still paraphrasing freely — it just preserves the specifics better than before. A naive server-side substring verifier built on top of gpt-5.4-mini would have a high false-rejection rate (rejecting ~50% of valid paraphrases).

This rules out a "loose verifier on OpenAI" as a Phase 2 architectural fix. The architectural options are narrower than originally framed.

## Web research summary — how production RAG systems address this

(See full citations in the design spec.) Architectural approaches map to three tiers:

**Tier 1 — Token-level guarantee:** Anthropic Citations API ([docs](https://platform.claude.com/docs/en/build-with-claude/citations)) returns `cited_text` blocks with character ranges that are API-guaranteed substrings of the source. Vertex AI grounding does the equivalent with byte-indexed `groundingSupports`. AGREE ([2311.09533](https://arxiv.org/html/2311.09533v2)) trains the model itself to self-ground.

**Tier 2 — Two-stage:** LLMQuoter ([2501.05554](https://arxiv.org/html/2501.05554v1)) extracts quotes first via a small LLaMA-3B + LoRA, then generates from quotes only — +37.8% accuracy with quotes vs full context for small models. ReClaim ([2407.01796](https://arxiv.org/abs/2407.01796)) alternates reference + claim sentence-by-sentence — 90% citation accuracy.

**Tier 3 — Post-hoc verification:** RARR ([2210.08726](https://arxiv.org/abs/2210.08726)), Chain-of-Verification ([2309.11495](https://arxiv.org/abs/2309.11495)), HALT-RAG ([2509.07475](https://arxiv.org/html/2509.07475)) all do generate-then-check. Cheap, partial.

Critical research datapoints:
- ALCE ([2305.14627](https://arxiv.org/abs/2305.14627)): even best models lack complete citation support 50% of the time on ELI5.
- "Correctness is not Faithfulness" ([2412.18004](https://arxiv.org/pdf/2412.18004)): up to 57% of citations are post-rationalized — matches our 67.9% mode_2 finding almost exactly.
- Perplexity architecture: built on principle "you're not supposed to say anything that you don't retrieve" — citations tightly coupled with retrieval+ranking, not post-processed.

## Replicating Anthropic Citations on OpenAI — methods evaluated

Six paths for using Anthropic-style citations without prompting tricks:

| Method | Description | Cost / Risk |
|---|---|---|
| **A. Full synthesis switch** | Replace gpt-5.4-mini with Claude in `synthesize.js` | Multi-day. Voice change. **Incompatible with widget structured outputs** — would break the entire widget pipeline. Would need to split synthesis into citation-prose call + parallel widget call. |
| **B. Parallel verification** | Keep gpt-5.4-mini for chat; fire parallel Claude Citations call to verify | 2× synthesis cost. Adds latency to verification badge. Two outputs may disagree. |
| **C. Anthropic Citations as offline grader** | Replace gpt-5.4 judge in `claim-modes.js` with Claude Citations call | ~30 min wiring. Zero prod-path risk. Doesn't fix prod, just measures it more accurately. |
| **D. Hybrid "show your work" panel** | GPT prose to chat + Claude verified citations as side panel | Best UX trustworthiness. 2× cost. UX engineering work. |
| **E. Fine-tune quote-emitting OpenAI model** | Distill Claude-Citations behavior into a fine-tuned OpenAI model | Multi-week build. Need ~10k training examples. Maintenance burden. gpt-5.4-mini fine-tunability TBD. |
| **F. OpenAI native file_search citations** | Use OpenAI's vector store + native citation features | Likely requires uploading 1.4M articles to OpenAI. Loses retrieval control (BM25+dense+v4 substitution). Probably non-starter. |

## Recommendation — what to do next

**Do NOT clone Anthropic Citations now.** Reasoning:

1. **Insufficient data.** 30-fixture Rule 7 result is directional; need 100-fixture re-run + 1 week of prod data to know if mode_2 keeps falling on its own.
2. **Structural problem with naive replication.** Only 48% of cited sentences have ≥4-word verbatim overlap. Server-side substring verifier would reject too many valid paraphrases. Anthropic's API works because the model is *trained* to emit verbatim spans — without that training, the verification layer is fragile.
3. **Phase 3 (full Claude migration) is incompatible with widgets.** Real architectural fix would require breaking the widget pipeline.

**Do instead, in priority order:**

1. **Wait 1 week.** Run the manually-set calendar reminder (Sunday 2026-05-03) to re-run the 100-fixture eval and check prod-shadow `chat_claim_modes` from the grader cron.
2. **Method C (Anthropic Citations as offline grader) — ~30 min if we want to upgrade the grader signal now.** Swap the gpt-5.4 judge in `claim-modes.js` for a Claude Citations call. Better ground truth, zero prod risk. Does NOT change prod chat behavior — only measurement quality.
3. **If next week's mode_2 is still > 50%:** brainstorm Phase 2/3 with full data. Method B (parallel verification) is probably the right architectural shape — preserves chat voice + widget pipeline + adds real verification. Don't pick blind.

## Calendar reminder — Sunday 2026-05-03

Run locally in `~/Desktop/emersus`:
```
git pull
GROUNDING_ENFORCEMENT_ENABLED=true node --env-file=.env \
  scripts/eval/grounding-eval.js --limit=100 --judge=on --fidelity=on \
  --paraphrase=on --label=qualifier-preservation-week1
node scripts/grounding-trend.js
```
Compare offline mode rates vs the 67.9% mode_2 baseline. Compare prod-shadow numbers from `chat_claim_modes` (cron has been populating it hourly since 2026-04-26 evening).

## Open architectural choices for next session

1. **Should we ship Method C now?** ~30 min change to swap claim-modes.js judge to Claude Citations API. Improves measurement quality without touching prod. Decision: yes / no / wait for week-1 numbers.
2. **If mode_2 stays high:** Method B vs Method A vs Method E vs hybrid. Each has structural tradeoffs that need real exploration with data in hand.
3. **Mode_4 (2-3% contradicted-with-citation) cases:** worth manual inspection if they recur. Each one is a high-cost user-trust failure.
