-- 20260415_research_articles_canonical_dedup.sql
--
-- Phase 1 of the research_articles dedupe program.
--
-- Problem: the same paper can land in research_articles multiple times under
-- different (source, external_id) tuples. Seen in prod with Zenodo records
-- — Zenodo assigns a new DOI per upload version, and OpenAlex treats each
-- version as its own Work, so a paper with 3 versions becomes 3 rows with
-- 3 distinct DOIs. Retrieval-side two-pass dedup (api/emersus/rerank.js
-- dedupeEvidence + client dedupeSources) masks the UX, but the data layer
-- still carries the wasted rows: extra embedding cost, slower retrieval,
-- inflated analytics.
--
-- This migration lays the groundwork (column + non-unique index) so we can:
--   Phase 2: preview the dupe count + worst offenders.
--   Phase 3: backfill — consolidate each dupe cluster to the best row and
--            delete the rest (destructive; gated behind operator approval).
--   Phase 4: promote the index to UNIQUE so ON CONFLICT DO NOTHING catches
--            future composite dupes without any JS change.
--
-- SAFE TO RUN: adds a generated column and a non-unique index. No existing
-- rows are modified. Generated column computation is O(1) per row at insert
-- time. STORED so we can index it; VIRTUAL would re-compute on every query.
--
-- Key format: lower(normalized title) | lower(first-author surname token) | year
--   - title:    collapsed whitespace, lowercased
--   - author:   authors->>0 (first entry of jsonb array), lowercased,
--               first whitespace/comma-separated token (surname heuristic)
--   - year:     publication_year as text
--
-- Rows with missing title or year produce a key starting with "|" or "||";
-- Phase 4 unique index will exclude those via a partial-index WHERE clause
-- so sparse rows don't collide.

BEGIN;

-- 1. The generated dedup key.
--    authors is jsonb; `authors->>0` returns the first element as text
--    (may contain a full "Last, First" or "First Last" string). We
--    take the first whitespace/comma-separated token — a reasonable
--    surname heuristic across adapters' different author formats.
ALTER TABLE research_articles
  ADD COLUMN IF NOT EXISTS canonical_dedup_key TEXT
  GENERATED ALWAYS AS (
    lower(regexp_replace(COALESCE(title, ''), '\s+', ' ', 'g'))
    || '|' ||
    lower(
      COALESCE(
        (regexp_match(COALESCE(authors->>0, ''), '([^\s,]+)'))[1],
        ''
      )
    )
    || '|' ||
    COALESCE(publication_year::text, '')
  ) STORED;

-- 2. Non-unique btree index on an MD5 hash of the dedup key. Raw-string
--    btree index fails when title > ~2700 bytes (Postgres' per-row index
--    limit is 1/3 of a page = 2704 B). MD5 collapses to 32 bytes, well
--    below the limit, and collisions between distinct keys are
--    astronomically unlikely at our scale (<1M rows).
CREATE INDEX IF NOT EXISTS research_articles_canonical_dedup_key_md5_idx
  ON research_articles (md5(canonical_dedup_key));

-- 3. Functional index on lower(doi) for cross-source DOI pre-checks
--    (a second ingest-time dedup layer, separate from the canonical key).
CREATE INDEX IF NOT EXISTS research_articles_doi_lower_idx
  ON research_articles ((lower(doi)))
  WHERE doi IS NOT NULL;

COMMIT;
