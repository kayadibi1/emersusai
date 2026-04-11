-- Batch-update RPCs used by scripts/backfill-icite-rcr.js and
-- scripts/backfill-semantic-scholar.js.
--
-- supabase-js cannot execute raw SQL, and upsert() requires satisfying
-- every NOT NULL constraint on INSERT even when the row will actually
-- go through the ON CONFLICT UPDATE path — that's awkward here because
-- we only want to update one or two columns on an existing row.
--
-- These RPCs take a jsonb array like [{pmid, rcr}] or
-- [{pmid, citation_count, influential_citation_count}] and update every
-- row in a single query. Each RPC returns the number of rows affected
-- so the caller can track progress.

CREATE OR REPLACE FUNCTION public.update_pubmed_rcr_batch(updates jsonb)
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
      (u->>'pmid')::bigint  AS pmid,
      (u->>'rcr')::numeric  AS rcr
    FROM jsonb_array_elements(updates) u
    WHERE u ? 'pmid' AND u ? 'rcr'
  )
  UPDATE public.pubmed_articles p
     SET rcr = payload.rcr,
         updated_at = now()
    FROM payload
   WHERE p.pmid = payload.pmid;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

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
      (u->>'pmid')::bigint                               AS pmid,
      NULLIF(u->>'citation_count', '')::integer          AS citation_count,
      NULLIF(u->>'influential_citation_count', '')::integer AS influential_citation_count
    FROM jsonb_array_elements(updates) u
    WHERE u ? 'pmid'
  )
  UPDATE public.pubmed_articles p
     SET citation_count              = COALESCE(payload.citation_count, p.citation_count),
         influential_citation_count  = COALESCE(payload.influential_citation_count, p.influential_citation_count),
         updated_at                  = now()
    FROM payload
   WHERE p.pmid = payload.pmid;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_pubmed_rcr_batch(jsonb)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.update_pubmed_citations_batch(jsonb)
  TO authenticated, service_role;
