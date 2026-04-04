create table if not exists public.knowledge_documents (
  id bigint generated always as identity primary key,
  title text not null,
  summary text,
  url text,
  topic text not null check (
    topic in ('strength', 'cardio', 'nutrition', 'mental_performance')
  ),
  source_type text not null default 'database',
  evidence_level text,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  searchable tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(metadata::text, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_documents_topic_idx
  on public.knowledge_documents (topic);

create index if not exists knowledge_documents_published_at_idx
  on public.knowledge_documents (published_at desc nulls last);

create index if not exists knowledge_documents_searchable_idx
  on public.knowledge_documents using gin (searchable);

alter table public.knowledge_documents enable row level security;

drop policy if exists "service role can manage knowledge_documents" on public.knowledge_documents;
create policy "service role can manage knowledge_documents"
on public.knowledge_documents
for all
to service_role
using (true)
with check (true);

drop trigger if exists set_knowledge_documents_updated_at on public.knowledge_documents;
create trigger set_knowledge_documents_updated_at
before update on public.knowledge_documents
for each row
execute function public.set_current_timestamp_updated_at();

create or replace function public.match_knowledge_documents(
  query_text text,
  match_count integer default 6,
  requested_topic text default null,
  user_goal text default null
)
returns table (
  id bigint,
  title text,
  summary text,
  url text,
  topic text,
  source_type text,
  evidence_level text,
  published_at timestamptz,
  metadata jsonb,
  database_score double precision
)
language sql
security definer
set search_path = public
as $$
  with query as (
    select plainto_tsquery('english', coalesce(query_text, '')) as q
  ),
  ranked as (
    select
      d.id,
      d.title,
      d.summary,
      d.url,
      d.topic,
      d.source_type,
      d.evidence_level,
      d.published_at,
      d.metadata,
      ts_rank(d.searchable, query.q) as lexical_score,
      case
        when d.published_at is null then 0.45
        when d.published_at >= now() - interval '180 days' then 1.0
        when d.published_at >= now() - interval '2 years' then 0.82
        when d.published_at >= now() - interval '5 years' then 0.66
        else 0.5
      end as freshness_score,
      case
        when lower(coalesce(d.evidence_level, '')) similar to '%(meta|systematic|guideline|consensus)%' then 1.0
        when lower(coalesce(d.evidence_level, '')) similar to '%(trial|rct|peer|journal)%' then 0.84
        when lower(coalesce(d.evidence_level, '')) similar to '%(expert|news|blog)%' then 0.58
        else 0.68
      end as evidence_score,
      case
        when user_goal is not null and lower(coalesce(d.summary, '') || ' ' || coalesce(d.title, '')) like '%' || lower(user_goal) || '%' then 0.12
        else 0
      end as goal_bonus
    from public.knowledge_documents d
    cross join query
    where
      (requested_topic is null or d.topic = requested_topic)
      and (
        query_text is null
        or query_text = ''
        or d.searchable @@ query.q
      )
  ),
  scored as (
    select
      id,
      title,
      summary,
      url,
      topic,
      source_type,
      evidence_level,
      published_at,
      metadata,
      greatest(
        0,
        least(1, lexical_score * 0.5 + freshness_score * 0.25 + evidence_score * 0.25 + goal_bonus)
      ) as database_score
    from ranked
  )
  select
    id,
    title,
    summary,
    url,
    topic,
    source_type,
    evidence_level,
    published_at,
    metadata,
    database_score
  from scored
  order by database_score desc, published_at desc nulls last
  limit greatest(1, least(match_count, 12));
$$;
