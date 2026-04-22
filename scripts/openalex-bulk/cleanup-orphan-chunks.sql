-- scripts/openalex-bulk/cleanup-orphan-chunks.sql
--
-- Batched DELETE of evidence_chunks whose parent research_articles row is
-- soft-deleted (is_deleted=true). Runs in 25k chunks with 30s sleeps
-- between batches so per-table autovacuum (scale_factor=0.05, cost_delay=0)
-- can interleave and reclaim HNSW index space incrementally.
--
-- Scope: aggregator sources (openalex, openaire, core). PubMed & curated
-- sources are never soft-deleted at scale.
--
-- Runs from psql via nohup on Hetzner; RAISE NOTICEs land in the caller's
-- log file.

DO $$
DECLARE
  total_deleted bigint := 0;
  batch_deleted bigint;
  iteration int := 0;
BEGIN
  LOOP
    iteration := iteration + 1;

    WITH victims AS (
      SELECT ec.id
      FROM evidence_chunks ec
      JOIN research_articles ra ON ra.pmid = ec.pmid
      WHERE ra.source IN ('openalex','openaire','core')
        AND ra.is_deleted = true
      LIMIT 25000
    )
    DELETE FROM evidence_chunks
    WHERE id IN (SELECT id FROM victims);

    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    total_deleted := total_deleted + batch_deleted;

    RAISE NOTICE 'batch %: deleted %, total %', iteration, batch_deleted, total_deleted;

    EXIT WHEN batch_deleted = 0;

    -- Breathe so autovacuum can fire on the new tuned settings
    PERFORM pg_sleep(30);
  END LOOP;

  RAISE NOTICE 'cleanup complete: % chunks deleted across % iterations',
    total_deleted, iteration;
END $$;
