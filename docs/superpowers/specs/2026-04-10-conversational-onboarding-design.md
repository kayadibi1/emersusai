# Conversational Onboarding

Replace the manual profile form with an AI-driven onboarding conversation that runs the first time a user opens the chat.

## Context

Currently after signup users land on the dashboard and manually fill out a profile form at `/app/profile/`. The chat engine already fetches the profile server-side and feeds it to the LLM. This design replaces the form-fill step with a natural conversation in the chat UI.

## Decisions

| Decision | Choice |
|----------|--------|
| When does onboarding happen? | First time user opens the chat |
| What happens to the profile form? | Becomes read-only (view only, edit via chat) |
| Question pacing | Grouped 2-3 at a time |
| Transition to normal chat | Seamless — same thread continues |

## Profile Fields to Capture

All fields are extracted from the conversation and upserted incrementally.

| Field | Column | Type | New? |
|-------|--------|------|------|
| Primary use case | `primary_use_case` | text | Yes |
| Fitness goal | `goal` | text | No |
| Experience level | `experience_level` | text | No |
| Dietary preferences | `dietary_preferences` | text | No |
| Injuries/limitations | `injuries_limitations` | text | No |
| Equipment access | `equipment_access` | text | Yes (column) |
| Days per week | `available_days_per_week` | smallint | Yes (column) |
| Minutes per session | `available_minutes_per_session` | smallint | Yes (column) |
| Sleep/stress context | `sleep_stress_context` | text | Yes (column) |

## Architecture

### Detection & Routing (workflow.js)

The backend already calls `fetchSupabaseProfile()` on every chat request. When `onboarding_completed === false`:

- Skip the normal pipeline (no RAG, no evidence retrieval, no reranking)
- Use a dedicated onboarding system prompt instead
- Call OpenAI directly with the onboarding prompt + conversation history
- Stream the response the same way as normal chat
- After each response, parse any `~~~profile-update` fences and upsert to the DB

When `onboarding_completed === true`, the normal pipeline runs as before. No changes to the existing chat flow.

### Onboarding System Prompt

The prompt instructs the model to:

1. **Open warmly.** Greet the user, ask what they want to use Emersus for and what their primary fitness goal is. Offer examples so new users aren't staring at a blank: "I can help with workout programming, nutrition, mental performance and focus, recovery and sleep optimization, injury management, or understanding the science behind training."
2. **Ask about experience and limitations.** Group: experience level + injuries/limitations.
3. **Ask about logistics.** Group: equipment access + training days/week + minutes/session.
4. **Ask about diet and lifestyle.** Group: dietary preferences + sleep/stress context.
5. **Wrap up.** Emit a final `profile-update` fence with `onboarding_completed: true`. Summarize what it learned briefly. Invite the user to ask their first question.

Behavioral rules:
- Group 2-3 questions per message. Adapt if something needs a follow-up (e.g., user mentions a serious injury).
- Be conversational, not robotic. Don't repeat back every answer verbatim.
- Don't make Emersus sound like it only does workouts and nutrition — it covers the full breadth of exercise science including mental performance.
- If the user doesn't know how they want to use Emersus, help them by offering concrete examples.

### Profile-Update Fence

New fence type parsed by the backend, stripped from rendered output by the frontend:

```
~~~profile-update
{"goal": "hypertrophy", "experience_level": "intermediate"}
~~~
```

- Emitted by the model after each exchange with whatever fields it extracted
- Backend parses it and upserts the corresponding `profiles` row
- Fields accumulate across exchanges (incremental upsert, not replace)
- The final fence includes `"onboarding_completed": true`

### DB Migration

New migration adds columns to `profiles`:

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_use_case text,
  ADD COLUMN IF NOT EXISTS equipment_access text,
  ADD COLUMN IF NOT EXISTS available_days_per_week smallint,
  ADD COLUMN IF NOT EXISTS available_minutes_per_session smallint,
  ADD COLUMN IF NOT EXISTS sleep_stress_context text;
```

No new tables. Existing RLS policies already cover these columns (they apply to the whole row).

### Frontend Changes (react-chat-app.js)

- On chat load, fetch profile. If `onboarding_completed === false`:
  - Send an initial trigger `{ question: "__onboarding_start__" }` to kick off the conversation
  - Set input placeholder to "Tell me about yourself..."
- `profile-update` fences are stripped from rendered output (add to existing fence-stripping in `emersus-renderer.js`)
- When the backend response includes `onboarding_completed: true` in a profile-update fence, update local state — placeholder reverts to normal. No page reload.

### Profile Page Changes (app/profile/)

- All form inputs become disabled/read-only
- Display all profile fields including the new ones
- Add a note: "To update your profile, just mention it in the chat."
- Add the new fields to the display (primary use case, equipment, schedule, sleep/stress)

### fetchSupabaseProfile Update (workflow.js)

Add the new columns to the SELECT query so they're available in the normal chat system prompt:

```
goal, experience_level, dietary_preferences, injuries_limitations, full_name, email,
primary_use_case, equipment_access, available_days_per_week, available_minutes_per_session, sleep_stress_context
```

## What Stays The Same

- Normal chat flow — untouched, onboarding path only fires when `onboarding_completed === false`
- Streaming, auth, thread management — unchanged
- The LLM system prompt for normal chat still receives the profile the same way
- Signup flow — unchanged, auto-creates the profile row with `onboarding_completed = false`

## Files to Modify

| File | Change |
|------|--------|
| `api/emersus/workflow.js` | Onboarding detection, system prompt, profile-update fence parsing, fetchSupabaseProfile SELECT |
| `shared/react-chat-app.js` | Onboarding trigger on first chat load, placeholder swap |
| `shared/emersus-renderer.js` | Strip `profile-update` fences from rendered output |
| `app/profile/index.html` | Read-only fields, add new fields, add note |
| `shared/app-pages.js` | Disable form submission, display new fields |
| `shared/supabase.js` | Update upsertProfile to handle new fields |
| `supabase/` (new migration) | ALTER TABLE for new columns |
