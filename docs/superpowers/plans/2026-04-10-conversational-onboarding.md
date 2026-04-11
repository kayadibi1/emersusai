# Conversational Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual profile form with an AI-driven onboarding conversation on first chat open.

**Architecture:** When `onboarding_completed === false`, the chat backend skips the normal RAG pipeline and runs a conversational onboarding flow — a dedicated system prompt instructs the model to ask grouped questions, extract profile fields into `~~~profile-update` fences, and upsert them incrementally. The frontend detects onboarding state, auto-triggers the first message, and strips the fences from display. The profile page becomes read-only.

**Tech Stack:** Express + OpenAI Responses API + Supabase Postgres (self-hosted) + React 18 via esm.sh (no build step)

---

### Task 1: DB Migration — Add Extended Profile Columns

**Files:**
- Create: `supabase/20260410_profile_extended_columns.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 20260410_profile_extended_columns.sql
-- Add columns for conversational onboarding fields that the profile form
-- never captured. Existing RLS policies cover the full row, so no new
-- policies are needed.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_use_case text,
  ADD COLUMN IF NOT EXISTS equipment_access text,
  ADD COLUMN IF NOT EXISTS available_days_per_week smallint,
  ADD COLUMN IF NOT EXISTS available_minutes_per_session smallint,
  ADD COLUMN IF NOT EXISTS sleep_stress_context text;

-- Also add the new columns to the fetchSupabaseProfile SELECT grant.
-- The service role already has full access, so no GRANT changes are needed.
```

- [ ] **Step 2: Apply migration to production Supabase**

Run via SSH (use `supabase_admin` per project memory):

```bash
ssh hetzner "docker compose -f ~/supabase-docker/docker-compose.yml exec -T db psql -U supabase_admin -d postgres" < supabase/20260410_profile_extended_columns.sql
```

Expected: columns added silently (IF NOT EXISTS prevents errors if re-run).

- [ ] **Step 3: Verify columns exist**

```bash
ssh hetzner "docker compose -f ~/supabase-docker/docker-compose.yml exec -T db psql -U supabase_admin -d postgres -c \"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'profiles' AND column_name IN ('primary_use_case', 'equipment_access', 'available_days_per_week', 'available_minutes_per_session', 'sleep_stress_context');\""
```

Expected: 5 rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/20260410_profile_extended_columns.sql
git commit -m "feat: add extended profile columns for conversational onboarding"
```

---

### Task 2: Backend — Update Profile Fetch and Merge

**Files:**
- Modify: `api/emersus/workflow.js:1240-1266` (fetchSupabaseProfile)
- Modify: `api/emersus/workflow.js:1369-1394` (mergeProfile)

- [ ] **Step 1: Update fetchSupabaseProfile SELECT to include new columns + onboarding_completed**

In `api/emersus/workflow.js`, find the `fetchSupabaseProfile` function (line 1240). Change the SELECT to include the new columns and `onboarding_completed`:

```javascript
// BEFORE (line 1246):
`${supabaseUrl}/rest/v1/profiles?select=goal,experience_level,dietary_preferences,injuries_limitations,full_name,email&id=eq.${encodeURIComponent(

// AFTER:
`${supabaseUrl}/rest/v1/profiles?select=goal,experience_level,dietary_preferences,injuries_limitations,full_name,email,onboarding_completed,primary_use_case,equipment_access,available_days_per_week,available_minutes_per_session,sleep_stress_context&id=eq.${encodeURIComponent(
```

- [ ] **Step 2: Update mergeProfile to include new fields**

In `api/emersus/workflow.js`, find the `mergeProfile` function (line 1369). Add the new fields:

```javascript
function mergeProfile(profile, storedProfile) {
  return {
    goal: sanitizeProfileField(profile?.goal || storedProfile?.goal, 300),
    experience_level: sanitizeProfileField(
      profile?.experience_level || storedProfile?.experience_level,
      120
    ),
    dietary_preferences: sanitizeProfileField(
      profile?.dietary_preferences || storedProfile?.dietary_preferences,
      300
    ),
    injuries_limitations: sanitizeProfileField(
      profile?.injuries_limitations || storedProfile?.injuries_limitations,
      300
    ),
    equipment_access: sanitizeProfileField(
      profile?.equipment_access || storedProfile?.equipment_access,
      200
    ),
    available_days_per_week: sanitizeProfileField(
      profile?.available_days_per_week ?? storedProfile?.available_days_per_week,
      80
    ),
    available_minutes_per_session: sanitizeProfileField(
      profile?.available_minutes_per_session ?? storedProfile?.available_minutes_per_session,
      80
    ),
    sleep_stress_context: sanitizeProfileField(
      profile?.sleep_stress_context || storedProfile?.sleep_stress_context,
      200
    ),
    primary_use_case: sanitizeProfileField(
      profile?.primary_use_case || storedProfile?.primary_use_case,
      300
    ),
    medical_disclaimer_acknowledged:
      profile?.medical_disclaimer_acknowledged === true,
  };
}
```

- [ ] **Step 3: Verify server starts**

```bash
node server.js
```

Expected: starts without errors on port 3001. Ctrl-C to stop.

- [ ] **Step 4: Commit**

```bash
git add api/emersus/workflow.js
git commit -m "feat: include extended profile columns in fetch and merge"
```

---

### Task 3: Backend — Onboarding Handler

This is the core task. Add a `handleOnboarding()` function to `workflow.js` that:
1. Builds an onboarding system prompt
2. Calls the OpenAI Responses API
3. Extracts `~~~profile-update` fences from the response
4. Upserts profile fields via Supabase REST
5. Returns a response in the same shape as `generateRecommendation`

**Files:**
- Modify: `api/emersus/workflow.js` — add new functions before `generateRecommendation` (~line 3490)

- [ ] **Step 1: Add the onboarding system prompt constant**

Insert before `generateRecommendation` (around line 3490):

```javascript
// ---------------------------------------------------------------------------
// Conversational onboarding — replaces the RAG pipeline for new users
// ---------------------------------------------------------------------------

const ONBOARDING_SYSTEM_PROMPT = [
  "You are Emersus AI, an evidence-based exercise science assistant. A brand new user just opened the chat for the first time. Your job is to welcome them warmly and learn about them through a short, natural conversation so you can personalize future guidance.",
  "",
  "CONVERSATION FLOW (group 2-3 questions per message):",
  "1. Greet warmly. Ask what they want to use Emersus for and what their primary fitness goal is. Suggest examples: workout programming, nutrition planning, mental performance and focus, recovery and sleep optimization, injury management, or understanding the science behind training. If they're unsure, help them explore what Emersus can do.",
  "2. Ask about their experience level (beginner / intermediate / advanced) and any injuries or physical limitations.",
  "3. Ask about equipment access, how many days per week they can train, and how long each session can be.",
  "4. Ask about dietary preferences or restrictions, and any relevant sleep or stress context.",
  "5. After all questions are answered, emit a final profile-update fence with onboarding_completed set to true. Summarize what you learned in 2-3 sentences. Then invite them to ask their first question — e.g., 'You're all set! What would you like to start with?'",
  "",
  "BEHAVIORAL RULES:",
  "- Group 2-3 questions per message. Keep it conversational, not robotic.",
  "- If the user mentions something that needs a follow-up (e.g., a serious injury, an unusual goal), ask about it before moving on.",
  "- Don't repeat back every answer verbatim. Acknowledge briefly and move forward.",
  "- Emersus covers the full breadth of exercise science — workouts, nutrition, mental performance, recovery, sleep, injury rehab, and the underlying science. Don't make it sound like a gym-only tool.",
  "- Be warm but efficient. The whole onboarding should take 4-5 exchanges.",
  "",
  "PROFILE-UPDATE FENCES:",
  "After each user response, emit a ~~~profile-update fence containing a JSON object with the fields you extracted. Only include fields you have confident values for. Valid fields:",
  "- primary_use_case (string): what they want to use Emersus for",
  "- goal (string): their primary fitness/health goal",
  "- experience_level (string): 'beginner', 'intermediate', or 'advanced'",
  "- injuries_limitations (string): any injuries or physical limitations",
  "- equipment_access (string): what equipment they have access to",
  "- available_days_per_week (number): training days per week",
  "- available_minutes_per_session (number): minutes per session",
  "- dietary_preferences (string): diet preferences or restrictions",
  "- sleep_stress_context (string): sleep quality, stress levels, relevant lifestyle context",
  "",
  "Fence format (MUST use ~~~ tildes, not backticks):",
  "~~~profile-update",
  "{\"goal\": \"hypertrophy\", \"experience_level\": \"intermediate\"}",
  "~~~",
  "",
  "On the FINAL exchange (after all info is gathered), include \"onboarding_completed\": true in the fence.",
  "",
  "IMPORTANT: Place the fence at the END of your message, after all visible text. The fence is stripped before display — the user never sees it.",
].join("\n");
```

- [ ] **Step 2: Add profile-update fence extractor**

Insert right after the system prompt constant:

```javascript
/**
 * Extract all ~~~profile-update fences from model output.
 * Returns { cleanText, profileFields } where cleanText has fences stripped
 * and profileFields is the merged object of all extracted fields.
 */
function extractProfileUpdateFences(text) {
  const src = String(text || "");
  const re = /~~~profile-update\s*\r?\n([\s\S]*?)~~~/g;
  const profileFields = {};
  let match;

  while ((match = re.exec(src)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && typeof parsed === "object") {
        Object.assign(profileFields, parsed);
      }
    } catch (_err) {
      // Malformed JSON in fence — skip silently.
    }
  }

  const cleanText = src.replace(/~~~profile-update\s*\r?\n[\s\S]*?~~~/g, "").trim();
  return { cleanText, profileFields };
}
```

- [ ] **Step 3: Add profile upsert helper**

Insert right after the fence extractor:

```javascript
/**
 * Upsert profile fields via Supabase REST API.
 * Only sends non-empty fields to avoid overwriting existing data with nulls.
 */
async function upsertOnboardingProfile(supabaseUrl, serviceRoleKey, supabaseUserId, fields) {
  if (!supabaseUrl || !serviceRoleKey || !supabaseUserId) return;
  if (!fields || typeof fields !== "object" || Object.keys(fields).length === 0) return;

  // Whitelist valid profile columns to prevent injection of arbitrary fields.
  const validColumns = new Set([
    "goal", "experience_level", "dietary_preferences", "injuries_limitations",
    "equipment_access", "available_days_per_week", "available_minutes_per_session",
    "sleep_stress_context", "primary_use_case", "onboarding_completed",
  ]);

  const safeFields = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    if (validColumns.has(key) && value !== undefined && value !== null && value !== "") {
      safeFields[key] = value;
    }
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(supabaseUserId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(safeFields),
    }
  );

  if (!response.ok) {
    console.error("Onboarding profile upsert failed:", await response.text().catch(() => ""));
  }
}
```

- [ ] **Step 4: Add the handleOnboarding function**

Insert right after the upsert helper:

```javascript
/**
 * Handle the onboarding conversation flow for new users.
 * Replaces the full RAG pipeline — no evidence retrieval, no guardrails,
 * just a conversational exchange with the onboarding system prompt.
 */
async function handleOnboarding({
  question,
  userId,
  recentMessages,
  supabaseUrl,
  serviceRoleKey,
  supabaseUserId,
  stableUserId,
  includeDebug,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  // Build the messages array for OpenAI.
  const input = [
    { role: "system", content: ONBOARDING_SYSTEM_PROMPT },
  ];

  // Add conversation history from previous onboarding exchanges.
  if (Array.isArray(recentMessages)) {
    for (const msg of recentMessages) {
      if (msg.role && msg.text) {
        input.push({ role: msg.role, content: msg.text });
      }
    }
  }

  // Add the current user message. For the initial trigger, synthesize a greeting.
  const userMessage = question === "__onboarding_start__"
    ? "Hi, I just created my account!"
    : String(question || "");
  if (userMessage) {
    input.push({ role: "user", content: userMessage });
  }

  // Call OpenAI Responses API (same pattern as callOpenAISynthesis).
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_output_tokens: 1000,
      input,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    throw new Error(
      payload?.error?.message || "Onboarding request to OpenAI failed."
    );
  }

  // Extract text from the response (same helper used by synthesis).
  const rawText = extractTextFromResponse(payload);

  // Extract and process profile-update fences.
  const { cleanText, profileFields } = extractProfileUpdateFences(rawText);

  // Upsert any extracted profile fields (fire-and-forget, don't block response).
  if (Object.keys(profileFields).length > 0) {
    upsertOnboardingProfile(supabaseUrl, serviceRoleKey, supabaseUserId, profileFields)
      .catch((err) => console.error("Onboarding profile upsert error:", err));
  }

  // Return in the same shape as generateRecommendation so the frontend
  // renders it identically — just answer_text, no cards/sources/evidence.
  return {
    user: {
      id: stableUserId || null,
      profile_used: {},
    },
    plan: { topic: "onboarding", riskLevel: "none" },
    summary: cleanText,
    answer_text: cleanText,
    recommendations: [],
    confidence: 1,
    limitations: [],
    sources: [],
    cards: [],
    quant_findings: [],
    token_usage: null,
    guardrail: {
      status: "allowed",
      response_mode: "full",
      reasons: [],
    },
    onboarding_completed: Boolean(profileFields.onboarding_completed),
    debug: includeDebug
      ? {
          synthesis_mode: "onboarding",
          openai_input: input,
          raw_output_text: rawText,
        }
      : undefined,
  };
}
```

- [ ] **Step 5: Verify server starts**

```bash
node server.js
```

Expected: starts without errors on port 3001.

- [ ] **Step 6: Commit**

```bash
git add api/emersus/workflow.js
git commit -m "feat: add onboarding handler with profile-update fence extraction"
```

---

### Task 4: Backend — Wire Onboarding Into generateRecommendation

**Files:**
- Modify: `api/emersus/workflow.js:3573-3580` (inside generateRecommendation, after profile fetch)

- [ ] **Step 1: Add onboarding detection after the profile fetch**

In `generateRecommendation`, find the profile fetch block (lines 3573-3580). Insert the onboarding check right after `storedProfile` is fetched, BEFORE the `mergeProfile` call:

```javascript
  const profileStartedAt = Date.now();
  const storedProfile = await fetchSupabaseProfile(
    supabaseUrl,
    serviceRoleKey,
    supabaseUserId
  );

  // --- Onboarding intercept ---
  // New users have onboarding_completed === false (set by the DB trigger).
  // Route them through the conversational onboarding flow instead of
  // the full RAG pipeline.
  if (storedProfile && storedProfile.onboarding_completed === false) {
    return await handleOnboarding({
      question,
      userId,
      recentMessages,
      supabaseUrl,
      serviceRoleKey,
      supabaseUserId,
      stableUserId,
      includeDebug,
    });
  }
  // --- End onboarding intercept ---

  const mergedProfile = mergeProfile(profile, storedProfile || {});
```

- [ ] **Step 2: Verify server starts**

```bash
node server.js
```

Expected: starts without errors.

- [ ] **Step 3: Commit**

```bash
git add api/emersus/workflow.js
git commit -m "feat: route new users to onboarding handler in generateRecommendation"
```

---

### Task 5: Frontend — Onboarding Detection and Auto-Trigger

**Files:**
- Modify: `shared/react-chat-app.js:26` (imports)
- Modify: `shared/react-chat-app.js:1795-1884` (ChatApp component — state + boot)
- Modify: `shared/react-chat-app.js:2023-2050` (message sending)
- Modify: `shared/react-chat-app.js:2245` (input placeholder)

- [ ] **Step 1: Add getProfile import**

In `shared/react-chat-app.js`, line 26, add `getProfile` to the imports from `/shared/supabase.js`:

```javascript
// BEFORE:
import {
  applyWorkoutPlanUpdate,
  getSession,
  listChatThreads,
  requireAuth,
  saveNewWorkoutPlan,
  setStatus,
  upsertChatThread,
} from "/shared/supabase.js";

// AFTER:
import {
  applyWorkoutPlanUpdate,
  getProfile,
  getSession,
  listChatThreads,
  requireAuth,
  saveNewWorkoutPlan,
  setStatus,
  upsertChatThread,
} from "/shared/supabase.js";
```

- [ ] **Step 2: Add onboarding state**

In the `ChatApp` component state declarations (around line 1809), add a new state variable after `streamingMessageKey`:

```javascript
  const [streamingMessageKey, setStreamingMessageKey] = useState("");
  const [onboardingActive, setOnboardingActive] = useState(false);
```

- [ ] **Step 3: Add onboarding check to boot sequence**

In the `boot()` function inside the first `useEffect` (around line 1862), add a profile check after session is obtained. Insert right after `setSession(authSession)` (line 1865):

```javascript
      setSession(authSession);

      // Check if user needs onboarding.
      const userProfile = await getProfile(authSession.user.id);
      if (cancelled) return;
      const needsOnboarding = !userProfile || userProfile.onboarding_completed === false;
      setOnboardingActive(needsOnboarding);
```

- [ ] **Step 4: Add auto-trigger for onboarding after thread setup**

Still in `boot()`, after the thread setup block (after the `else` that creates `firstThread`, around line 1877), add the onboarding auto-trigger. Find the closing of the thread setup if/else and add:

```javascript
      // Auto-trigger onboarding for new users on their first empty thread.
      if (needsOnboarding) {
        // Use setTimeout to let state settle before submitting.
        setTimeout(() => {
          const submit = submitQuestionRef.current;
          if (typeof submit === "function") {
            submit(null, "__onboarding_start__");
          }
        }, 300);
      }
```

- [ ] **Step 5: Handle onboarding_completed in response**

In the message handling code (around line 2064, where `data` is processed after the fetch), add a check for `onboarding_completed` in the response. Insert after the `onDebugData` callback block (after line 2061):

```javascript
      // If the backend signals onboarding is complete, update local state
      // so the placeholder reverts and future messages go through normal flow.
      if (data.onboarding_completed) {
        setOnboardingActive(false);
      }
```

- [ ] **Step 6: Update input placeholder to be onboarding-aware**

Find the input placeholder (line 2245):

```javascript
// BEFORE:
placeholder: "Ask me anything about training, nutrition, recovery, or performance.",

// AFTER:
placeholder: onboardingActive
  ? "Tell me about yourself..."
  : "Ask me anything about training, nutrition, recovery, or performance.",
```

- [ ] **Step 7: Strip profile-update fences from displayed text**

The backend already strips fences from `answer_text` before returning it. But as defense-in-depth, add a strip in the frontend. Find where `assistantRaw` is computed (line 2064):

```javascript
// BEFORE:
const assistantRaw = String(data.answer_text || data.summary || "");

// AFTER:
const assistantRaw = String(data.answer_text || data.summary || "")
  .replace(/~~~profile-update\s*\r?\n[\s\S]*?~~~/g, "")
  .trim();
```

- [ ] **Step 8: Verify the app loads**

Open `http://127.0.0.1:3001/chat/` in a browser. The page should load without console errors.

- [ ] **Step 9: Commit**

```bash
git add shared/react-chat-app.js
git commit -m "feat: add onboarding detection, auto-trigger, and placeholder swap"
```

---

### Task 6: Profile Page — Read-Only With New Fields

**Files:**
- Modify: `app/profile/index.html`
- Modify: `shared/app-pages.js:67-124` (bindProfileForm)

- [ ] **Step 1: Update profile HTML with new fields and read-only messaging**

Replace the full content of `app/profile/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Profile | Emersus AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/shared/site.css">
</head>
<body>
  <div class="site-shell">
    <header class="site-header">
      <div class="container site-header-inner">
        <a class="brand-mark" href="/">Emersus AI</a>
        <nav class="site-nav">
          <a href="/app/">Dashboard</a>
          <a href="/app/profile/">Profile</a>
          <a href="/chat/">Chat</a>
          <a href="/privacy/">Privacy</a>
          <a href="/contact/">Contact</a>
          <button class="button button-ghost" type="button" data-auth-logout>Log Out</button>
        </nav>
      </div>
    </header>

    <main class="page-main">
      <div class="container stack">
        <section class="hero-panel stack">
          <p class="section-kicker">Profile</p>
          <h1>Your profile</h1>
          <p class="lede">
            This is what Emersus knows about you. To update anything, just mention it in the <a href="/chat/">chat</a>.
          </p>
          <div class="chip">Signed in as <span data-user-email>Loading...</span></div>
        </section>

        <section class="form-panel stack">
          <form class="form-grid" data-profile-form>
            <input type="hidden" name="email">
            <div class="form-grid two-up">
              <label class="field">
                <span class="field-label">Full Name</span>
                <input type="text" name="full_name" disabled>
              </label>
              <label class="field">
                <span class="field-label">Experience Level</span>
                <input type="text" name="experience_level" disabled>
              </label>
            </div>
            <label class="field">
              <span class="field-label">Primary Use Case</span>
              <input type="text" name="primary_use_case" disabled>
            </label>
            <label class="field">
              <span class="field-label">Primary Goal</span>
              <input type="text" name="goal" disabled>
            </label>
            <div class="form-grid two-up">
              <label class="field">
                <span class="field-label">Equipment Access</span>
                <input type="text" name="equipment_access" disabled>
              </label>
              <label class="field">
                <span class="field-label">Training Schedule</span>
                <input type="text" name="training_schedule" disabled>
              </label>
            </div>
            <label class="field">
              <span class="field-label">Dietary Preferences</span>
              <textarea name="dietary_preferences" disabled></textarea>
            </label>
            <label class="field">
              <span class="field-label">Injuries / Limitations</span>
              <textarea name="injuries_limitations" disabled></textarea>
            </label>
            <label class="field">
              <span class="field-label">Sleep / Stress Context</span>
              <textarea name="sleep_stress_context" disabled></textarea>
            </label>
            <div class="button-row">
              <a class="button button-primary" href="/chat/">Update via Chat</a>
              <a class="button button-secondary" href="/app/">Back to Dashboard</a>
            </div>
            <p class="status-text" data-profile-status></p>
          </form>
        </section>
      </div>
    </main>
  </div>

  <script type="module" src="/shared/app-pages.js"></script>
</body>
</html>
```

- [ ] **Step 2: Update bindProfileForm to display read-only data**

In `shared/app-pages.js`, replace the `bindProfileForm` function (lines 67-124) with a read-only version:

```javascript
async function bindProfileForm() {
  const form = document.querySelector("[data-profile-form]");
  if (!form) return;

  const hydrated = await hydrateUserSummary();
  if (!hydrated) return;

  const { session, profile } = hydrated;

  if (profile) {
    for (const [key, value] of Object.entries(profile)) {
      const field = form.elements.namedItem(key);
      if (field && typeof value === "string") {
        field.value = value;
      }
    }

    // Compose training schedule from days + minutes for display.
    const days = profile.available_days_per_week;
    const mins = profile.available_minutes_per_session;
    const scheduleField = form.elements.namedItem("training_schedule");
    if (scheduleField && (days || mins)) {
      const parts = [];
      if (days) parts.push(`${days} days/week`);
      if (mins) parts.push(`${mins} min/session`);
      scheduleField.value = parts.join(", ");
    }
  }

  if (!form.elements.namedItem("email").value) {
    form.elements.namedItem("email").value = session.user.email || "";
  }

  // No submit handler — the form is read-only. The submit button has been
  // replaced with a link to chat.
}
```

- [ ] **Step 3: Verify the profile page loads**

Open `http://127.0.0.1:3001/app/profile/` in a browser. Fields should be disabled and display stored values.

- [ ] **Step 4: Commit**

```bash
git add app/profile/index.html shared/app-pages.js
git commit -m "feat: make profile page read-only with new extended fields"
```

---

### Task 7: End-to-End Verification

- [ ] **Step 1: Start the server**

```bash
node server.js
```

- [ ] **Step 2: Create a test user (or reset an existing one)**

If you have a test user whose `onboarding_completed` is already true, reset it:

```bash
ssh hetzner "docker compose -f ~/supabase-docker/docker-compose.yml exec -T db psql -U supabase_admin -d postgres -c \"UPDATE profiles SET onboarding_completed = false, primary_use_case = null, equipment_access = null, available_days_per_week = null, available_minutes_per_session = null, sleep_stress_context = null WHERE email = '<test-user-email>';\""
```

- [ ] **Step 3: Open chat and verify onboarding triggers**

1. Open `http://127.0.0.1:3001/chat/` logged in as the test user
2. Expected: the AI should automatically greet the user and ask the first set of questions
3. Input placeholder should say "Tell me about yourself..."

- [ ] **Step 4: Walk through the onboarding conversation**

1. Answer the AI's questions about use case and goals
2. Verify the AI asks about experience level and injuries
3. Answer those, verify it asks about equipment and schedule
4. Answer those, verify it asks about diet and sleep/stress
5. After final answers, verify the AI summarizes and invites a first question
6. Verify the placeholder changes back to "Ask me anything about training, nutrition, recovery, or performance."

- [ ] **Step 5: Verify profile was saved**

```bash
ssh hetzner "docker compose -f ~/supabase-docker/docker-compose.yml exec -T db psql -U supabase_admin -d postgres -c \"SELECT goal, experience_level, primary_use_case, equipment_access, available_days_per_week, available_minutes_per_session, dietary_preferences, injuries_limitations, sleep_stress_context, onboarding_completed FROM profiles WHERE email = '<test-user-email>';\""
```

Expected: all fields populated, `onboarding_completed = true`.

- [ ] **Step 6: Verify normal chat works after onboarding**

Type a question like "What's the optimal protein intake for muscle growth?" and verify the full RAG pipeline runs (sources, widgets, etc.).

- [ ] **Step 7: Verify profile page is read-only**

Navigate to `http://127.0.0.1:3001/app/profile/`. Verify all fields are displayed and disabled.

- [ ] **Step 8: Update docs/schema.md with new columns**

Add the 5 new columns to the profiles table documentation in `docs/schema.md`.

- [ ] **Step 9: Final commit**

```bash
git add docs/schema.md
git commit -m "docs: add extended profile columns to schema reference"
```
