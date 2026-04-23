-- user_saved_sources
--
-- Per-user bookmark list of research papers. Reference-only (DOI/PMID +
-- bibliographic metadata snapshot) — no abstract / excerpt / full text is
-- duplicated here, so the table stays copyright-clean even at scale.
--
-- Reads/writes go through api/emersus/saved-sources.js, which enforces the
-- Free-tier 20-source cap in the POST path. Pro tier is uncapped.
--
-- See docs/superpowers/specs/2026-04-23-save-to-library-design.md

create extension if not exists "pgcrypto";

create table if not exists public.user_saved_sources (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- Canonical identifier from shared/citation-format.js — DOI, "pmid:NNN",
  -- or an openalex work id. Used to JOIN against research_articles when
  -- the paper is still in-corpus; falls back to meta_snapshot otherwise.
  source_id     text not null,
  saved_at      timestamptz not null default now(),
  -- { thread_id, message_id } captured at save-time so the library can
  -- link back to the conversation that surfaced the source.
  saved_from    jsonb,
  -- Optional user note, capped so the field stays indexable and the
  -- sanitize step has a clean ceiling.
  note          text check (note is null or char_length(note) <= 500),
  -- Denormalised bibliographic fallback for papers that may later leave
  -- research_articles (pruning, retraction re-ingest, source removal).
  -- Only facts — title/authors/journal/year/doi/pmid/source/url — so the
  -- snapshot is not a copyright surface.
  meta_snapshot jsonb not null,
  unique (user_id, source_id)
);

-- Most library reads are "list my saves, newest first". Composite index
-- covers that path without a separate sort.
create index if not exists user_saved_sources_user_saved_idx
  on public.user_saved_sources (user_id, saved_at desc);

alter table public.user_saved_sources enable row level security;

-- Users can only read/write their own rows.
drop policy if exists "users read own saved sources" on public.user_saved_sources;
create policy "users read own saved sources"
on public.user_saved_sources
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users insert own saved sources" on public.user_saved_sources;
create policy "users insert own saved sources"
on public.user_saved_sources
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "users delete own saved sources" on public.user_saved_sources;
create policy "users delete own saved sources"
on public.user_saved_sources
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "users update own saved sources" on public.user_saved_sources;
create policy "users update own saved sources"
on public.user_saved_sources
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Service role gets full access for server-side handlers and analytics jobs.
drop policy if exists "service role can manage user_saved_sources" on public.user_saved_sources;
create policy "service role can manage user_saved_sources"
on public.user_saved_sources
for all
to service_role
using (true)
with check (true);
