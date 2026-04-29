# Evidence-Grounding Enforcement — Design

**Date:** 2026-04-23
**Status:** Approved (autonomous implementation in progress)
**Author:** pair-programming with user

## Problem

Observed failure modes in production chat:

- **(B)** The assistant mixes retrieved scientific claims with memorized/pretrained coaching claims in a single answer. The user cannot tell which claims came from the retrieved papers.
- **(C)** The assistant gives plausible, textbook-correct advice that doesn't actually draw from the retrieved evidence at all — the `<source_untrusted>` blocks are decorative.

The existing `EVIDENCE PRIORITY POLICY` prose in `prompt.js` is buried deep in a 1,500-token system prompt and offers no enforcement mechanism. The `verifyAnswerGrounding()` helper in `stream.js` computes a `grounded: bool` metric but does nothing with it.

## Goal

Make the model's grounding behavior **observable and audit-able per-sentence** via inline citation markers, then enforce a pass/fail grounding gate in a post-hoc verifier. Target: on a 100-prompt eval, the grounded pipeline should show materially fewer unsupported factual claims than bare `gpt-5.4-mini` judged against the same retrieved evidence.

## Design

### D1 — Inline citation markers
Require the model to emit `[N]` markers after every factual claim about training, nutrition, supplementation, physiology, or recovery, where `N` matches the `id` on the corresponding `<source_untrusted id="N">` block in `retrieved_evidence`. Claims the retrieved evidence doesn't support must be either (a) omitted or (b) explicitly labeled as "inference" or "the retrieved evidence does not establish X."

Rationale: per `docs/openai-api-reference.md` §6161 (Citation Formatting) and §19839 ("Lock research and citations to retrieved evidence"), explicit inline citations keyed to stable source IDs are OpenAI's recommended pattern for preventing pretrained-knowledge leakage in RAG systems.

### D2 — Hoist policy to top of system prompt
Move the evidence-priority block to the top of `SYSTEM_IDENTITY`, right after the opening identity line. The model's attention is strongest at the top and bottom; the current placement (buried between profile-data policy and tool-echo policy) is too weak.

### D3 — Inline GOOD/BAD example
Include one short GOOD/BAD comparison inline in the system prompt showing the required format (citation + inference label + "retrieved evidence does not establish" fallback). Few-shot dramatically improves instruction compliance for subtle policies.

### D4 — Citation-based grounding verifier
Rewrite `grounding-verifier.js` to:
1. Parse `[N]` markers out of the prose
2. For each sentence that matches the fact-signal regex, check: does it have a marker?
3. For each marker, check: does source N exist in `evidenceItems`?
4. Return `{status: "grounded" | "partial" | "ungrounded", cited_fraction, unsupported_claims, invalid_markers}`

Keep the existing token-overlap heuristic as a secondary signal for answers that emit no markers at all.

### D5 — Feature flag
`GROUNDING_ENFORCEMENT_ENABLED=true` enables the new prompt + verifier. Default `false` until the eval run validates the approach. Do not deploy to prod until the eval passes and the user approves.

### D6 — UI rendering (deferred)
Citation superscripts + grounding badge in the chat UI are out of scope for this iteration. The eval run validates the backend behavior; UI rendering ships as a follow-up PR once the approach is proven.

### D7 — 100-prompt eval
- Fixture: 100 prompts covering supplements, programming, nutrition, recovery, cardio, coaching
- Arms: (a) grounded Emersus pipeline with the new prompt + retrieved evidence; (b) bare `gpt-5.4-mini` with a neutral fitness-coach system prompt and no retrieval
- Grader: separate `gpt-5.4` call given the retrieved sources + the answer; asked to list "factual claims not supported by the provided sources"
- Metrics: per-answer `citation_coverage`, `unsupported_claim_count`, `specific_number_claims`, `did_decline_count`
- Pass gate: grounded arm shows ≥40% fewer unsupported-claim counts vs bare arm

## Acceptance

- [ ] Unit tests for the new verifier pass
- [ ] Prompt tests pass
- [ ] 100-prompt eval produces a comparison report
- [ ] Grounded arm beats bare arm on unsupported-claim count by ≥40%
- [ ] Report written to `scripts/eval/baselines/grounding-{timestamp}.json` + summary to stdout

## Rollout

1. Land behind `GROUNDING_ENFORCEMENT_ENABLED` flag (default off)
2. Run eval locally against prod Supabase (read-only)
3. If eval passes → commit, ask user to approve push, deploy
4. If eval fails → iterate on prompt/verifier, re-run eval
5. Once enabled in prod, schedule follow-up UI work (citation superscripts, grounding badge)

## Out of scope

- UI rendering of `[N]` markers (follow-up PR)
- Retry/rewrite loop on grounding failure (prompt enforcement must be primary)
- Model upgrade from `gpt-5.4-mini` (separate decision)
- Reasoning effort tuning (separate decision)
