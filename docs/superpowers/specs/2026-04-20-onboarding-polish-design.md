# Onboarding Polish — Design

**Date:** 2026-04-20
**Scope:** UX-only polish of the new-user onboarding flow. No changes to the onboarding LLM prompt logic or the set of profile fields captured.
**Goal rank:** conversion > perceived quality > activation depth.

## Why

New-user onboarding today has structural gaps: new Google OAuth users may land on a blank chat with no onboarding trigger because the callback→onboarding redirect is unwired; the conversational flow has no progress signal so users don't know where they are or when they're done; there is no escape hatch for users who want to start asking questions immediately; and the empty-state chips that appear post-onboarding are generic, throwing away the goal/experience/equipment data we just spent four turns collecting. This spec closes all four gaps, plus polishes the surrounding visual moments to match the quality of the chat experience itself.

## Scope

### In scope (9 items)

| # | Item | Primary files | Summary |
|---|---|---|---|
| 1 | Fix OAuth→onboarding redirect | `auth/callback/index.html` | New users route to `/app/?onboarding=1` |
| 2 | Click-through welcome screen | new component in `shared/react-chat-app.js` or `app/welcome/` | Replaces AI's first-message greeting; "Start" CTA |
| 3 | Thin progress bar | `shared/react-chat-app.js` + new server field `onboarding_progress` | 2px gold bar, animates on each turn |
| 4 | Skip-setup link | `shared/react-chat-app.js` | Appears from `onboarding_progress >= 0.33`; flips `onboarding_completed: true` |
| 5 | Completion toast | new `shared/chat/completion-toast.js` | 3s auto-dismiss on false→true transition |
| 6 | Personalized empty-state prompts | `api/emersus/suggest-prompts.js`, `shared/chat/empty-prompts.js` | Personalize chips from profile goal/experience/equipment |
| 7 | Pro-tier awareness on completion | `shared/chat/completion-toast.js` | Non-blocking "10 msgs/day free" subtext in toast |
| 8 | Microcopy sweep | `shared/react-chat-app.js`, `auth/auth.js`, `api/emersus/pipeline/onboarding.js` | ~12 first-run strings |
| 9 | Real mobile polish | all new surfaces | Welcome/bar/skip/toast/chips all designed for 375×667 and 393×851 |

### Out of scope (flagged follow-ups)

- Email verification — compliance decision, separate project.
- Onboarding prompt tuning (add recovery/sleep/stress questions) — depth B, not this pass.
- Avatar upload — not required.
- Multi-device onboarding consistency (desktop→mobile handoff mid-flow) — relies on existing profile sync; no new UX.

## Visual decisions (locked)

- **Welcome:** click-through screen, not an auto-dismiss splash. Sets expectations ("4 quick questions — about 90 seconds"). Replaces the AI's greeting so the AI opens with Q1 directly.
- **Progress cue + skip:** 2px gold progress bar under the chat header + quiet "skip setup →" text link at right. No step counter. No "Step 2 of 4" quiz pattern. Bar and skip both fade to zero opacity on `onboarding_completed`.

## Data flow

### A. Source of truth for progress

Add one field: `profiles.onboarding_progress` (float 0.0–1.0), computed server-side from captured profile fields:

```
captured = count of non-null required fields in [goal, experience, equipment, training_days, dietary_pref]
progress = captured / 5.0
onboarding_completed = progress >= 1.0 OR user clicked skip
```

Computed inside the `UPDATE_USER_PROFILE` handler in `api/emersus/pipeline/onboarding.js` and returned in every chat response envelope. Client animates the bar from the response value.

Progress is computed from data-captured (not turn count) so the bar stays accurate if the LLM skips a question, batches two groups into one turn, or re-captures a field.

### B. OAuth redirect wiring

After Supabase session is established in `auth/callback/index.html`, fetch `/api/profile/me`. Route by:
- `onboarding_completed === false` AND `created_at` within last 60 seconds → `/app/?onboarding=1`
- Otherwise → `/app/`

The `?onboarding=1` query param is already read at `shared/react-chat-app.js:3418`, so no other client changes for this wiring.

### C. Welcome screen → chat transition

1. User lands at `/app/?onboarding=1`.
2. React app detects the flag, renders `<WelcomeScreen>` instead of chat.
3. User clicks "Start".
4. Client `POST /api/emersus/onboarding/start` (existing endpoint).
5. On 200, mount chat. AI opens with Q1 directly.
6. Server prompt receives `context: "welcomed"`; the onboarding system prompt at `api/emersus/pipeline/onboarding.js:29` gets a conditional line: *"The user has already been welcomed. Open with question 1 directly, without re-introducing yourself."*

### D. Skip semantics

Clicking skip:
1. `POST /api/profile/complete-onboarding` with `{ reason: "user_skipped" }`.
2. Server sets `onboarding_completed: true`, `onboarding_skipped_at: now()`.
3. Profile row keeps every captured field — nothing destroyed.
4. Response triggers the same completion-toast path as natural completion.

Client gates the skip link: only rendered when `onboarding_progress >= 0.33`. Server accepts any skip regardless of progress — no friction, no error UX if a stale client fires it.

Skip is distinct from completion in the DB (`onboarding_skipped_at`) so we can see the drop-off funnel in analytics without changing UX.

### E. Completion detection + personalized prompts

Client watches `onboarding_progress` in each chat-response envelope. On false→true transition:

1. Mount completion toast (3s, auto-dismiss).
2. Fire `GET /api/emersus/suggest-prompts?personalize=true`.
3. Server reads fresh profile, feeds goal + experience + equipment into an LLM tool call (strict:true) to generate 6 chips matched to the user.
4. Client replaces generic chips with personalized chips when response arrives.
5. Personalized endpoint failure or timeout (>4s) → silent fallback to generic chips. Never block entry to chat. Server-side log only.

### F. Analytics events (PostHog)

- `onboarding_welcome_shown`
- `onboarding_started` (click on "Start")
- `onboarding_turn_completed` (fires with progress value on each bump)
- `onboarding_skipped` (with progress % at time of skip)
- `onboarding_completed`

Events are fire-and-forget. Analytics can't break onboarding.

## Error handling + edge cases

### State reentry

- **Onboarded user hits `?onboarding=1`** → ignore query param; show chat.
- **Partially-onboarded user reopens chat** (no query flag, `onboarding_completed=false` from weeks-old abandoned session) → do not re-trigger onboarding. Treat as regular chat. Profile page is the escape hatch.
- **User reloads mid-onboarding** → welcome screen only shows when `onboarding_progress === 0`. Any progress > 0 skips straight to chat with the bar restored.

### Failure modes

- **OAuth callback can't fetch profile** → default to `/app/` without the flag. New users miss the welcome screen this one time; returning users must not get stuck.
- **Server returns null/undefined `onboarding_progress`** → hide the bar. A 0% bar looks broken.
- **Personalized prompts endpoint fails or times out >4s** → silent fallback to generic chips.
- **Completion toast race** (progress flaps back down due to reordered responses) → completion is a one-way latch per session (client-side `hasShownCompletionToast` ref).
- **PostHog event failures** → fire-and-forget, never awaited.

### Bar monotonicity

Profile fields can be overwritten mid-flow, which could make server-computed `onboarding_progress` briefly decrease. Client enforces monotonic increase — never animate backward during a single session. Resets only on page reload.

### Welcome + AI-greeting consistency

If the client shows the welcome screen but `POST /api/emersus/onboarding/start` fails, do not let the user proceed into a broken chat. Show inline retry on the welcome screen ("Something went wrong — try again"). This is the one hard block in the flow.

### Mobile-specific

- Welcome screen vertical overflow at 375×667 → scroll enabled; "Start" button stays in viewport via `sticky bottom`.
- Progress bar fill animation capped at 400ms for low-end Android.
- Completion toast sits above the composer, never over it.

## Testing

No frontend e2e harness exists; testing splits into server-side automated unit tests plus a structured manual smoke.

### Automated (server-side)

- `tests/onboarding/progress.test.js` — pure function test of `computeOnboardingProgress(profile)`: empty → 0.0; 3/5 captured → 0.6; all captured → 1.0; null and empty-string both count as unset.
- `tests/onboarding/skip.test.js` — skip endpoint marks `onboarding_completed` + `onboarding_skipped_at` without destroying captured fields; idempotent.
- `tests/api/suggest-prompts-personalize.test.js` — `?personalize=true` with a seeded profile returns 6 chips; fallback to generic on simulated LLM 500.

Read-only profile smoke against prod Supabase is OK. Any write tests seed a dedicated test user and tear down.

### Manual smoke — fresh-user flow (run on every PR touching these files)

1. New Google signup → callback → lands on welcome screen at `/app/?onboarding=1`.
2. Welcome screen renders < 300ms after callback (no spinner).
3. Click "Start" → AI opens with Q1, no "Hi, I'm Emersus" preamble.
4. Progress bar animates from 0% after each answer; never visible when > 100%.
5. Skip link appears only after ~33% captured.
6. Natural completion at 100% → toast shows, empty-state chips replaced with personalized ones within 4s (or generic fallback if slow).
7. Reload page after completion → no welcome screen, no bar, no toast.
8. `onboarding_*` PostHog events visible in the prod project.

### Manual smoke — abandoned-user flow

1. Seed a profile with `onboarding_completed=false`, 1 field captured.
2. Load `/app/` (no query flag) → no welcome, no bar, no re-trigger. Regular chat.

### Mobile QA — 375×667 and 393×851

- Welcome screen fits without horizontal scroll; "Start" stays in viewport.
- Progress bar + skip link don't collide with sidebar toggle.
- Skip link touch target ≥44px.
- Completion toast above composer, never obscures input.
- Empty-state chips wrap cleanly.

### Regression surfaces to verify unchanged

- Returning users on `/app/` (no flag): chat mounts instantly, no onboarding artifacts.
- `/app/profile/` still works for manual profile completion.
- Free-tier rate limits still fire at 10 msgs/day.
- `/pricing/` checkout flow untouched.

## Open items that should land in the implementation plan

- Migration for `profiles.onboarding_progress` (nullable float) and `profiles.onboarding_skipped_at` (nullable timestamptz).
- Wiring of the `context: "welcomed"` flag through `api/emersus/pipeline/onboarding.js` — exact parameter name and call site.
- Personalized-prompts LLM tool schema (strict:true, superset-data pattern per project convention).
- Where `<WelcomeScreen>` lives in the React tree — decision between a new `app/welcome/` static route and an inline component inside `shared/react-chat-app.js`.
