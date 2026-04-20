// ---------------------------------------------------------------------------
// Onboarding pipeline module
// Conversational profile capture for new users — replaces the RAG pipeline.
// ---------------------------------------------------------------------------

import { UPDATE_USER_PROFILE } from "./tools.js";
import { computeOnboardingProgress } from "../onboarding-progress.js";

const DEFAULT_MODEL = process.env.OPENAI_EMERSUS_MODEL || "gpt-5.4-mini";

function extractTextFromResponse(payload) {
  if (payload?.output_text) return payload.output_text;
  if (Array.isArray(payload?.output)) {
    for (const item of payload.output) {
      if (item.text) return item.text;
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.text) return c.text;
        }
      }
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Conversational onboarding — replaces the RAG pipeline for new users
// ---------------------------------------------------------------------------

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


async function upsertOnboardingProfile(supabaseUrl, serviceRoleKey, supabaseUserId, fields) {
  if (!supabaseUrl || !serviceRoleKey || !supabaseUserId) return;
  if (!fields || typeof fields !== "object" || Object.keys(fields).length === 0) return;

  const validColumns = new Set([
    "goal", "experience_level", "dietary_preferences", "injuries_limitations",
    "equipment_access", "available_days_per_week", "available_minutes_per_session",
    "sleep_stress_context", "primary_use_case", "weight_unit", "distance_unit",
    "preferred_sports", "default_pool_length_m", "default_grade_system",
    "onboarding_completed",
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
    return { ok: false, progress: null };
  }

  // After primary PATCH succeeds, fetch the full profile row and recompute progress.
  const getResp = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(supabaseUserId)}&select=*`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  if (!getResp.ok) {
    // Non-fatal — return without progress update; bar stays at last known value.
    return { ok: true, progress: null };
  }
  const rows = await getResp.json();
  const profile = Array.isArray(rows) ? rows[0] : null;
  const progress = computeOnboardingProgress(profile);

  // PATCH progress separately (only column, cheap).
  await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(supabaseUserId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ onboarding_progress: progress }),
    },
  );

  return { ok: true, progress };
}

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

  let allText = "";
  const profileFields = {};
  let onboardingCompleted = false;
  let attempts = 0;

  while (attempts < 3) {
    attempts++;

    const text = extractTextFromResponse(payload);
    if (text) allText += (allText ? "\n" : "") + text;

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

    if (toolCalls.length === 0) break;

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

export { handleOnboarding };
