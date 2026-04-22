-- supabase/20260422_resolve_exercise_normalize.sql
-- Guard against garbage auto-created exercise rows by normalizing
-- LLM-generated exercise names BEFORE the 4-tier resolver runs.
--
-- Before: "Seated Row or Band Row" fell through all match tiers and
-- auto-created a row with slug `seated_row_or_band_row`, polluting the
-- catalog.
--
-- After: the normalizer strips parentheticals, cuts at the first
-- " or " / " / " / " | " separator, and trims whitespace. Then the
-- name goes through exact-match → alias → trigram → auto-create as
-- before. Compound names like "Romanian Deadlift (or Good Morning)"
-- or "Seated Row or Band Row" now reduce to their left-side canonical
-- term and hit an existing row.
--
-- The fallback insert also uses the normalized name, so even when we
-- DO need to auto-create, the slug is clean (e.g., "farmers_carry"
-- instead of "farmers_carry_or_suitcase_carry").
--
-- Idempotent (CREATE OR REPLACE). Safe to re-run.

CREATE OR REPLACE FUNCTION public.resolve_exercise_id(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_slug text;
  v_name text;
BEGIN
  -- Normalize before matching:
  --   1. Strip parentheticals like "(or Good Morning)".
  --   2. Take everything up to the first " or ", " / ", or " | " so
  --      compound names fall back to their primary term.
  --   3. Trim leading/trailing whitespace.
  -- The '(?i)' prefix makes the separator match case-insensitive so
  -- "Romanian Deadlift OR Good Morning" also gets cut.
  v_name := trim(regexp_replace(COALESCE(p_name, ''), '\s*\([^)]*\)', '', 'g'));
  v_name := trim((regexp_split_to_array(v_name, '(?i)\s+(or|/|\|)\s+'))[1]);

  -- If normalization strips everything, bail out rather than auto-create
  -- a blank row.
  IF v_name IS NULL OR v_name = '' THEN
    RETURN NULL;
  END IF;

  -- 1. Exact name match (case-insensitive)
  SELECT id INTO v_id
  FROM public.exercises
  WHERE lower(name) = lower(v_name)
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- 2. Alias match
  SELECT id INTO v_id
  FROM public.exercises
  WHERE lower(v_name) = ANY(
    SELECT lower(a) FROM unnest(aliases) AS a
  )
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- 3. Fuzzy match via pg_trgm (name + aliases)
  SELECT id INTO v_id
  FROM (
    SELECT id, GREATEST(
      similarity(lower(name), lower(v_name)),
      COALESCE((
        SELECT MAX(similarity(lower(a), lower(v_name)))
        FROM unnest(aliases) AS a
      ), 0)
    ) AS sim
    FROM public.exercises
  ) sub
  WHERE sub.sim >= 0.6
  ORDER BY sub.sim DESC
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- 4. Auto-create (last resort), using the normalized name so the
  -- slug stays clean even on a miss.
  v_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '_', 'g'));
  v_slug := regexp_replace(v_slug, '^_|_$', '', 'g');

  INSERT INTO public.exercises (slug, name, category, auto_created)
  VALUES (v_slug, v_name, 'resistance', true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
