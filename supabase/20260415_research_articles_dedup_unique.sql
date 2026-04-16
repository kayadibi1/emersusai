-- 20260415_research_articles_dedup_unique.sql
--
-- Phase 4 + Phase 3 replay, atomic. Re-runs the dedupe DELETE to catch rows
-- ingested during Phase 3's transaction (cron jobs kept writing in the
-- background), then promotes the non-unique dedup-key index to UNIQUE so
-- future ingestion's `ON CONFLICT DO NOTHING` catches composite dupes
-- without any JS change. All in one transaction — ALTER TABLE takes an
-- ACCESS EXCLUSIVE lock that blocks writers for the duration, so no
-- ingestion can sneak a new dupe between the final dedup DELETE and the
-- unique-index creation.
--
-- Ingestion workers will retry on conflict (pg-boss jobs are idempotent).

BEGIN;

-- 0. Block concurrent writers for the duration of this transaction.
--    Without this, ingestion cron jobs COMMIT rows between our DELETE
--    and CREATE UNIQUE INDEX (they see different MVCC snapshots), and
--    the index build fails on a just-inserted dupe. ACCESS EXCLUSIVE is
--    the strongest lock; existing ingestion workers block until COMMIT
--    then retry — pg-boss handlers are idempotent by design.
LOCK TABLE research_articles IN ACCESS EXCLUSIVE MODE;

-- 1. Second pass of the Phase 3 dedup logic — catches new dupes written
--    during or after the first backfill.
WITH ranked AS (
  SELECT
    pmid,
    ROW_NUMBER() OVER (
      PARTITION BY md5(canonical_dedup_key)
      ORDER BY
        (doi IS NOT NULL)                       DESC,
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

-- 2. Promote the dedup-key index to UNIQUE. Partial WHERE clause excludes
--    rows without a title or year (canonical_dedup_key = '||...' shape is
--    not a reliable collision signal, and we don't want sparse rows
--    colliding).
DROP INDEX IF EXISTS research_articles_canonical_dedup_key_md5_idx;

CREATE UNIQUE INDEX research_articles_canonical_dedup_key_unq
  ON research_articles (md5(canonical_dedup_key))
  WHERE title IS NOT NULL
    AND publication_year IS NOT NULL;

COMMIT;
