-- 20260415_research_articles_dedup_backfill.sql
--
-- Phase 3: destructive consolidation of dupe clusters in research_articles.
--
-- For each cluster keyed by md5(canonical_dedup_key), keep one winner and
-- delete the rest. Winner-selection ordering (best first):
--   1. DOI present beats DOI null (known-identifier rows are more reliable
--      for downstream joins / retrieval links).
--   2. Higher rcr (iCite Relative Citation Ratio) — impact signal.
--   3. Higher citation_count.
--   4. More recent updated_at.
--   5. Lower pmid as stable tiebreaker (prefer the first-ingested canonical).
--
-- Scope: rows with non-null title AND non-null publication_year. Rows
-- missing those are not grouped (canonical_dedup_key starts with '|' or
-- '||') and are left alone.
--
-- Chunk cascade: evidence_chunks.pmid_fkey has ON DELETE CASCADE, so each
-- deleted research_articles row takes its chunks with it. This reclaims
-- embedding storage for the defunct rows.
--
-- Transaction-safe: runs inside a single transaction. If the row count
-- comes back wildly unexpected, the operator can ROLLBACK before COMMIT.
-- Applying via apply-migrations.sh COMMITs on success (ON_ERROR_STOP=1
-- aborts on any failure).

BEGIN;

WITH ranked AS (
  SELECT
    pmid,
    ROW_NUMBER() OVER (
      PARTITION BY md5(canonical_dedup_key)
      ORDER BY
        (doi IS NOT NULL) DESC,
        COALESCE(rcr, 0)                        DESC,
        COALESCE(citation_count, 0)             DESC,
        COALESCE(updated_at, created_at)        DESC,
        pmid                                    ASC
    ) AS rn
  FROM research_articles
  WHERE title IS NOT NULL
    AND publication_year IS NOT NULL
),
losers AS (
  SELECT pmid FROM ranked WHERE rn > 1
)
DELETE FROM research_articles r
USING losers l
WHERE r.pmid = l.pmid;

COMMIT;
