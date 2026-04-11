-- Tracker column for the structured-abstract rechunker
-- (scripts/chunk-structured-abstracts.js).
--
-- Reads rows where abstract_sections IS NOT NULL AND chunks_sectioned_at
-- IS NULL, deletes the generic chunk_type='abstract' chunks for each,
-- and inserts new per-section chunks (chunk_type='abstract_background',
-- 'abstract_methods', 'abstract_results', etc.). Stamps the timestamp
-- so re-runs don't double-process.
--
-- Partial index keeps the cursor paginating fast.

ALTER TABLE public.pubmed_articles
  ADD COLUMN IF NOT EXISTS chunks_sectioned_at timestamptz;

CREATE INDEX IF NOT EXISTS pubmed_articles_chunks_sectioned_pending_idx
  ON public.pubmed_articles (pmid)
  WHERE abstract_sections IS NOT NULL AND chunks_sectioned_at IS NULL;
