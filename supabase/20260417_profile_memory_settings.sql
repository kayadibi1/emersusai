-- supabase/20260417_profile_memory_settings.sql
-- Seed profiles.preferences.memory_autosave=true for existing users.
-- See docs/superpowers/specs/2026-04-16-cross-thread-memory-design.md §4.3.

begin;

update public.profiles
set preferences = coalesce(preferences, '{}'::jsonb) ||
                  jsonb_build_object('memory_autosave', true)
where preferences is null
   or not (preferences ? 'memory_autosave');

commit;
