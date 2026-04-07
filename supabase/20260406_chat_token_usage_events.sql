create table if not exists public.chat_token_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  stable_user_id text,
  thread_id uuid,
  question_preview text not null,
  topic text,
  risk_level text,
  model text,
  openai_response_id text,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  client_ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_token_usage_events_created_at_idx
  on public.chat_token_usage_events (created_at desc);

create index if not exists chat_token_usage_events_user_id_idx
  on public.chat_token_usage_events (user_id);

create index if not exists chat_token_usage_events_thread_id_idx
  on public.chat_token_usage_events (thread_id);

create index if not exists chat_token_usage_events_stable_user_id_idx
  on public.chat_token_usage_events (stable_user_id);

alter table public.chat_token_usage_events enable row level security;

drop policy if exists "service role can manage chat_token_usage_events" on public.chat_token_usage_events;
create policy "service role can manage chat_token_usage_events"
on public.chat_token_usage_events
for all
to service_role
using (true)
with check (true);
