-- supabase/20260415_corpus_rls_and_timeouts.sql
-- Applied directly to prod Hetzner Postgres on 2026-04-15.
-- Kept here as the paper trail for the two checkpoint follow-ups.
--
-- 1) RLS footgun — evidence_chunks + research_articles had
--    rowsecurity=true with ZERO policies defined, which is an implicit
--    deny for any non-bypassing role. The API works today because
--    supabaseAdmin uses service_role (which has BYPASSRLS), but any
--    future code path dropping to a user-JWT Supabase client against
--    these tables would silently return an empty array. These are
--    read-only reference corpora — add permissive SELECT policies.
--    Writes remain RLS-blocked (no INSERT/UPDATE/DELETE policies).
--
-- 2) HNSW cold-cache cushion — 20 GB HNSW index on a 16 GB box means
--    cold queries can exceed the 8s statement_timeout under load.
--    Observed in the 2026-04-12 corpus-fill window. Bump to 15s for
--    the roles PostgREST uses so we have a cushion without giving
--    up the protection entirely.

DROP POLICY IF EXISTS allow_select_all ON public.evidence_chunks;
DROP POLICY IF EXISTS allow_select_all ON public.research_articles;

CREATE POLICY allow_select_all
  ON public.evidence_chunks
  FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY allow_select_all
  ON public.research_articles
  FOR SELECT
  TO authenticated, anon
  USING (true);

ALTER ROLE authenticator SET statement_timeout = '15s';
ALTER ROLE authenticated SET statement_timeout = '15s';

-- Note: PostgREST connects as `authenticator` and holds a persistent
-- pool, so new role-level settings only take effect after:
--   docker restart supabase-rest
