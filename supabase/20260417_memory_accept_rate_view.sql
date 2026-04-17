-- supabase/20260417_memory_accept_rate_view.sql
-- Phase 6 observability — spec §13 "Accept rate is the key product signal".
--
-- Accept rate = confirmed / (confirmed + rejected) across auto-extracted
-- rows over the last 7 days. 60-90% is healthy. Below ~60% → extractor is
-- too eager (tune prompt or shrink whitelist). Above ~90% → we're too
-- conservative (expand whitelist or drop confidence threshold).
--
-- View is SECURITY INVOKER via the default so RLS applies to each caller.
-- Service-role (worker, ops) sees across users; regular auth'd users see
-- only their own rows, which is the right answer for a "my accept rate"
-- per-user view in the Memory tab later (Phase 6.5 if ever).
--
-- Idempotent: create or replace view.

begin;

create or replace view public.v_memory_accept_rate_7d as
with windowed as (
  select
    user_id,
    status
  from public.user_memories
  where source = 'auto_extract'
    and created_at >= now() - interval '7 days'
    and status in ('confirmed', 'rejected')
)
select
  count(*) filter (where status = 'confirmed')::int  as confirmed_count,
  count(*) filter (where status = 'rejected')::int   as rejected_count,
  count(*)::int                                       as total_resolved,
  round(
    case when count(*) = 0 then null
      else (count(*) filter (where status = 'confirmed'))::numeric
           / nullif(count(*), 0)
    end,
    3
  ) as accept_rate,
  now() as computed_at
from windowed;

comment on view public.v_memory_accept_rate_7d is
  'Phase 6: rolling 7-day auto-extractor accept rate (confirmed vs rejected). RLS-invoker; service-role sees global.';

grant select on public.v_memory_accept_rate_7d to authenticated, service_role;

-- Per-user variant for the future per-user dashboard.
create or replace view public.v_memory_accept_rate_7d_by_user as
with windowed as (
  select
    user_id,
    status
  from public.user_memories
  where source = 'auto_extract'
    and created_at >= now() - interval '7 days'
    and status in ('confirmed', 'rejected')
)
select
  user_id,
  count(*) filter (where status = 'confirmed')::int  as confirmed_count,
  count(*) filter (where status = 'rejected')::int   as rejected_count,
  count(*)::int                                       as total_resolved,
  round(
    (count(*) filter (where status = 'confirmed'))::numeric
      / nullif(count(*), 0),
    3
  ) as accept_rate
from windowed
group by user_id;

comment on view public.v_memory_accept_rate_7d_by_user is
  'Phase 6: per-user 7-day auto-extractor accept rate. RLS-invoker; each user sees their own row.';

grant select on public.v_memory_accept_rate_7d_by_user to authenticated, service_role;

commit;
