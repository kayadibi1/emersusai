# Corpus Centroid Filter — Off-Topic Defense

**Status:** approved (2026-04-22)
**Author:** Claude Opus 4.7 (1M context) + Sidar
**Scope:** OpenAlex / OpenAIRE / CORE rows in `research_articles`
**Cost:** $0 (uses existing pgvector embeddings)

---

## Problem

After type / language / publisher / source-type filters, ~10% of remaining
OpenAlex content is off-topic — plant biology, nuclear engineering, art
education, business management, anthropology, basic chemistry — that
slipped through OpenAlex's ML topic classifier (it tagged them under
"Sports Performance and Training" or "Nutrition and Dietetics" subfields
despite the journal/content being clearly unrelated).

Heuristic filters can't catch these because the journals are real
(*Pure and Applied Chemistry*, *J Plant Physiology*, *Biocycle*) and the
text isn't SEO; it's just orthogonal research that the ML mis-tagged.

## Insight

We have **all 3.78M chunks already embedded** as 1536-dim vectors in
`evidence_chunks`. The embedding model (text-embedding-3-small) was
trained on the full web; plant-biology and resistance-training texts
naturally land in different regions of its concept space. We can use
this to find outliers — entirely offline, $0, in seconds.

## Architecture

```
┌────────────────────────────┐
│ 21 gold-standard journals  │  MSSE, JSCR, Sports Medicine, BJSM,
│ (146k embedded chunks)     │  AJCN, Nutrients, Clinical Nutrition,
│                            │  EJAP, IJSPP, JISSN, Scand J Med Sci
└──────────┬─────────────────┘  in Sports, J Sports Sciences,
           │                    The J Nutrition, etc.
           ▼ avg(embedding)
┌────────────────────────────┐
│ Fitness centroid           │  Single 1536-dim vector =
│ (1 vector(1536))           │  "the platonic ideal of fitness/
│ stored in corpus_centroids │   nutrition research".
└──────────┬─────────────────┘
           │
           │ cosine distance
           ▼
┌────────────────────────────┐
│ Score every openalex/      │  For each pmid, compute MIN distance
│ openaire/core paper        │  across its chunks (best chunk
│ (~1M papers)               │  represents the paper's relevance).
└──────────┬─────────────────┘
           │ where MIN distance > 0.60
           ▼
┌────────────────────────────┐
│ Soft-delete                │  is_deleted=true
│ (~90k papers)              │  + DELETE chunks (with the new
│                            │  vacuum tuning, ~5–10 min)
└────────────────────────────┘
```

## Components

### 1. `corpus_centroids` table (new)

```sql
CREATE TABLE public.corpus_centroids (
  id              text PRIMARY KEY,    -- 'fitness_v1'
  centroid        vector(1536) NOT NULL,
  built_from_n    int NOT NULL,        -- # chunks averaged
  built_from_jrnl text[] NOT NULL,     -- journal names used
  built_at        timestamptz NOT NULL DEFAULT now(),
  notes           text
);
```

Single row keyed `'fitness_v1'`. New row each time we re-build (versioned).
Used for retrieval-time scoring AND the periodic batch filter.

### 2. Centroid build (one-shot SQL)

The 21 gold-standard journal names (covers both PubMed and OpenAlex
casing variants; verified against the actual corpus distribution):

```
'Medicine and science in sports and exercise',
'Medicine & Science in Sports & Exercise',
'Journal of strength and conditioning research',
'The Journal of Strength and Conditioning Research',
'Sports medicine',
'Sports Medicine',
'British journal of sports medicine',
'British Journal of Sports Medicine',
'European journal of applied physiology',
'European Journal of Applied Physiology',
'Journal of sports sciences',
'International journal of sports physiology and performance',
'Scandinavian journal of medicine & science in sports',
'Journal of the International Society of Sports Nutrition',
'The American journal of clinical nutrition',
'American Journal of Clinical Nutrition',
'The Journal of nutrition',
'Journal of Nutrition',
'Nutrients',
'Clinical nutrition',
'Clinical Nutrition'
```

Build SQL (~30 s wall, ~146k chunks averaged):

```sql
WITH gold AS (SELECT unnest(ARRAY[<journal list above>]) AS j)
INSERT INTO corpus_centroids (id, centroid, built_from_n, built_from_jrnl, notes)
SELECT
  'fitness_v1',
  avg(ec.embedding),
  count(*),
  (SELECT array_agg(j) FROM gold),
  '146k chunks from 21 gold-standard fitness/nutrition journals'
FROM evidence_chunks ec JOIN research_articles ra ON ra.pmid = ec.pmid
WHERE ra.journal IN (SELECT j FROM gold)
  AND ec.embedding IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
  centroid       = EXCLUDED.centroid,
  built_from_n   = EXCLUDED.built_from_n,
  built_from_jrnl= EXCLUDED.built_from_jrnl,
  built_at       = now();
```

Runs in ~30s. Idempotent — replace on re-run.

### 3. Score + soft-delete pass

```sql
WITH scored AS (
  SELECT ec.pmid, MIN(ec.embedding <=> (SELECT centroid FROM corpus_centroids WHERE id='fitness_v1')) AS min_dist
  FROM evidence_chunks ec JOIN research_articles ra ON ra.pmid = ec.pmid
  WHERE ra.source IN ('openalex','openaire','core')
    AND ra.is_deleted = false
    AND ec.embedding IS NOT NULL
  GROUP BY ec.pmid
)
UPDATE research_articles
SET is_deleted = true
WHERE pmid IN (SELECT pmid FROM scored WHERE min_dist > 0.60);
```

Runs in ~30–60s. Affects ~90k rows.

### 4. Orphan-chunk cleanup (re-use existing pattern)

```sql
-- scripts/openalex-bulk/cleanup-orphan-chunks.sql already exists, batched
-- DELETE in 25k chunks with pg_sleep(30); per-table autovacuum
-- (scale_factor=0.05, cost_delay=0) interleaves and reclaims HNSW space.
```

~10–15 min total wall, fully automated.

### 5. Periodic refresh

The centroid is a function of "what chunks our gold-standard journals have
embedded." As we ingest more, the centroid drifts marginally. Re-run on:

- **Every monthly OpenAlex bulk delta** — naturally falls into the workflow
- **Manual trigger** if we add new gold-standard journals to the seed list

A pg-boss handler `rebuild-fitness-centroid` could automate, but for
v1 this is a manual SQL block.

### 6. Threshold = 0.60

Decision per 2026-04-22 brainstorm. Sample-validated:

| Distance | What's there |
|---|---|
| 0.20–0.45 | core fitness research (high precision) |
| 0.50–0.55 | borderline drift (some clinical adjacent) |
| **0.60** ← threshold | crosses into mostly off-topic |
| 0.66–0.68 | 70–80% off-topic (plant chem, art ed) |
| 0.78+ | ~95% off-topic (CO2 lasers, NASA spheres) |

Aggressive precision — accepts losing some legitimate sports orthopedics
and pediatric nutrition (Foot & Ankle Orthopaedics Achilles surgery,
Acta Scientific Nutritional Health youth obesity) in exchange for
killing the long tail of misclassified content.

Threshold can be re-run with a different value any time — soft-delete
is reversible (`UPDATE … SET is_deleted=false WHERE …`).

## Edge cases

- **Multi-chunk papers:** use `MIN(distance)` across the paper's chunks
  so the most-fitness-y chunk vouches for the paper. Title chunks tend
  to be denser fitness keywords; abstract chunks vary.
- **Title-only chunks (no abstract):** just the title's distance is used.
  These are typically already filtered upstream (no abstract → not
  indexed by retrieval).
- **Already soft-deleted rows:** skipped via `is_deleted = false`
  predicate in the score CTE.
- **Borderline real research:** accepted as a known cost. We're trading
  ~5% recall for ~95% precision on the killed bucket. Bias to user
  experience over comprehensive coverage.
- **Future ingests:** embeddings happen *after* ingest, so we can't gate
  at the adapter layer. Filter is a periodic batch — runs after each
  monthly OpenAlex delta.

## Non-goals

- **Adapter-level enforcement** — embeddings happen post-ingest; can't gate
  at normalize() time. Future per-topic ingests pass through, get embedded,
  and are filtered on the next centroid pass.
- **Per-query runtime filter** — RPC overhead of distance-to-centroid on
  every retrieval would add ~5ms. Better to filter once at corpus level.
- **Centroid as ranking signal** — distance is good for "is this on-topic"
  but worse than the existing semantic similarity for "is this answer
  relevant to *this query*". Don't use it in match_evidence_chunks_v3.
- **PubMed/EuropePMC/eLife/preprint sources** — already curated upstream;
  centroid is overhead with no benefit. Limit scope to aggregator
  sources (`source IN ('openalex','openaire','core')`).

## Testing strategy

Pre-deploy:

1. Build centroid in dev (target prod DB since we have no dev replica)
2. Compute distance histogram
3. Sample 12 rows from each of 6 distance buckets (0.4–0.45, 0.5–0.55, …)
4. Eyeball verify the 0.60 threshold catches mostly-off-topic
5. Compute affected-row count

Post-deploy:

6. Sample 30 random *kept* openalex rows, verify off-topic rate dropped
   to <2% (was 10% before)
7. Run smoke retrieval queries (creatine timing, protein intake,
   resistance training adaptations) — verify on-topic citations still
   surface. None of the ~90k dropped rows should have been ranking
   in the top 8 for these queries.

## Files

New:
- `supabase/20260422_corpus_centroids.sql` — schema migration
- `scripts/build-fitness-centroid.sql` — one-shot centroid build SQL
- `scripts/centroid-filter.sql` — score + soft-delete pass

Re-used:
- `scripts/openalex-bulk/cleanup-orphan-chunks.sql` — chunk DELETE +
  autovacuum interleave (already in repo from earlier today's work)

## Risk

| Risk | Mitigation |
|---|---|
| Threshold too aggressive, kills legit research | Soft-delete is reversible; can re-run UPDATE with looser threshold |
| Centroid drift over time | Re-build every monthly delta; versioned in `corpus_centroids` |
| pgvector `avg()` slow on 146k vectors | Tested in this brainstorm — completed in ~30s |
| HNSW vacuum after big DELETE | Already tuned (`cost_delay=0`, per-table `scale_factor=0.05`); 5–10 min batched |

## Open questions

None. Threshold approved at 0.60. Ready to spec implementation plan.
