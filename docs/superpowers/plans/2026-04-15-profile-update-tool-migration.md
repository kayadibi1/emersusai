# Profile Update Tool Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `~~~profile-update` fence parsing in the onboarding pipeline with a proper `update_user_profile` OpenAI function-calling tool, using the same server-side tool pattern established by `get_user_profile`.

**Architecture:** Add `update_user_profile` to `pipeline/tools.js` + `SERVER_SIDE_TOOLS`. Rewrite `pipeline/onboarding.js` to pass tools to the OpenAI call, handle tool_calls in the response, resolve them server-side (PATCH profile), and make follow-up requests via `previous_response_id` so the model can continue generating text after the profile write.

**Tech Stack:** OpenAI Responses API with function-calling, Express, Supabase REST

---

### Task 1: Add `update_user_profile` tool definition

**Files:**
- Modify: `api/emersus/pipeline/tools.js`

- [ ] **Step 1: Add the tool definition**

After the `GET_USER_PROFILE` constant (around line 354), before the `// ── Exports` section, add:

```js
// ── update_user_profile (server-side tool) ─────────────────────────────
//
// The onboarding flow calls this to persist profile fields extracted from
// the conversation. The server intercepts the call, PATCHes the profile
// to Supabase, returns a confirmation, and continues generation.
// Replaces the legacy ~~~profile-update fence pattern.

const UPDATE_USER_PROFILE = {
  type: "function",
  name: "update_user_profile",
  strict: true,
  description: [
    "Save extracted profile fields from the onboarding conversation.",
    "Call this after each user response when you have new profile information to save.",
    "Only include fields you have confident, non-null values for.",
    "On the final exchange (after all info is gathered), include onboarding_completed: true.",
  ].join("\n"),
  parameters: {
    type: "object",
    required: [],
    additionalProperties: false,
    properties: {
      goal: { type: "string", description: "Primary fitness/health goal" },
      experience_level: { type: "string", enum: ["beginner", "intermediate", "advanced"], description: "Training experience level" },
      injuries_limitations: { type: "string", description: "Any injuries or physical limitations" },
      equipment_access: { type: "string", description: "What equipment they have access to" },
      available_days_per_week: { type: "number", description: "Training days per week" },
      dietary_preferences: { type: "string", description: "Diet preferences or restrictions" },
      primary_use_case: { type: "string", description: "What they want to use Emersus for" },
      weight_unit: { type: "string", enum: ["kg", "lbs"], description: "Preferred weight unit" },
      distance_unit: { type: "string", enum: ["km", "mi"], description: "Preferred distance unit" },
      preferred_sports: {
        type: "array",
        items: { type: "string", enum: ["weights", "running", "cycling", "swimming", "climbing", "mixed"] },
        description: "Sports/activities they do",
      },
      default_pool_length_m: { type: "number", enum: [25, 50, 22.86, 30.48], description: "Pool length in meters" },
      default_grade_system: { type: "string", enum: ["V", "YDS", "Font", "French"], description: "Climbing grade system" },
      onboarding_completed: { type: "boolean", description: "Set true on the final exchange after all info is gathered" },
    },
  },
};
```

- [ ] **Step 2: Add to exports**

Update the `TOOL_DEFINITIONS` array to include the new tool:

```js
export const TOOL_DEFINITIONS = [EMIT_MEAL_PLAN, EMIT_WORKOUT_PLAN, EMIT_WIDGET, LOG_FOOD, GET_USER_PROFILE, UPDATE_USER_PROFILE];
```

Add it to `SERVER_SIDE_TOOLS`:

```js
export const SERVER_SIDE_TOOLS = new Set(["get_user_profile", "update_user_profile"]);
```

Also export `UPDATE_USER_PROFILE` individually so onboarding.js can import just that tool:

```js
export { UPDATE_USER_PROFILE };
```

- [ ] **Step 3: Commit**

```bash
git add api/emersus/pipeline/tools.js
git commit -m "feat(pipeline): add update_user_profile server-side tool definition"
```

---

### Task 2: Add `update_user_profile` handler to stream.js

**Files:**
- Modify: `api/emersus/pipeline/stream.js`

- [ ] **Step 1: Handle `update_user_profile` in `resolveAndContinue`**

In the `resolveAndContinue` function, find the section that maps `state.serverToolCalls` to `toolOutputs`. Currently it only handles `get_user_profile`. Add the `update_user_profile` case.

Find:
```js
  const toolOutputs = state.serverToolCalls.map((tc) => {
    if (tc.name === "get_user_profile") {
      const profile = compactProfile(ctx.profile);
      return {
        type: "function_call_output",
        call_id: tc.callId,
        output: JSON.stringify(profile || { note: "No profile data saved yet. Use defaults." }),
      };
    }
    return null;
  }).filter(Boolean);
```

Replace with:
```js
  const toolOutputs = [];
  for (const tc of state.serverToolCalls) {
    if (tc.name === "get_user_profile") {
      const profile = compactProfile(ctx.profile);
      toolOutputs.push({
        type: "function_call_output",
        call_id: tc.callId,
        output: JSON.stringify(profile || { note: "No profile data saved yet. Use defaults." }),
      });
    } else if (tc.name === "update_user_profile") {
      // Profile update is handled by the caller (onboarding.js or stream consumer).
      // Store the parsed args on ctx so the caller can persist them.
      if (tc.args && typeof tc.args === "object") {
        if (!ctx._profileUpdates) ctx._profileUpdates = {};
        Object.assign(ctx._profileUpdates, tc.args);
      }
      toolOutputs.push({
        type: "function_call_output",
        call_id: tc.callId,
        output: JSON.stringify({ status: "saved" }),
      });
    }
  }
```

- [ ] **Step 2: Capture tool arguments in processEvent**

In the `processEvent` function, where server-side tool calls are queued (the `if (SERVER_SIDE_TOOLS.has(toolName))` block), also capture the parsed arguments:

Find:
```js
        if (SERVER_SIDE_TOOLS.has(toolName)) {
          if (state.serverToolCalls) state.serverToolCalls.push({ callId, name: toolName });
          break;
        }
```

Replace with:
```js
        if (SERVER_SIDE_TOOLS.has(toolName)) {
          let args = null;
          try { args = JSON.parse(argsStr); } catch {}
          if (state.serverToolCalls) state.serverToolCalls.push({ callId, name: toolName, args });
          break;
        }
```

Note: `argsStr` is already computed just above this block (it's `event.item.arguments || (toolBuf?.chunks.join("") ?? "")`).

- [ ] **Step 3: Commit**

```bash
git add api/emersus/pipeline/stream.js
git commit -m "feat(pipeline): handle update_user_profile in server-side tool resolution"
```

---

### Task 3: Rewrite onboarding.js to use function-calling

**Files:**
- Modify: `api/emersus/pipeline/onboarding.js`

This is the main task. Replace the fence-based system prompt with tool-calling instructions, rewrite the API call to include tools, and handle tool_calls in the response.

- [ ] **Step 1: Update imports**

Add at the top of the file:
```js
import { UPDATE_USER_PROFILE } from "./tools.js";
```

- [ ] **Step 2: Replace the system prompt**

Replace the entire `ONBOARDING_SYSTEM_PROMPT` constant with:

```js
const ONBOARDING_SYSTEM_PROMPT = [
  "You are Emersus AI, an evidence-based exercise science assistant. A brand new user just opened the chat for the first time. Your job is to welcome them warmly and learn about them through a short, natural conversation so you can personalize future guidance.",
  "",
  "CONVERSATION FLOW (group 2-3 questions per message):",
  "1. Greet warmly. Ask what they want to use Emersus for and what their primary fitness goal is. Suggest examples: workout programming, nutrition planning, mental performance and focus, recovery and sleep optimization, injury management, or understanding the science behind training. If they're unsure, help them explore what Emersus can do.",
  "2. Ask about their experience level (beginner / intermediate / advanced) and any injuries or physical limitations.",
  "3. Ask about equipment access, how many days per week they can train, any dietary preferences or restrictions, whether they prefer kilograms or pounds (kg/lbs), and what kind of training they do — pick any that apply: weights, running, cycling, swimming, climbing, mixed. If they mention swimming, ask pool length (25m/50m/25yd). If they mention climbing, ask grade system (V-scale or YDS).",
  "4. After all questions are answered, call update_user_profile one final time with onboarding_completed set to true. Summarize what you learned in 2-3 sentences. Then invite them to ask their first question — e.g., 'You're all set! What would you like to start with?'",
  "",
  "BEHAVIORAL RULES:",
  "- Group 2-3 questions per message. Keep it conversational, not robotic.",
  "- If the user mentions something that needs a follow-up (e.g., a serious injury, an unusual goal), ask about it before moving on.",
  "- Don't repeat back every answer verbatim. Acknowledge briefly and move forward.",
  "- Emersus covers the full breadth of exercise science — workouts, nutrition, mental performance, recovery, sleep, injury rehab, and the underlying science. Don't make it sound like a gym-only tool.",
  "- Be warm but efficient. The whole onboarding should take 3-4 exchanges.",
  "",
  "PROFILE SAVING:",
  "After each user response, call the update_user_profile tool with the fields you extracted.",
  "Only include fields you have confident values for — never include a field with null.",
  "On the final exchange, include onboarding_completed: true.",
].join("\n");
```

- [ ] **Step 3: Remove `extractProfileUpdateFences` function**

Delete the entire `extractProfileUpdateFences` function (lines 75-111 in the original file). It's no longer needed.

- [ ] **Step 4: Rewrite `handleOnboarding` to use tools**

Replace the entire `handleOnboarding` function with:

```js
async function handleOnboarding({
  question,
  userId,
  recentMessages,
  supabaseUrl,
  serviceRoleKey,
  supabaseUserId,
  stableUserId,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const input = [
    { role: "system", content: ONBOARDING_SYSTEM_PROMPT },
  ];

  if (Array.isArray(recentMessages)) {
    for (const msg of recentMessages) {
      if (msg.role && msg.text) {
        input.push({ role: msg.role, content: msg.text });
      }
    }
  }

  const userMessage = question === "__onboarding_start__"
    ? "Hi, I just created my account!"
    : String(question || "");
  if (userMessage) {
    input.push({ role: "user", content: userMessage });
  }

  // Make initial request with the update_user_profile tool
  let response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_output_tokens: 1000,
      input,
      tools: [UPDATE_USER_PROFILE],
    }),
  });

  let payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    console.error("OpenAI onboarding error:", payload?.error?.message || response.status);
    throw new Error("Onboarding request failed. Please try again.");
  }

  // Collect text and profile fields across multi-turn tool resolution
  let allText = "";
  const profileFields = {};
  let onboardingCompleted = false;
  let attempts = 0;

  while (attempts < 3) {
    attempts++;

    // Extract text from output
    const text = extractTextFromResponse(payload);
    if (text) allText += (allText ? "\n" : "") + text;

    // Check for tool calls
    const toolCalls = [];
    if (Array.isArray(payload.output)) {
      for (const item of payload.output) {
        if (item.type === "function_call" && item.name === "update_user_profile") {
          let args = {};
          try { args = JSON.parse(item.arguments || "{}"); } catch {}
          toolCalls.push({ callId: item.call_id || item.id, args });
        }
      }
    }

    if (toolCalls.length === 0) break; // No tool calls — model is done

    // Process tool calls: extract profile fields
    const toolOutputs = [];
    for (const tc of toolCalls) {
      if (tc.args && typeof tc.args === "object") {
        for (const [k, v] of Object.entries(tc.args)) {
          if (v !== null && v !== undefined) {
            profileFields[k] = v;
          }
        }
        if (tc.args.onboarding_completed) onboardingCompleted = true;
      }
      toolOutputs.push({
        type: "function_call_output",
        call_id: tc.callId,
        output: JSON.stringify({ status: "saved" }),
      });
    }

    // Follow-up request so model can continue after tool call
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_output_tokens: 1000,
        previous_response_id: payload.id,
        input: toolOutputs,
        tools: [UPDATE_USER_PROFILE],
      }),
    });

    payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      console.error("OpenAI onboarding follow-up error:", payload?.error?.message || response.status);
      break;
    }
  }

  // Persist profile fields to Supabase
  if (Object.keys(profileFields).length > 0) {
    upsertOnboardingProfile(supabaseUrl, serviceRoleKey, supabaseUserId, profileFields)
      .catch((err) => console.error("Onboarding profile upsert error:", err));
  }

  return {
    user: {
      id: stableUserId || null,
      profile_used: {},
    },
    plan: { topic: "onboarding", riskLevel: "none" },
    summary: allText,
    answer_text: allText,
    recommendations: [],
    confidence: {
      score: 1,
      label: "high",
      rationale: "Onboarding responses come from the deterministic onboarding flow.",
    },
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
    onboarding_completed: onboardingCompleted || Boolean(profileFields.onboarding_completed),
  };
}
```

- [ ] **Step 5: Update exports**

Change the export at the bottom from:
```js
export { handleOnboarding, extractProfileUpdateFences };
```
To:
```js
export { handleOnboarding };
```

- [ ] **Step 6: Check if `extractProfileUpdateFences` is imported anywhere else**

Search for any other imports of `extractProfileUpdateFences` in the codebase. If found, remove the import (it's dead code now).

- [ ] **Step 7: Verify syntax**

Run: `node --check api/emersus/pipeline/onboarding.js`

- [ ] **Step 8: Commit**

```bash
git add api/emersus/pipeline/onboarding.js
git commit -m "feat(onboarding): replace ~~~profile-update fences with update_user_profile tool call"
```

---

### Task 4: Update docs and checkpoint

**Files:**
- Modify: `checkpoint.md`
- Modify: `changelog.md`

- [ ] **Step 1: Update checkpoint.md**

Find:
```
7. ⬜ **Phase 9 — Migrate `~~~profile-update` fences → OpenAI function-calling** for onboarding.
```
Replace with:
```
7. ✅ **Phase 9 — Migrate `~~~profile-update` fences → OpenAI function-calling** — shipped 2026-04-15. Onboarding now uses `update_user_profile` tool call.
```

- [ ] **Step 2: Update changelog.md**

Add at the top:
```
2026-04-15 — Onboarding profile-update fences → function-calling — replaced ~~~profile-update regex parsing with update_user_profile OpenAI tool call; multi-turn resolution via previous_response_id — api/emersus/pipeline/onboarding.js, api/emersus/pipeline/tools.js, api/emersus/pipeline/stream.js
```

- [ ] **Step 3: Commit**

```bash
git add checkpoint.md changelog.md
git commit -m "docs: mark profile-update migration shipped, add changelog"
```
