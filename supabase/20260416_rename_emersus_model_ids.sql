-- 2026-04-16 — rebrand: drop "0.5" version suffix from chat_threads.model
--
-- The product brand for the chat model dropped the "0.5" version suffix
-- (UI labels became "Emersus", "Emersus · Fast", "Emersus · Deep"). The
-- underlying tier ids stored in chat_threads.model still carried the old
-- "emersus-0.5*" form, so existing thread rows + the column default need
-- to be migrated.
--
-- Apply with the standard runbook:
--   ssh hetzner "cd ~/supabase-docker && docker compose exec -T db \
--     psql -U supabase_admin -d postgres" < supabase/20260416_rename_emersus_model_ids.sql
--
-- Reversible: re-run with the values swapped if needed.

begin;

-- 1. Move existing rows to the new ids.
update public.chat_threads
   set model = case model
                 when 'emersus-0.5'      then 'emersus'
                 when 'emersus-0.5-fast' then 'emersus-fast'
                 when 'emersus-0.5-deep' then 'emersus-deep'
                 else model
               end
 where model in ('emersus-0.5', 'emersus-0.5-fast', 'emersus-0.5-deep');

-- 2. Update the column default for new threads.
alter table public.chat_threads
  alter column model set default 'emersus';

comment on column public.chat_threads.model
  is 'Per-thread model override. Maps to OPENAI_EMERSUS_MODEL tier. Defaults to emersus.';

commit;

-- Verification (run separately, not in the transaction):
-- select model, count(*) from public.chat_threads group by model order by model;
--   expected: only 'emersus', 'emersus-fast', 'emersus-deep' (no '0.5' rows).
