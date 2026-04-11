-- Batch rechunk RPC for scripts/chunk-structured-abstracts.js.
--
-- For each PMID in the payload: delete the generic chunk_type='abstract'
-- rows, insert the new per-section chunks, and stamp
-- chunks_sectioned_at = now() on the pubmed_articles row. Wrapped in a
-- single function so the delete/insert/update happens atomically per
-- batch — if the function errors partway through, no rows land.
--
-- Payload shape:
--   [
--     {
--       "pmid": 12345,
--       "chunks": [
--         {"chunk_type": "abstract_background", "content": "..."},
--         {"chunk_type": "abstract_methods",    "content": "..."},
--         ...
--       ]
--     },
--     ...
--   ]
--
-- Returns the number of pubmed_articles rows stamped (not the total
-- chunks inserted) so the caller can track progress.
--
-- New chunks are inserted with embedding NULL; the existing
-- scripts/embed-evidence.js picks them up in a separate pass.

CREATE OR REPLACE FUNCTION public.rechunk_abstract_sections_batch(updates jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer := 0;
  paper jsonb;
  chunk jsonb;
  paper_pmid bigint;
BEGIN
  FOR paper IN SELECT * FROM jsonb_array_elements(updates)
  LOOP
    paper_pmid := (paper->>'pmid')::bigint;
    IF paper_pmid IS NULL THEN
      CONTINUE;
    END IF;

    -- Drop the old flat abstract chunks for this paper. Title and
    -- full_text chunks are intentionally left alone.
    DELETE FROM public.evidence_chunks
      WHERE pmid = paper_pmid
        AND chunk_type = 'abstract';

    -- Insert the new per-section chunks (embedding NULL; backfilled by
    -- scripts/embed-evidence.js on a subsequent run).
    FOR chunk IN SELECT * FROM jsonb_array_elements(paper->'chunks')
    LOOP
      INSERT INTO public.evidence_chunks (pmid, chunk_type, content, metadata)
      VALUES (
        paper_pmid,
        chunk->>'chunk_type',
        chunk->>'content',
        jsonb_build_object('source', 'rechunk-structured-abstract')
      );
    END LOOP;

    -- Mark the paper done so re-runs skip it.
    UPDATE public.pubmed_articles
       SET chunks_sectioned_at = now(),
           updated_at = now()
     WHERE pmid = paper_pmid;

    IF FOUND THEN
      affected := affected + 1;
    END IF;
  END LOOP;

  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rechunk_abstract_sections_batch(jsonb)
  TO authenticated, service_role;
