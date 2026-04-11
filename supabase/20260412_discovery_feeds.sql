-- supabase/20260412_discovery_feeds.sql
-- Config + watermark state for RSS/API feeds scanned by the discovery pipeline.

BEGIN;

CREATE TABLE IF NOT EXISTS public.discovery_feeds (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('rss', 'atom', 'api')),
  url                   text NOT NULL,
  source_plugin         text NOT NULL,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'disabled')),
  last_item_at          timestamptz,
  last_run_at           timestamptz,
  last_item_count       integer NOT NULL DEFAULT 0,
  consecutive_failures  integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discovery_feeds_status_idx
  ON public.discovery_feeds(status);

COMMIT;
