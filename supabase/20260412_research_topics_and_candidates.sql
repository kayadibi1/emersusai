-- supabase/20260412_research_topics_and_candidates.sql
-- Creates research_topics (replaces hardcoded TOPIC_QUERIES object) and
-- topic_candidates (the discovery review queue). research_topics has a
-- forward reference to topic_candidates via source_candidate_id FK — we
-- create both tables then add the FK last.

BEGIN;

CREATE TABLE IF NOT EXISTS public.research_topics (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic_key            text NOT NULL UNIQUE,
  query                text NOT NULL,
  domain               text,
  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'paused', 'deprecated')),
  origin               text NOT NULL DEFAULT 'seed'
                         CHECK (origin IN ('seed', 'discovered', 'manual')),
  source_candidate_id  bigint,
  target_paper_count   integer NOT NULL DEFAULT 2000,
  last_filled_at       timestamptz,
  last_fill_count      integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_topics_domain_idx ON public.research_topics(domain);
CREATE INDEX IF NOT EXISTS research_topics_status_idx ON public.research_topics(status);

CREATE TABLE IF NOT EXISTS public.topic_candidates (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic_key        text NOT NULL UNIQUE,
  raw_term         text NOT NULL,
  suggested_query  text,
  confidence       numeric(3,2) NOT NULL,
  rationale        text,
  source_urls      text[] NOT NULL,
  discovery_feed   text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'rejected', 'snoozed')),
  decided_at       timestamptz,
  decided_by       text,
  snooze_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS topic_candidates_status_idx
  ON public.topic_candidates(status);
CREATE INDEX IF NOT EXISTS topic_candidates_created_desc_idx
  ON public.topic_candidates(created_at DESC);

ALTER TABLE public.research_topics
  ADD CONSTRAINT research_topics_source_candidate_fk
  FOREIGN KEY (source_candidate_id)
  REFERENCES public.topic_candidates(id)
  ON DELETE SET NULL;

COMMIT;
