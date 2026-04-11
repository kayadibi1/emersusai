-- Tracking + batch-update RPC for the retroactive XML reparse that
-- populates is_retracted, retraction_notes, abstract_sections, and
-- publication_country for the ~210k already-ingested articles.
--
-- New column metadata_reparsed_at acts as the "done / not done" flag
-- for the backfill script, so it's resumable/idempotent by selecting
-- WHERE metadata_reparsed_at IS NULL. We use a timestamptz (not a
-- boolean) so future audits can tell when a given row was processed.
--
-- Partial index: only rows still awaiting reparse are in the index,
-- making the paginating cursor scan cheap regardless of how many
-- rows are already done.
--
-- RPC takes a jsonb array of rows and updates all of them in a
-- single UPDATE ... FROM, the same pattern as
-- update_pubmed_rcr_batch / update_pubmed_citations_batch.

ALTER TABLE public.pubmed_articles
  ADD COLUMN IF NOT EXISTS metadata_reparsed_at timestamptz;

CREATE INDEX IF NOT EXISTS pubmed_articles_metadata_reparsed_null_idx
  ON public.pubmed_articles (pmid)
  WHERE metadata_reparsed_at IS NULL;

CREATE OR REPLACE FUNCTION public.update_pubmed_enrichment_batch(updates jsonb)
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
      (u->>'pmid')::bigint                             AS pmid,
      COALESCE((u->>'is_retracted')::boolean, false)   AS is_retracted,
      NULLIF(u->>'retraction_notes', '')               AS retraction_notes,
      -- abstract_sections is jsonb — pull it as jsonb if present, else null
      CASE
        WHEN u ? 'abstract_sections' AND u->'abstract_sections' != 'null'::jsonb
          THEN u->'abstract_sections'
        ELSE NULL
      END                                              AS abstract_sections,
      NULLIF(u->>'publication_country', '')            AS publication_country
    FROM jsonb_array_elements(updates) u
    WHERE u ? 'pmid'
  )
  UPDATE public.pubmed_articles p
     SET is_retracted         = payload.is_retracted,
         retraction_notes     = payload.retraction_notes,
         abstract_sections    = payload.abstract_sections,
         publication_country  = payload.publication_country,
         metadata_reparsed_at = now(),
         updated_at           = now()
    FROM payload
   WHERE p.pmid = payload.pmid;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_pubmed_enrichment_batch(jsonb)
  TO authenticated, service_role;
