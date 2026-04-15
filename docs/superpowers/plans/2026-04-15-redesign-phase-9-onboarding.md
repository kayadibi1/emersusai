# Frontend Redesign · Phase 9 · Conversational Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans`.

**Goal:** First-run users land in `/app` with an auto-created onboarding thread. Emersus asks open-ended questions, extracts structured fields via a new `extract_profile` tool call, writes them to Profile, and ends when all required fields are captured. **No quiz form.**

**Scope rule:** Backend tool addition + system prompt switch + first-thread auto-creation. The chat UI (Phase 2) doesn't change visually; it just receives the seeded thread.

**Spec:** § "9. Onboarding" + "Behaviors · 8. Onboarding" + the existing 2026-04-10 onboarding design doc.
**Prerequisite:** Phases 2 + 6 shipped (Profile endpoints exist).

**Branch strategy:** `conversational_onboarding` flag. Default off until tested with real users.

---

## File structure

- **New:** `api/emersus/onboarding.js` — first-thread bootstrap + `extract_profile` tool definition
- **New:** `api/emersus/pipeline/onboarding-prompt.js` — system prompt override for onboarding mode
- **New:** `tests/unit/api/emersus/extract-profile.test.js`
- **Modify:** `api/emersus/workflow.js` — register `extract_profile` tool when onboarding flag set on the session
- **Modify:** `api/emersus/pipeline/tools.js` — add `extract_profile` validator
- **Modify:** `shared/react-chat-app.js` — detect `?onboarding=1` query → check for existing onboarding thread; if none, create one server-side and load it
- **Modify:** `auth/callback/*.js` (Phase 7's invite acceptance) — redirect first-time users to `/app/?onboarding=1`

---

## Task 1: Onboarding-mode system prompt

**Files:**
- Create: `api/emersus/pipeline/onboarding-prompt.js`

- [ ] **Step 1:** Export `ONBOARDING_SYSTEM_PROMPT` constant. Content per spec:
  ```
  [ONBOARDING MODE]
  Goal: gather user's training focus, experience level, body weight, height,
  training environment, available equipment, injuries, and weekly target.
  Rules: ask one open question at a time; acknowledge answers; extract
  structured values; write them to the profile via the extract_profile tool;
  end when all required fields are captured. Never show a form.
  ```
- [ ] **Step 2:** Export `requiredOnboardingFields()` returning the canonical list.
- [ ] **Step 3:** Export `onboardingComplete(extracted)` — pure check that all required fields present.
- [ ] **Step 4: Commit** `feat(onboarding): system prompt + completeness checker`

---

## Task 2: `extract_profile` tool definition + validator

**Files:**
- Modify: `api/emersus/pipeline/tools.js`

- [ ] **Step 1:** Add tool spec:
  ```js
  {
    type: "function",
    function: {
      name: "extract_profile",
      description: "Write one or more extracted profile fields. Call whenever you've inferred a field from user input.",
      parameters: {
        type: "object",
        properties: {
          goal: { enum: ["hypertrophy","strength","endurance","general","hybrid"] },
          experience: { enum: ["beginner","intermediate","advanced"] },
          body_weight_kg: { type: "number", minimum: 30, maximum: 300 },
          height_cm: { type: "number", minimum: 100, maximum: 250 },
          training_env: { enum: ["home","commercial","outdoor","mixed"] },
          equipment: { type: "array", items: { type: "string" } },
          injuries: { type: "array", items: { type: "object" } },
          weekly_sessions_target: { type: "integer", minimum: 1, maximum: 14 }
        },
        required: []
      }
    }
  }
  ```
- [ ] **Step 2:** Validator + tests for accepted/rejected payloads.
- [ ] **Step 3: Commit** `feat(onboarding): extract_profile tool definition`

---

## Task 3: Workflow integration — call extract_profile + write to Profile

**Files:**
- Modify: `api/emersus/workflow.js`
- Modify: `api/emersus/pipeline/stream.js` (handle the new tool's payload)

- [ ] **Step 1:** When the request includes `onboarding: true` in body (or session has `onboarding_thread_id` matching), workflow uses `ONBOARDING_SYSTEM_PROMPT` instead of the standard one + registers the `extract_profile` tool.
- [ ] **Step 2:** When the model emits an `extract_profile` tool call, workflow writes the fields to `/api/profile` server-side (uses `supabaseAdmin` direct since we're already in a server handler — no roundtrip).
- [ ] **Step 3:** When `onboardingComplete(extracted)` returns true, append `<onboarding-complete>` token to the SSE stream so the client can detect end.
- [ ] **Step 4: Commit** `feat(onboarding): workflow integration + auto-profile-write`

---

## Task 4: First-thread bootstrap endpoint

**Files:**
- Create: `api/emersus/onboarding.js`

- [ ] **Step 1:** `POST /api/emersus/onboarding/start` — `requireAuth`. Checks if user has any onboarding thread (`chat_threads.thread_state.onboarding === true`). If not, creates one with the first assistant message: `"Welcome to Emersus. Before we start, tell me a bit about what you're training for..."`. Returns `{ thread_id }`.
- [ ] **Step 2:** Mount in `server.js`.
- [ ] **Step 3: Commit** `feat(onboarding): /api/emersus/onboarding/start`

---

## Task 5: Client detection + thread bootstrap

**Files:**
- Modify: `shared/react-chat-app.js`

- [ ] **Step 1:** On mount, if URL has `?onboarding=1` or if profile is empty (`!profile.goal && !profile.experience`), call `POST /api/emersus/onboarding/start`, load the returned thread as active.
- [ ] **Step 2:** Onboarding thread shows a header strip `Onboarding · 2 of 8 fields captured` (count from server progress events). Skip setup → button removes the strip + leaves the thread as a regular thread.
- [ ] **Step 3:** When the assistant emits the `<onboarding-complete>` token, hide the strip + show a small toast `Setup complete — your profile is ready.`
- [ ] **Step 4: Commit** `feat(onboarding): client bootstrap + completion UX`

---

## Task 6: Auth → onboarding handoff

**Files:**
- Modify: `auth/callback/index.html` + the callback flow from Phase 7
- Modify: `shared/auth/invite-panel.js` (Phase 7)

- [ ] **Step 1:** First-time OAuth users (no profile rows) → redirect to `/app/?onboarding=1`.
- [ ] **Step 2:** Invite-acceptance flow (Phase 7) → already redirects to `/app/?onboarding=1` per Phase 7 Task 6.
- [ ] **Step 3: Commit** `feat(onboarding): auth handoff`

---

## Task 7: Flag flip + tag

- [ ] **Step 1:** `DEFAULT_FLAGS.conversational_onboarding = true`. Update flag tests.
- [ ] **Step 2:** Manual QA: create a fresh user → end up in onboarding thread → answer 8 questions → profile gets populated → onboarding strip disappears.
- [ ] **Step 3:** Tag `redesign-phase-9-onboarding`.
- [ ] **Step 4: Commit** `feat(onboarding): default to true`

---

## Acceptance criteria

1. Fresh user → `/app/?onboarding=1` opens an onboarding thread with the welcome message.
2. Each user answer triggers an `extract_profile` tool call when fields are inferable.
3. Profile fields appear in `/app/profile` immediately after extraction.
4. Onboarding strip shows live progress (N of 8 fields captured).
5. `<onboarding-complete>` event hides the strip + dispatches a profile-refresh event.
6. `Skip setup →` keeps the thread but removes the strip + leaves profile in default state.
7. Invite-acceptance + first OAuth login both route through `?onboarding=1`.
8. `conversational_onboarding=0` skips the flow entirely.

---

## Final-phase deploy checklist

After Phase 9 ships:
- Run `node --experimental-test-module-mocks --test "tests/unit/**/*.js"` — must be 0 failures.
- Apply all pending migrations on prod Hetzner per `project_supabase_admin_role.md` runbook.
- Push `main` + all 7 phase tags (`redesign-phase-3-train` through `redesign-phase-9-onboarding`).
- Pull + `npm run build` + `pm2 restart emersus-api --update-env` on the box.
- Smoke test every redesigned surface in both palettes.
- Update `changelog.md` + `checkpoint.md` + memory note.

The frontend redesign is **complete** when this checklist passes. Investigate the silent deploy webhook as a separate task — it didn't fire on either Phase 1 or Phase 2 push.
