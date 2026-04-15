# Frontend Redesign · Phase 6 · Profile (`/app/profile`) Implementation Plan — Outline

> **Status:** Outline. Expand before executing.

**Goal:** Implement Profile with 5 tabs (Goals · Equipment · Injuries · Integrations [SOON] · Billing) and bidirectional sync between Profile and Nutrition for macro targets.

**Spec:** `2026-04-15-frontend-redesign-design.md` § "6. Profile" + "Behaviors · 5. Profile".
**Mockup:** `.superpowers/brainstorm/linear-landing/profile.html`.
**Feature flag:** `profile_v2`.

## File structure (proposed)

- **New:** `app/profile/goals-tab.js` — focus + experience pills, body inputs, sliders, macro pills, preference toggles
- **New:** `app/profile/equipment-tab.js` — environment + checkboxes with item-descriptive labels
- **New:** `app/profile/injuries-tab.js` — injury list + `+ Report a new injury` modal
- **New:** `app/profile/integrations-tab.js` — 6 coming-soon tiles with `Join waitlist` CTAs
- **New:** `app/profile/billing-tab.js` — plan hero, usage grid, account actions, danger zone
- **New:** `app/profile/profile-header.js` — avatar + name + last-trained + auto-save
- **New:** `shared/profile-v2.css`
- **New SQL:** `supabase/2026-04-XX_profile_injuries.sql` — verify `injuries` table exists with required fields
- **New:** `api/emersus/profile-injuries.js` — CRUD for injuries
- **New:** `api/emersus/integrations-waitlist.js` — `POST /api/integrations/waitlist { integration_key }`
- **New:** `api/emersus/account-*.js` — `email-change`, `password-change`, `export`, `delete`

## Task outline (~18 tasks)

1. `profile_v2` flag + tab routing
2. Profile header — avatar with edit hover + name/meta + last-trained
3. Goals — training focus pills + preview hint
4. Goals — experience pills
5. Goals — body inputs with debounced PATCH
6. Goals — weekly target sliders (sessions/volume/distance) with min/max labels
7. Goals — macro pills (editable) + sync to Nutrition + `overridden_at` tracking
8. Goals — preference toggles (injury-aware, auto-deload, metric units, daily reminder with time chip)
9. Equipment — environment pill + checkbox grid with item-descriptive sub-labels
10. Injuries — list rendering (active amber border vs healed muted)
11. Injuries — `+ Report a new injury` modal
12. Injuries — edit + mark-healed + delete flows
13. Integrations — 6 coming-soon tiles + `Join waitlist` endpoint
14. Billing — plan hero + usage grid (UNLIMITED DURING BETA subtitle)
15. Billing — change email / password / export modals
16. Billing — danger zone delete-account with type-email confirmation
17. Metric-units toggle — global client state; all weight/distance displays re-render
18. Flip flag default + tag

## Acceptance criteria

- Editing any field PATCHes within 500ms and shows the auto-save pulse.
- Macro target edits reflect in Nutrition page within 1 reload.
- Injury `movements_to_avoid` feeds exercise filtering in Train.
- Danger zone button is disabled until typed email matches.
- Both themes.

## Open questions

- Avatar upload — Supabase Storage or Gravatar? Default: Supabase Storage bucket `avatars/`.
- Delete-account restore window — spec says "30 days to restore"; verify the soft-delete implementation.
