-- Email delivery + engagement tracking
-- Writer: Sid (2026-04-24)
-- Spec: docs/superpowers/specs/2026-04-24-email-templates-design.md

-- Send log: one row per outbound email. resend_id is populated AFTER the
-- send succeeds; a NULL resend_id means the send failed or is in-flight.
create table if not exists email_sends (
  id            uuid primary key default gen_random_uuid(),
  resend_id     text unique,
  template      text not null,
  user_id       uuid references auth.users(id) on delete cascade,
  to_email      text not null,
  subject       text not null,
  tags          jsonb not null default '{}'::jsonb,
  sent_at       timestamptz not null default now()
);

create index if not exists email_sends_user_sent_idx
  on email_sends (user_id, sent_at desc);

create index if not exists email_sends_template_sent_idx
  on email_sends (template, sent_at desc);

-- Resend delivery/engagement events. `kind` is normalized from Resend's
-- event types: email.delivered -> 'delivered', email.complained -> 'complained', etc.
create table if not exists email_events (
  id            uuid primary key default gen_random_uuid(),
  send_id       uuid references email_sends(id) on delete cascade,
  resend_id     text not null,
  kind          text not null,
  payload       jsonb not null,
  occurred_at   timestamptz not null,
  constraint email_events_kind_ck check (
    kind in ('delivered','bounced','complained','opened','clicked','delivery_delayed')
  )
);

-- Composite uniqueness prevents duplicate webhook retries from double-inserting.
create unique index if not exists email_events_dedup_idx
  on email_events (resend_id, kind, occurred_at);

create index if not exists email_events_send_occurred_idx
  on email_events (send_id, occurred_at desc);

-- Marketing suppression list. Transactional sends ignore this entirely.
create table if not exists email_unsubscribes (
  user_id         uuid references auth.users(id) on delete cascade,
  bucket          text not null,
  source          text not null,
  unsubscribed_at timestamptz not null default now(),
  primary key (user_id, bucket),
  constraint email_unsubscribes_bucket_ck check (
    bucket in ('research_alerts','engagement','all_marketing')
  ),
  constraint email_unsubscribes_source_ck check (
    source in ('one_click','profile','complaint')
  )
);

-- RLS: server-side-only writes (service role). Users can read their own
-- email_sends and their own email_unsubscribes. email_events is admin-only.
alter table email_sends enable row level security;
alter table email_events enable row level security;
alter table email_unsubscribes enable row level security;

create policy email_sends_self_select on email_sends
  for select using (auth.uid() = user_id);

create policy email_unsubscribes_self_select on email_unsubscribes
  for select using (auth.uid() = user_id);

-- (no user-facing policy on email_events — service role bypasses RLS)
