# Evidence Retrieval: Source-Centric with Title-Chunk Demotion — Design Spec

**Date:** 2026-04-22
**Status:** Approved, gated on concurrent DB instance completing its work
**Owner:** Sidar
**Related plan:** `docs/superpowers/plans/2026-04-22-evidence-retrieval-source-centric.md`

## Problem

The "Why this answer?" reveal shipped 2026-04-22 (commit `1c94d59e`) exposes redundant blockquotes that just repeat the source title. Example from a "Sugar and athletic performance" question:

```
[1] Sugar and oral health    2026 · JOURNAL OF ORAL RESEARCH AND REVIEW
    > Sugar and oral health

[2] Sugar and metabolic health    2016 · CURRENT OPINION IN CLINICAL NUTRITION
    > Sugar and metabolic health

[3] Is There a Specific Role for Sucrose in Sports and Exercise Performance?
    > Is There a Specific Role for Sucrose in Sports and Exercise Performance?
```

Two visible problems, one root cause:

1. **Rendering bug:** the blockquote duplicates the title. The `WhyThisAnswer` component reads `source.excerpt`, which is sourced from `evidence_chunks.chunk_text` — and for `chunk_type='title'` rows that text IS the title.
2. **Off-topic retrieval:** "Sugar and oral health" is not athletic-performance evidence. It surfaced because its title chunk's embedding has high keyword overlap with "sugar" — but the chunk carries no passage to actually back the answer.

## Root cause

`evidence_chunks` indexes titles as first-class evidence chunks alongside abstracts:

```
chunk_type             count
abstract              1700005
title                 1535908   ← 38% of corpus, all keyword-noise
abstract_background    117225
abstract_methods       105553
abstract_results       104898
abstract_conclusions   102681
abstract_other          74024
full_text               41019
```

A title chunk is a **recall hint, not a passage**. When ANN returns one, every downstream consumer gets garbage:

- The LLM gets `[1] Sugar and oral health\nSugar and oral health` — zero info, but it counts toward the synthesis context budget and crowds out useful chunks.
- The sources footer shows a redundant blockquote.
- "Why this answer?" presents the title as evidence backing the answer.
- HNSW search wastes ~5GB of index on chunks that don't contribute distinct passage content.

## Goal

Make evidence retrieval **source-centric** rather than chunk-centric. Each returned source carries the best available passage for that source. Title chunks are demoted: kept as a recall mechanism but never surfaced as the displayed passage when a substantive chunk exists for the same paper. When no substantive chunk exists (preprint with no abstract indexed, etc.), surface the source honestly as "title-only — full text not available" rather than rendering a redundant blockquote.

## Non-goals

- Re-ingesting or re-embedding the corpus. The fix operates on existing data.
- Changing chunk ingestion pipeline. Title chunks continue to be indexed; their role narrows.
- Reranking model changes (cross-encoder etc.). Out of scope for this PR.
- Hybrid BM25+vector retrieval. Deferred to Phase 2 (separate plan).

## Architecture

Three layers, all shipped in one PR. Phase 2 (BM25 title index) is a follow-up.

### Layer 1 (DB) — `match_evidence_chunks_v4` RPC

New RPC, parallel to v3 for safe rollout (env flag gates which one the JS calls). Same signature shape with two added output fields:

```sql
RETURNS TABLE(
  id bigint,
  pmid bigint,
  chunk_type text,             -- chunk type of the SHOWN content (post-substitution)
  content text,                -- SHOWN content (substituted from title→abstract when possible)
  similarity double precision, -- similarity of the chunk that originally MATCHED the query
  matched_chunk_type text,     -- NEW: what chunk_type actually matched the query (may be 'title')
  is_title_only_match boolean  -- NEW: TRUE iff no non-title chunk exists in evidence_chunks for this pmid
)
```

**Algorithm (plpgsql, four CTEs, all `MATERIALIZED`):**

1. `candidates`: top `match_count * 5` nearest neighbors via HNSW, threshold-gated. Wider net than v3 (was `*3`) so per-source selection has options.
2. `joined`: join to `research_articles`, apply existing filters (retraction, deletion, peer_reviewed, language).
3. `best_per_source`: `DISTINCT ON (doi or pmid)` → keep one row per source, picking the highest-similarity chunk; track whether ANY non-title chunk for this source matched (`has_substantive_match`).
4. `passage_substitution`: for each source where the best matching chunk was a title chunk, lookup the best non-title chunk in `evidence_chunks` for that pmid (preference order: `abstract` > `full_text` > `abstract_conclusions` > `abstract_results` > `abstract_methods` > `abstract_background` > `abstract_other`). If found, use that chunk as the displayed content (the chunk didn't match the query, but it's the actual passage that justifies showing this source). If none exists in the table at all, mark `is_title_only_match=true`.

**Final ordering:** by original match similarity DESC, with `is_title_only_match=true` rows demoted to the tail. This preserves recall ordering while pushing weak title-only matches behind real passages.

**Performance:** the substitution adds ~10 indexed-pmid lookups per call (one per candidate source). `evidence_chunks.pmid` already has a btree index. Estimated overhead: 5–15ms per call on top of the current ~130ms.

### Layer 2 (App) — JS layer simplification

`api/emersus/retrieveDatabaseEvidence.js`:
- Branch on `RETRIEVAL_USE_V4` env flag (default `false` until eval passes).
- When v4: call `match_evidence_chunks_v4`, propagate `matched_chunk_type` and `is_title_only_match` through the row shape.
- `dedupByDoi` becomes a no-op when v4 is active (RPC already deduped). Keep the function exported for the v3 codepath until v3 is removed.

`api/emersus/pipeline/retrieve.js` `normalizeVectorEvidenceRow`:
- Add fields `matched_chunk_type`, `is_title_only_match` to the returned object.
- When `is_title_only_match=true`: leave `excerpt` empty (the UI fallback handles the messaging).
- When `matched_chunk_type='title'` but `is_title_only_match=false`: the RPC has already substituted `content` to an abstract chunk — `excerpt` works correctly without special-casing.

`api/emersus/pipeline/format-sources.js`:
- Pass `matched_chunk_type` and `is_title_only_match` to the client SSE payload.

### Layer 3 (UI) — Honest fallback in client

`shared/react-chat-app.js`:

`WhyThisAnswer` (line ~3088):
- Filter rule: prefer items where `excerpt` is non-empty AND not title-equivalent (defense-in-depth against any title chunks that slip through).
- Backfill: if the top 3 don't have 3 real passages, pull from the deduped tail until we have up to 3 with substantive content.
- For any remaining items where `is_title_only_match=true` (no better source available): render `"Title-only match — full text not available"` in italic small text in place of the blockquote.

`SourcesFooter` (line ~3151):
- Same fallback logic on the per-row snippet. Sources footer can list more rows (up to N=6) but each row uses the same "title-only" message when applicable.

### Layer 4 (Eval) — Retrieval quality regression harness

`scripts/eval/retrieval-eval.js`:
- Loads a JSON fixture file with question prompts and expected behavior (must-include pmids, must-exclude pmids).
- Runs each question against a configurable RPC (`v3` or `v4`).
- Reports per-fixture pass/fail and aggregate metrics: recall@5, title-only-match rate, average similarity of top-3.
- Saves baselines to `scripts/eval/baselines/` for diffing across runs.

`scripts/eval/fixtures/retrieval.json`:
- 20 hand-curated questions across nutrition / training / supplementation / sleep / recovery.
- Each entry: `{question, must_include_pmids?, must_exclude_pmids?, notes}`.
- Initial fixture set explicitly includes the bug case (`"Sugar and athletic performance"`) with `must_exclude_pmids` for the oral-health/metabolic-health papers and `must_include_pmids` for the sucrose-in-sports paper.

**Acceptance gate:** v4 must hit recall@5 ≥ (v3 baseline − 5pp) AND title-only-match rate ≤ 5% AND no fixture regressions. If recall regresses more than 5pp, the candidate window (`match_count * 5`) is the first knob to widen.

## Rollout

1. Migration applies on Hetzner PG (parallel to v3, no signature collision).
2. Code merges with `RETRIEVAL_USE_V4=false` default — production stays on v3.
3. Eval harness runs on Hetzner against v4: gate.
4. Manual spot-check: 5 typical questions in the production chat with the flag enabled per session.
5. Flip default to `true` in the next commit. Monitor for 48h.
6. v3 RPC kept available for one week post-cutover, then dropped in a follow-up migration.

## Coordination constraint

A concurrent Claude Code instance is currently working on the production database. **The DB migration in this plan does not run until that work is complete.** The implementation plan starts with the application-side eval harness (which only reads via existing RPCs) and the WhyThisAnswer client-side defense-in-depth (pure UI), so we can make progress on Layer 3 + Layer 4 in parallel without DB contention. The migration and v4 cutover (Layers 1–2) are sequenced after the other instance signals done.

## Coordination context (added 2026-04-23 after corpus-centroid filter shipped)

The other instance shipped a corpus-centroid filter (`supabase/20260422_corpus_centroids.sql`, `scripts/build-fitness-centroid.sql`, `scripts/centroid-filter.sql`). State on prod as of 2026-04-23 04:08 UTC:

- New `corpus_centroids` table with `fitness_v1` centroid built from gold-standard sports/nutrition journals.
- 754,623 research_articles soft-deleted (`is_deleted=true`) where min chunk distance to fitness_v1 > 0.60. By source: 674k openalex, 56k openaire, 24k core. PubMed/EuropePMC/preprint sources untouched.
- Chunks for those soft-deleted articles were physically deleted from `evidence_chunks` (verified: 0 chunks now exist for `is_deleted=true` articles). evidence_chunks dropped from ~3.94M → 3.34M rows.
- Active corpus is now 1,641,914 articles across 12 sources.
- **Autovacuum is currently running on `evidence_chunks`** (since 17:24 UTC, ~11h, IO-bound). 1.04M dead tuples to reclaim. Has not finished. `research_articles` autovacuum already completed (20:06 UTC).

Implications for this plan:

1. **The original "Sugar and oral health" bug-case paper is already gone.** pmid 10004277354 was soft-deleted AND its chunks dropped. So that specific repro is no longer reproducible from the corpus alone. However, "Sugar and metabolic health" (pmid 10004375236, openalex) survived the filter with 2 chunks intact (likely title + abstract). It can still surface as a title-only retrieval hit, so the bug pattern is still present in the live corpus, just not on the exact pmid we screenshotted.
2. **The candidate-window concern in v4 is mitigated.** Originally I worried the wider `match_count * 5 = 40` candidate window would still under-fill because the post-ANN `is_deleted=false` JOIN would filter out many candidates. Since chunks for soft-deleted articles were physically removed, the post-ANN filter is now a no-op for the centroid-dropped papers. Window stays at `*5`.
3. **Autovacuum-aware migration timing.** The CREATE FUNCTION DDL itself is safe to apply during the autovacuum (it touches `pg_proc`, not `evidence_chunks`). But heavy eval queries during peak vacuum I/O will be slower and noisier. Plan tasks should:
   - Apply the v4 RPC migration whenever (DDL is fine).
   - Wait for `pg_stat_activity` to show no `autovacuum: VACUUM public.evidence_chunks` rows before running the v3 baseline AND v4 eval (Tasks 1 step 4 and Task 8). This avoids inconsistent latency numbers and avoids competing for I/O.
4. **Phase 2 (BM25 title index) priority drops.** The centroid filter handles a lot of the topical-noise problem that BM25 would have addressed. Phase 2 stays on the roadmap but its expected value is lower; revisit only if the v4 + centroid combination still leaves visible noise in eval results.
5. **A new invariant to preserve:** chunks for soft-deleted articles must always be deleted from `evidence_chunks`. If a future filter soft-deletes articles without dropping their chunks, the candidate-window concern re-emerges (HNSW returns chunks, JOIN filters them out, fewer real candidates per call).

## Phase 2 (separate spec, deferred)

- BM25 title index: `research_articles.title_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', title)) STORED` + GIN index. Used as a recall *boost* in retrieval scoring (not as a passage). Restores the recall-boost intent of title chunks without polluting the passage stream.
- Title-chunk index pruning: once Phase 2 lands and BM25 takes over the recall job, drop the 1.5M title chunks from `evidence_chunks` (or move them to a non-vector cold table). Frees ~5GB HNSW index and tightens the noise floor for vector recall.
- Cross-encoder rerank: deferred until eval shows BM25+vector is still leaving topical noise.

## Open questions answered

- **Why a new RPC vs modifying v3?** Production has paying users (per `project_pricing_billing_subsystem_live.md`). Parallel rollout with eval gate avoids any risk window. v3 stays callable as immediate rollback.
- **Why not just filter `chunk_type != 'title'` in v3?** That kills recall on papers where the title chunk is the *only* indexed chunk (preprints, etc.). The substitution-and-fallback approach preserves recall while fixing the surface.
- **Why not do the substitution in JS?** Could work but means N+1 queries (one per title-match candidate). plpgsql in-RPC keeps it to one round trip and lets PG planner optimize the lookups together.
- **Is the eval set big enough at 20 questions?** Sufficient to gate the obvious regressions. Should grow to 100+ over time. Tracked separately.
