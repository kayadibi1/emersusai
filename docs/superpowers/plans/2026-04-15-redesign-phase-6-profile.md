# Frontend Redesign · Phase 6 · Profile (`/app/profile`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`.

**Goal:** Implement Profile with 5 tabs (**Goals · Equipment · Injuries · Integrations [SOON] · Billing**) and bidirectional sync between Profile macro targets and Nutrition.

**Scope rule:** Reskin + new injury/equipment/billing flows. Macro target sync is the canonical path — Phase 4's Nutrition reads from Profile, never writes.

**Spec:** § "6. Profile" + "Behaviors · 5. Profile".
**Mockup:** `.superpowers/brainstorm/linear-landing/profile.html`.
**Prerequisite:** Phases 2+3+4+5 shipped.

**Branch strategy:** `profile_v2` flag.

---

## File structure

- **New:** `app/profile/index-v2.html` + `app/profile/profile.js`
- **New:** `shared/profile/header.js` (avatar + meta + last-trained line + auto-saving + ⋯)
- **New:** `shared/profile/goals-tab.js`
- **New:** `shared/profile/equipment-tab.js`
- **New:** `shared/profile/injuries-tab.js`
- **New:** `shared/profile/integrations-tab.js`
- **New:** `shared/profile/billing-tab.js`
- **New:** `shared/profile/danger-zone.js`
- **New:** `shared/profile-v2.css`
- **New:** `api/emersus/profile.js` — `GET / PATCH /api/profile`
- **New:** `api/emersus/profile-injuries.js` — `POST / PATCH / DELETE /api/profile/injuries`
- **New:** `api/emersus/profile-export.js` — `POST /api/account/export`
- **New:** `api/emersus/profile-delete.js` — `POST /api/account/delete`
- **New:** `api/emersus/integrations-waitlist.js` — `POST /api/integrations/waitlist`
- **New:** `supabase/20260420_profile_extras.sql` — adds missing fields if not present (verify per `docs/schema.md` first)

---

## Task 1: Schema verification + (optional) migration

- [ ] **Step 1:** Verify against `docs/schema.md` + live `\d public.profiles` that fields exist: `goal`, `experience`, `body_weight_kg`, `target_weight_kg`, `height_cm`, `training_env`, `equipment jsonb`, `preferences jsonb`, `macros jsonb`, `macros_overridden_at timestamptz?`, `reminders jsonb`. Also `injuries` table.
- [ ] **Step 2:** Write `supabase/20260420_profile_extras.sql` with `ADD COLUMN IF NOT EXISTS` for any missing field. Do not apply.
- [ ] **Step 3: Commit** `sql(profile): missing-fields migration (pending apply)` (skip if all present).

---

## Task 2: Feature flag + page shell + header

- [ ] **Step 1:** Page shell + tab routing (Goals default).
- [ ] **Step 2:** `<ProfileHeader profile/>` — avatar (48px, hover ✎ badge → file picker → uploads to Supabase storage), name, meta (email · PRIVATE BETA · MEMBER SINCE), last-trained line (from latest workout session), auto-saving indicator, ⋯ menu.
- [ ] **Step 3: Commit** `feat(profile-v2): page shell + header`

---

## Task 3: Profile REST endpoints

- [ ] **Step 1:** `GET /api/profile` — returns the full profile + computed fields (last_trained, member_since).
- [ ] **Step 2:** `PATCH /api/profile { ... }` — partial updates. Validates: `goal ∈ {hypertrophy, strength, endurance, general, hybrid}`, `experience ∈ {beginner, intermediate, advanced}`, weight bounds, etc. On macro PATCH sets `macros_overridden_at = now()` automatically.
- [ ] **Step 3:** Pure validators tested.
- [ ] **Step 4: Commit** `feat(profile-v2): REST router + validators`

---

## Task 4: Goals tab

- [ ] **Step 1:** Goal pills (Hypertrophy / Strength / Endurance / General / Hybrid) → `PATCH /api/profile { goal }`. Show static preview hint (`ADJUSTS · rep ranges · ...`).
- [ ] **Step 2:** Experience pills → PATCH.
- [ ] **Step 3:** Body inputs (weight/target/height) — debounced 500ms PATCH. Weight changes enqueue macro recompute UNLESS `macros_overridden_at` is set.
- [ ] **Step 4:** Weekly target sliders (sessions/volume/distance) — debounced 500ms PATCH `targets`.
- [ ] **Step 5:** 4 macro pills (kcal/P/C/F) — editable. Manual edit sets `macros_overridden_at`. Show subtle `Overridden · click to reset` tooltip when set.
- [ ] **Step 6:** Preference toggles (injury-aware, auto-deload, metric units, daily reminder w/ time chip).
- [ ] **Step 7: Commit** `feat(profile-v2): goals tab`

---

## Task 5: Equipment tab

- [ ] **Step 1:** Environment pills (Home / Commercial / Outdoor / Mixed) → PATCH.
- [ ] **Step 2:** 10+10 checkbox grid with mono sub-labels (e.g., "Olympic barbell · 20 KG STANDARD"). Toggle → PATCH `equipment[]`. Items with sub-specs (kettlebell weight range) open a small popover when checked.
- [ ] **Step 3: Commit** `feat(profile-v2): equipment tab`

---

## Task 6: Injuries tab + endpoints

- [ ] **Step 1:** Server: `POST /api/profile/injuries { name, body_region, severity, movements_to_avoid, note, reported_date }`. `PATCH /api/profile/injuries/:id`. `DELETE`.
- [ ] **Step 2:** UI: active (amber border) + healed (muted) injury rows with citation-backed notes, `+ Report a new injury` dashed CTA. Modal with full fields + multi-select from exercise catalog.
- [ ] **Step 3:** Movements-to-avoid is **derived** (server-side join of all injuries' arrays) — not a separately maintained card.
- [ ] **Step 4: Commit** `feat(profile-v2): injuries tab + endpoints`

---

## Task 7: Integrations tab + waitlist

- [ ] **Step 1:** Server: `POST /api/integrations/waitlist { integration_key }` — append to `integration_waitlist` table (or extend the existing waitlist).
- [ ] **Step 2:** UI: 6 dashed coming-soon tiles with brand-safe labels (Smartwatch sync / HR chest strap / Running watch / Activity platforms / Scale & body metrics / Cycling computers). **No brand names** per legal. `Join waitlist →` per tile → toast `ADDED · WE'LL EMAIL YOU`.
- [ ] **Step 3: Commit** `feat(profile-v2): integrations tab + waitlist`

---

## Task 8: Billing tab + account actions

- [ ] **Step 1:** Plan hero (`Private beta — billing paused`) — static during beta.
- [ ] **Step 2:** Usage grid: `GET /api/usage?window=month` returns counts per feature. Sub-label `UNLIMITED DURING BETA` accent.
- [ ] **Step 3:** Account actions:
  - Change email → modal with new-email + password-confirm + verification code → `POST /api/account/email-change`.
  - Change password → modal → `POST /api/account/password-change` (logs out other sessions).
  - Request export → `POST /api/account/export` returns `{ job_id }`. Email when ready.
- [ ] **Step 4:** Danger zone (separately bordered red card): Delete account modal — type-your-email confirmation, disabled `I understand, delete my account` button until match → `POST /api/account/delete`.
- [ ] **Step 5: Commit** `feat(profile-v2): billing tab + account actions`

---

## Task 9: profile-v2.css

- [ ] **Step 1:** Port profile.html mockup CSS, scoped `[data-profile-v2="1"]`.
- [ ] **Step 2:** Audit. Commit.

---

## Task 10: Flip default + tag

- [ ] **Step 1:** `DEFAULT_FLAGS.profile_v2 = true`. Update flag tests.
- [ ] **Step 2:** Tag `redesign-phase-6-profile`.
- [ ] **Step 3: Commit** `feat(profile-v2): default to true`

---

## Acceptance criteria

1. All 5 tabs render without console errors.
2. Goal pill change persists across reload; cache-busts the chat plan generator.
3. Body weight change auto-recomputes macros — but only if `macros_overridden_at` is null.
4. Injury report flow → row shows up → Movements-to-avoid derived list updates.
5. Integrations Join-waitlist toast renders + appends row.
6. Delete-account flow gated by typed email match.
7. `profile_v2=0` falls back to existing page.
