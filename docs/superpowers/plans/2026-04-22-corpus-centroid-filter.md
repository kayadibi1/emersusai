# Corpus Centroid Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soft-delete ~169k off-topic aggregator-source papers (openalex / openaire / core) by computing each paper's minimum cosine distance to a "fitness centroid" built from 21 gold-standard journals; drop where MIN distance > 0.60.

**Architecture:** Single new table `corpus_centroids` holds the 1536-dim centroid vector. SQL-only filter pass: average gold-journal embeddings → score every aggregator paper → UPDATE is_deleted=true on outliers → batched DELETE of orphan chunks via existing cleanup script. No new application code — runs entirely as psql against the prod DB on Hetzner.

**Tech Stack:** Postgres 15 + pgvector (`<=>` cosine distance, `avg(vector)` aggregate), psql, our existing `evidence_chunks` HNSW index, the per-table autovacuum tuning applied earlier today.

---

### Task 1: Schema migration for `corpus_centroids` table

**Files:**
- Create: `supabase/20260422_corpus_centroids.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/20260422_corpus_centroids.sql
--
-- Holds named centroid vectors used as quality/relevance signals against
-- evidence_chunks.embedding. v1 use case: detect off-topic openalex /
-- openaire / core content via cosine distance to the average of ~146k
-- gold-standard fitness/nutrition chunks (MSSE, JSCR, Sports Medicine,
-- BJSM, AJCN, Nutrients, etc.).
--
-- Schema is forward-compatible — multiple centroid IDs (fitness_v1,
-- fitness_v2, …) can coexist. Build script keys on `id` and uses
-- ON CONFLICT to make re-runs idempotent.

CREATE TABLE IF NOT EXISTS public.corpus_centroids (
  id              text PRIMARY KEY,
  centroid        vector(1536) NOT NULL,
  built_from_n    int NOT NULL,
  built_from_jrnl text[] NOT NULL,
  built_at        timestamptz NOT NULL DEFAULT now(),
  notes           text
);

COMMENT ON TABLE public.corpus_centroids IS
  'Named pgvector centroids for quality/relevance scoring. See
   docs/superpowers/specs/2026-04-22-corpus-centroid-filter-design.md.';
```

- [ ] **Step 2: Apply migration to prod**

```bash
cat supabase/20260422_corpus_centroids.sql | ssh hetzner "docker exec -i supabase-db psql -U supabase_admin -d postgres"
```

Expected output: `CREATE TABLE` and `COMMENT`.

- [ ] **Step 3: Verify table exists**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c '\d public.corpus_centroids'"
```

Expected: schema definition shown with the 6 columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/20260422_corpus_centroids.sql
git commit -m "feat(corpus): add corpus_centroids table for relevance signals"
```

---

### Task 2: Build the fitness centroid

**Files:**
- Create: `scripts/build-fitness-centroid.sql`

- [ ] **Step 1: Write the centroid build SQL**

```sql
-- scripts/build-fitness-centroid.sql
--
-- Computes the 'fitness_v1' centroid as the average embedding of all
-- chunks from 21 gold-standard fitness/nutrition journals
-- (~146k chunks). Idempotent — ON CONFLICT replaces.
--
-- Both PubMed and OpenAlex casing variants of each journal are listed
-- because the same journal appears under both forms across our sources.

WITH gold_journals AS (
  SELECT unnest(ARRAY[
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
  ]) AS j
)
INSERT INTO public.corpus_centroids (id, centroid, built_from_n, built_from_jrnl, notes)
SELECT
  'fitness_v1',
  avg(ec.embedding),
  count(*),
  (SELECT array_agg(j) FROM gold_journals),
  '146k chunks from 21 gold-standard fitness/nutrition journals'
FROM evidence_chunks ec
JOIN research_articles ra ON ra.pmid = ec.pmid
WHERE ra.journal IN (SELECT j FROM gold_journals)
  AND ec.embedding IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
  centroid        = EXCLUDED.centroid,
  built_from_n    = EXCLUDED.built_from_n,
  built_from_jrnl = EXCLUDED.built_from_jrnl,
  built_at        = now(),
  notes           = EXCLUDED.notes;
```

- [ ] **Step 2: Copy to Hetzner + execute**

```bash
scp scripts/build-fitness-centroid.sql hetzner:~/build-centroid.sql
ssh hetzner "docker cp ~/build-centroid.sql supabase-db:/tmp/build-centroid.sql && docker exec supabase-db psql -U supabase_admin -d postgres -f /tmp/build-centroid.sql"
```

Expected: `INSERT 0 1` after ~30 s.

- [ ] **Step 3: Verify centroid was built**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT id, built_from_n, built_at, array_length(built_from_jrnl, 1) AS journal_count, notes FROM corpus_centroids WHERE id='fitness_v1';\""
```

Expected: one row with `built_from_n` ≈ 145,000–148,000, `journal_count` = 21, `built_at` recent.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-fitness-centroid.sql
git commit -m "feat(corpus): build-fitness-centroid SQL"
```

---

### Task 3: Verify centroid distance distribution matches the brainstorm

**Files:**
- (Read-only verification)

- [ ] **Step 1: Compute distance histogram for openalex/openaire/core papers**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
WITH scored AS (
  SELECT ra.source, ec.pmid,
         MIN(ec.embedding <=> (SELECT centroid FROM corpus_centroids WHERE id='fitness_v1')) AS min_dist
  FROM evidence_chunks ec JOIN research_articles ra ON ra.pmid=ec.pmid
  WHERE ra.source IN ('openalex','openaire','core')
    AND ra.is_deleted=false AND ec.embedding IS NOT NULL
  GROUP BY ra.source, ec.pmid
)
SELECT
  source,
  COUNT(*) AS papers,
  COUNT(*) FILTER (WHERE min_dist > 0.55) AS drop_055,
  COUNT(*) FILTER (WHERE min_dist > 0.60) AS drop_060,
  COUNT(*) FILTER (WHERE min_dist > 0.65) AS drop_065,
  COUNT(*) FILTER (WHERE min_dist > 0.70) AS drop_070
FROM scored GROUP BY source ORDER BY source;
\""
```

Expected (matches brainstorm sample on 2026-04-22):
- openalex: ~482k papers, drop_060 ≈ 115,000–116,000
- openaire: ~213k papers, drop_060 ≈ 48,000
- core: ~32k papers, drop_060 ≈ 5,400
- Total drop_060 ≈ 169,000

If numbers are off by more than ±5%, STOP and re-confirm with the user — the centroid may have shifted from when the threshold was chosen.

- [ ] **Step 2: Sample 12 borderline rows (distance 0.59–0.61)** to eyeball-verify the threshold catches off-topic and not real research

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
WITH scored AS (
  SELECT ra.source, ec.pmid, ra.journal, left(ec.content, 70) AS chunk,
         MIN(ec.embedding <=> (SELECT centroid FROM corpus_centroids WHERE id='fitness_v1')) AS min_dist
  FROM evidence_chunks ec JOIN research_articles ra ON ra.pmid=ec.pmid
  WHERE ra.source IN ('openalex','openaire','core')
    AND ra.is_deleted=false AND ec.embedding IS NOT NULL AND ec.chunk_type='abstract'
  GROUP BY ra.source, ec.pmid, ra.journal, ec.content
)
SELECT round(min_dist::numeric,3) AS d, source, journal, chunk
FROM scored WHERE min_dist BETWEEN 0.59 AND 0.61 ORDER BY random() LIMIT 12;
\""
```

Eyeball test: the 12 should be mostly off-topic with ~3–4 borderline-real-research entries. Matches the brainstorm sample.

---

### Task 4: Soft-delete papers above the threshold

**Files:**
- Create: `scripts/centroid-filter.sql`

- [ ] **Step 1: Write the filter SQL**

```sql
-- scripts/centroid-filter.sql
--
-- Soft-deletes openalex/openaire/core papers whose minimum chunk distance
-- to the fitness_v1 centroid exceeds 0.60. Per the 2026-04-22 brainstorm,
-- this drops ~169k off-topic papers (plant biology, business management,
-- composting, anthropology, nuclear engineering, etc.) that slipped past
-- topic / language / publisher / source-type filters.
--
-- Reversible: re-run with a different threshold by editing the WHERE
-- clause; or restore via UPDATE … SET is_deleted=false WHERE pmid IN (…)
-- using the saved drop list (see Task 5 step 2).

WITH scored AS (
  SELECT ec.pmid,
         MIN(ec.embedding <=> (SELECT centroid FROM corpus_centroids WHERE id='fitness_v1')) AS min_dist
  FROM evidence_chunks ec
  JOIN research_articles ra ON ra.pmid = ec.pmid
  WHERE ra.source IN ('openalex','openaire','core')
    AND ra.is_deleted = false
    AND ec.embedding IS NOT NULL
  GROUP BY ec.pmid
),
to_drop AS (
  SELECT pmid FROM scored WHERE min_dist > 0.60
)
UPDATE research_articles
SET is_deleted = true
WHERE pmid IN (SELECT pmid FROM to_drop);
```

- [ ] **Step 2: Save the drop list before applying** (so we can audit / reverse)

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
WITH scored AS (
  SELECT ra.source, ec.pmid,
         MIN(ec.embedding <=> (SELECT centroid FROM corpus_centroids WHERE id='fitness_v1')) AS min_dist
  FROM evidence_chunks ec JOIN research_articles ra ON ra.pmid=ec.pmid
  WHERE ra.source IN ('openalex','openaire','core')
    AND ra.is_deleted=false AND ec.embedding IS NOT NULL
  GROUP BY ra.source, ec.pmid
)
COPY (SELECT pmid, source, round(min_dist::numeric,4) AS dist FROM scored WHERE min_dist > 0.60 ORDER BY dist)
TO STDOUT WITH CSV HEADER\" > /tmp/centroid-drops-2026-04-22.csv && wc -l /tmp/centroid-drops-2026-04-22.csv && head -5 /tmp/centroid-drops-2026-04-22.csv"
```

Expected: ~169,302 lines (plus header) and a preview showing low-end distances around 0.601.

- [ ] **Step 3: Run the filter SQL**

```bash
scp scripts/centroid-filter.sql hetzner:~/centroid-filter.sql
ssh hetzner "docker cp ~/centroid-filter.sql supabase-db:/tmp/centroid-filter.sql && docker exec supabase-db psql -U supabase_admin -d postgres -f /tmp/centroid-filter.sql"
```

Expected: `UPDATE 169302` (±a few hundred).

- [ ] **Step 4: Commit**

```bash
git add scripts/centroid-filter.sql
git commit -m "feat(corpus): centroid-filter SQL — soft-delete > 0.60 outliers"
```

---

### Task 5: Verify post-filter corpus + sample retained content

**Files:**
- (Read-only verification)

- [ ] **Step 1: Confirm new corpus totals per source**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT
  source,
  COUNT(*) FILTER (WHERE is_deleted=false) AS usable,
  COUNT(*) FILTER (WHERE is_deleted=true) AS soft_deleted
FROM research_articles
WHERE source IN ('openalex','openaire','core')
GROUP BY source ORDER BY source;
\""
```

Expected approximate post-filter counts:
- openalex: usable ≈ 367,000, soft_deleted ≈ 596,000
- openaire: usable ≈ 165,000, soft_deleted ≈ 56,000
- core: usable ≈ 27,000, soft_deleted ≈ 14,000

- [ ] **Step 2: Sample 20 RANDOM kept aggregator rows** to spot-check that legit research survived

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT pmid, source, COALESCE(journal,'(no journal)') AS journal, left(title, 80) AS title
FROM research_articles
WHERE source IN ('openalex','openaire','core') AND is_deleted=false
ORDER BY random() LIMIT 20;
\""
```

Eyeball test: ≥17 of 20 should be obviously fitness/nutrition/sports/exercise/clinical-nutrition. If the rate of off-topic survivors is high (>4 of 20), the centroid may have skewed — STOP and re-evaluate.

- [ ] **Step 3: Smoke retrieval — verify queries still return strong on-topic results**

```bash
node --env-file=.env -e "
import('./api/emersus/retrieveDatabaseEvidence.js').then(async ({ retrieveDatabaseEvidence }) => {
  for (const q of ['creatine timing pre vs post workout','protein intake for muscle hypertrophy','deload protocol for intermediate lifter']) {
    const r = await retrieveDatabaseEvidence({ prompt: q, matchThreshold: 0.4, matchCount: 5 });
    const arr = r.evidence || r;
    console.log('Q:', q, '→ hits:', arr.length);
    for (const x of arr.slice(0,3)) console.log('  ', x.source, (x.similarity||0).toFixed(3), (x.title||'').slice(0,70));
  }
}).catch(e => console.error('FAIL:', e.message));"
```

Each query should return 5 hits with the top result clearly relevant. None of the dropped 169k should be in any top result.

---

### Task 6: Batch-DELETE orphan chunks

**Files:**
- Re-use: `scripts/openalex-bulk/cleanup-orphan-chunks.sql` (already in repo from earlier today's work; same batched-DELETE-with-pg_sleep pattern as previous cleanups)

- [ ] **Step 1: Count orphan chunks before**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT COUNT(*) AS orphan_chunks FROM evidence_chunks ec WHERE ec.pmid IN (
  SELECT pmid FROM research_articles WHERE source IN ('openalex','openaire','core') AND is_deleted=true
);\""
```

Expected: ~250,000–300,000 orphan chunks (169k papers × ~1.6 chunks/paper).

- [ ] **Step 2: Run the cleanup SQL in foreground (background-tracked)**

```bash
scp scripts/openalex-bulk/cleanup-orphan-chunks.sql hetzner:~/cleanup-centroid.sql
ssh hetzner "docker cp ~/cleanup-centroid.sql supabase-db:/tmp/cleanup-centroid.sql && docker exec supabase-db psql -U supabase_admin -d postgres -f /tmp/cleanup-centroid.sql"
```

Expected: `NOTICE: batch N: deleted 25000, total …` repeating ~10–12 times, then `cleanup complete: ~270000 chunks deleted`. Wall time 5–10 min thanks to per-table autovacuum tuning (`autovacuum_vacuum_cost_delay=0`, `scale_factor=0.05`) applied earlier today.

- [ ] **Step 3: Verify zero orphans remain**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT COUNT(*) AS still_orphan FROM evidence_chunks ec WHERE ec.pmid IN (
  SELECT pmid FROM research_articles WHERE source IN ('openalex','openaire','core') AND is_deleted=true
);\""
```

Expected: `0`.

- [ ] **Step 4: Verify autovacuum picks up the new dead tuples**

```bash
ssh hetzner "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT pid, state, wait_event, now() - query_start AS dur, left(query, 50) FROM pg_stat_activity
WHERE backend_type='autovacuum worker' AND state='active';
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum FROM pg_stat_user_tables WHERE relname='evidence_chunks';
\""
```

If autovacuum is active on `evidence_chunks`, leave it running in background — it'll reclaim HNSW index space. With our new tuning it shouldn't take more than 1–2 hours and runs incrementally without babysitting.

---

### Task 7: Update docs (changelog + checkpoint + Notion)

**Files:**
- Modify: `changelog.md` (gitignored — local-only per CLAUDE.md)
- Modify: `checkpoint.md` (gitignored — local-only)
- Notion page: `34a168c5-6323-81bc-836b-d0a60377b343` (today's session log)

- [ ] **Step 1: Append to `changelog.md`** (under the existing 2026-04-22 entry block, add a new bullet at the top of the day):

```markdown
- 2026-04-22 (final cleanup) — **Off-topic centroid filter** dropped ~169k aggregator-source papers (openalex 115k + openaire 48k + core 5k) whose chunks have MIN cosine distance > 0.60 to the fitness_v1 centroid. Built centroid as `avg(embedding)` over 146k chunks from 21 gold-standard fitness/nutrition journals (MSSE/JSCR/BJSM/AJCN/Nutrients/etc.); persisted in new `corpus_centroids` table. Catches ML-misclassification leaks (chickpea plant biology, almond pollen, composting, business management, nuclear engineering) that survived all upstream filters. Reversible — drop list at `/tmp/centroid-drops-2026-04-22.csv` on Hetzner. — `supabase/20260422_corpus_centroids.sql` (new), `scripts/build-fitness-centroid.sql` (new), `scripts/centroid-filter.sql` (new)
```

- [ ] **Step 2: Add a section 6 to `checkpoint.md`** under the existing late-evening block:

```markdown
6. **Centroid-based off-topic filter** (final cleanup): built fitness_v1 centroid (avg embedding of 146k chunks from 21 gold-standard fitness/nutrition journals) into new `corpus_centroids` table. Soft-deleted ~169k aggregator papers (openalex/openaire/core) with MIN chunk distance > 0.60. Then batched-DELETE ~270k orphan chunks; autovacuum reclaiming index space in background. Final usable corpus: openalex ~367k, openaire ~165k, core ~27k, plus ~800k unchanged from PubMed/EuropePMC/eLife/preprints/S2/ClinicalTrials. Spec: `docs/superpowers/specs/2026-04-22-corpus-centroid-filter-design.md`.
```

- [ ] **Step 3: Append to Notion session log** (parent page `34a168c5-6323-81bc-836b-d0a60377b343`)

Use `mcp__notion__notion-update-page` with `command="update_content"` and an `content_updates` entry that appends a new "## Centroid filter" section after the existing late-session work. Match the prose style of the prior sections in that page. Include final corpus counts and a one-line on the design doc location.

---

### Task 8: Final smoke + announcement

- [ ] **Step 1: One final smoke retrieval against the production endpoint**

```bash
node --env-file=.env -e "
import('./api/emersus/retrieveDatabaseEvidence.js').then(async ({ retrieveDatabaseEvidence }) => {
  const r = await retrieveDatabaseEvidence({ prompt: 'how to deload as an intermediate lifter', matchThreshold: 0.4, matchCount: 8 });
  const arr = r.evidence || r;
  console.log('hits:', arr.length);
  for (const x of arr) console.log('  ', x.source, (x.similarity||0).toFixed(3), (x.title||'').slice(0,80));
}).catch(e => console.error('FAIL:', e.message));"
```

Expected: 8 high-quality hits, all visibly fitness-related. Top result similarity ≥ 0.65.

- [ ] **Step 2: Tell the user the cleanup completed**

Report final per-source counts, total drop, the auto-vacuum status, and a "we're done" line. Suggest sleeping if it's late.

---

## Notes on dependencies between tasks

- Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (strictly sequential — each depends on the previous one's state).
- Task 6 (orphan-chunk DELETE) is the longest single step (~5–10 min wall). Triggers an incremental autovacuum that runs in background after.
- No application code changes — adapters/RPC are unchanged. The filter is a one-shot data operation that the existing `is_deleted=false` predicate in `match_evidence_chunks_v3` already honors.
- Periodic refresh: the centroid will drift slightly as the corpus grows. After each monthly OpenAlex bulk delta, re-run Task 2 (rebuild centroid) and Task 4 (re-apply filter). The build script is idempotent; the filter script is too (no-ops on already-deleted rows).
