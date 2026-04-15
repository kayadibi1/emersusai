# Frontend Redesign · Phase 9 · Conversational Onboarding Implementation Plan — Outline

> **Status:** Outline. Expand before executing.

**Goal:** First-run users land in `/app` with an auto-created onboarding thread. Emersus asks open-ended questions, extracts structured fields via a new `extract_profile` tool, writes them to Profile, and ends when all required fields are captured. Replaces the quiz-widget onboarding (rejected and deleted 2026-04-15 per memory).

**Spec:**
- `2026-04-15-frontend-redesign-design.md` § "9. Onboarding" + "Behaviors · 8. Onboarding"
- Existing conversational-onboarding spec: `docs/superpowers/specs/2026-04-10-conversational-onboarding-design.md` (earlier iteration — reconcile details with the 2026-04-15 spec)

**Feature flag:** `conversational_onboarding`.

## File structure (proposed)

- **Modify:** `api/emersus/pipeline/onboarding.js` — exists; extend with new system-prompt override
- **New:** `api/emersus/pipeline/tools.js` — add `extract_profile` tool definition (note: there's already a `tools.js` — verify contents and integrate)
- **New:** `api/emersus/pipeline/extract-profile-tool.js` — tool handler that writes to `/api/profile`
- **Modify:** `api/emersus/workflow.js` — detect onboarding mode (thread metadata), emit `<onboarding-complete>` token when the model's extraction covers all required fields
- **Modify:** `shared/react-chat-app.js` — recognize onboarding mode (URL `?onboarding=1` or thread metadata); hide model pill + share + ⋯ during onboarding; show `Skip setup →` button; on `<onboarding-complete>`, remove flag + restore full chrome
- **Modify:** `api/emersus/threads.js` — new-user detection (empty profile) → auto-create onboarding thread with seeded system-prompt

## Task outline (~10 tasks)

1. `conversational_onboarding` flag
2. Onboarding system-prompt override (matches the spec's ONBOARDING MODE block)
3. `extract_profile` tool definition + handler (writes `goal`, `experience`, `body_weight_kg`, `height_cm`, `training_env`, `equipment`, `injuries[]`, `weekly_sessions_target`)
4. Thread metadata — `threads.onboarding boolean not null default false` (migration)
5. New-user detection — after signup, if profile is empty and flag on, auto-create onboarding thread
6. First assistant message — seeded "Welcome to Emersus. Before we start..."
7. `<onboarding-complete>` sentinel — emitted when all required fields are captured
8. Client — recognize onboarding mode; show `Skip setup →`
9. Client — on complete, remove flag; restore chrome
10. Flip flag default + tag

## Acceptance criteria

- New-user signup → lands in onboarding thread automatically.
- Emersus asks one open question at a time.
- Free-text answers extract structured values that show up in Profile.
- `Skip setup` persists a `skipped_onboarding_at` timestamp; profile stays at defaults.
- `<onboarding-complete>` removes onboarding mode cleanly.
- Existing non-onboarding chat is unaffected.

## Open questions

- Should onboarding be re-runnable from Profile? → Yes, add "Restart onboarding" in Profile → Preferences. (Minor follow-up.)
- Fallback if `extract_profile` never completes → 24h timeout, auto-skip with warning email.
- Model used during onboarding — same as default chat (Emersus 0.5)? → Yes. Cheaper/faster tier optional.
