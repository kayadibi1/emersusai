create table if not exists public.waitlist_signups (
  id bigint generated always as identity primary key,
  name text,
  surname text,
  company text,
  email text not null unique,
  source text not null default 'landing-page',
  page_url text,
  referrer text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.waitlist_signups add column if not exists name text;
alter table public.waitlist_signups add column if not exists surname text;
alter table public.waitlist_signups add column if not exists company text;

alter table public.waitlist_signups enable row level security;

create policy "service role can manage waitlist_signups"
on public.waitlist_signups
as permissive
for all
to service_role
using (true)
with check (true);
