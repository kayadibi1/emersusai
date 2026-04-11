-- Tracker column + RPC for the Semantic Scholar backfill. The
-- previous selector (influential_citation_count IS NULL) couldn't
-- distinguish three cases:
--   1. "never tried"      — needs S2 call
--   2. "tried, got data"  — done
--   3. "tried, S2 doesn't have this paper" — done, but stays NULL
--   4. "tried, S2 400s on this batch"      — permanent skip
--
-- We need a dedicated "tried at all" timestamp so the script can
-- make permanent progress through (3) and (4) without getting stuck
-- re-processing the same papers forever.
--
-- s2_checked_at is stamped by update_pubmed_citations_batch (for
-- successful updates) and by mark_pubmed_s2_checked (for missing /
-- rejected PMIDs that the script couldn't get data for).
--
-- The existing ~200k rows with influential_citation_count populated
-- get s2_checked_at = now() so the new selector doesn't reselect
-- them. From here on, s2_checked_at IS NULL means "never tried".

ALTER TABLE public.pubmed_articles
  ADD COLUMN IF NOT EXISTS s2_checked_at timestamptz;

-- Backfill: anything we already successfully processed counts as checked.
UPDATE public.pubmed_articles
   SET s2_checked_at = now()
 WHERE s2_checked_at IS NULL
   AND influential_citation_count IS NOT NULL;

-- Partial index so the script's cursor-based paginate scan stays cheap
-- as it converges.
CREATE INDEX IF NOT EXISTS pubmed_articles_s2_unchecked_idx
  ON public.pubmed_articles (pmid)
  WHERE s2_checked_at IS NULL;

-- Extend update_pubmed_citations_batch to also stamp s2_checked_at.
CREATE OR REPLACE FUNCTION public.update_pubmed_citations_batch(updates jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  WITH payload AS (
    SELECT
      (u->>'pmid')::bigint                                  AS pmid,
      NULLIF(u->>'citation_count', '')::integer             AS citation_count,
      NULLIF(u->>'influential_citation_count', '')::integer AS influential_citation_count
    FROM jsonb_array_elements(updates) u
    WHERE u ? 'pmid'
  )
  UPDATE public.pubmed_articles p
     SET citation_count             = COALESCE(payload.citation_count, p.citation_count),
         influential_citation_count = COALESCE(payload.influential_citation_count, p.influential_citation_count),
         s2_checked_at              = now(),
         updated_at                 = now()
    FROM payload
   WHERE p.pmid = payload.pmid;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- New RPC: bulk-mark a list of PMIDs as "we tried, no usable data
-- came back". Used by the S2 script for (a) PMIDs present in the
-- input but omitted from a successful batch response (S2 doesn't
-- index them) and (b) PMIDs in a batch that the API 400s on — after
-- the caller has bisected down to the smallest failing sub-batch.
CREATE OR REPLACE FUNCTION public.mark_pubmed_s2_checked(pmid_list bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.pubmed_articles
     SET s2_checked_at = now(),
         updated_at    = now()
   WHERE pmid = ANY(pmid_list)
     AND s2_checked_at IS NULL;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_pubmed_s2_checked(bigint[])
  TO authenticated, service_role;
