create table if not exists public.guardrail_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  stable_user_id text,
  event_type text not null check (
    event_type in (
      'allowed_with_caution',
      'medical_boundary',
      'disallowed_unsafe',
      'prompt_injection_or_system_probe'
    )
  ),
  response_mode text not null,
  reasons jsonb not null default '[]'::jsonb,
  question_preview text not null,
  topic text,
  risk_level text,
  client_ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists guardrail_events_created_at_idx
  on public.guardrail_events (created_at desc);

create index if not exists guardrail_events_event_type_idx
  on public.guardrail_events (event_type);

create index if not exists guardrail_events_user_id_idx
  on public.guardrail_events (user_id);

alter table public.guardrail_events enable row level security;

drop policy if exists "service role can manage guardrail_events" on public.guardrail_events;
create policy "service role can manage guardrail_events"
on public.guardrail_events
for all
to service_role
using (true)
with check (true);
