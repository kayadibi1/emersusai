-- 2026-04-15 — threads: per-thread model override + share-token columns
--
-- Part of Frontend Redesign Phase 2 (Chat). Adds:
--   - threads.model: per-thread model override (defaults to emersus-0.5)
--   - threads.shared_token: opaque token for /share/t/<token> public read-only renders
--   - threads.shared_expires_at: expiry for the shared token
--
-- NOT YET APPLIED to production Hetzner Supabase.
-- Apply with:
--   ssh hetzner 'cd ~/app && ~/app/infra/apply-migrations.sh \
--     20260415_threads_model_share.sql'
-- (self-hosted Supabase requires supabase_admin role — see memory note
--  project_supabase_admin_role.md)

alter table public.threads
  add column if not exists model text not null default 'emersus-0.5',
  add column if not exists shared_token text unique,
  add column if not exists shared_expires_at timestamptz;

create index if not exists threads_shared_token_idx
  on public.threads (shared_token)
  where shared_token is not null;

comment on column public.threads.model
  is 'Per-thread model override. Maps to OPENAI_EMERSUS_MODEL tier. Defaults to emersus-0.5.';
comment on column public.threads.shared_token
  is 'Opaque token for /share/t/<token> read-only public render. Null means not shared.';
comment on column public.threads.shared_expires_at
  is 'Expiry for shared_token. After this timestamp /share/t/<token> returns 410 Gone.';
