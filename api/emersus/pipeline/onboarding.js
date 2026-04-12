// ---------------------------------------------------------------------------
// Onboarding pipeline module
// Conversational profile capture for new users — replaces the RAG pipeline.
// ---------------------------------------------------------------------------

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
  "4. After all questions are answered, emit a final profile-update fence with onboarding_completed set to true. Summarize what you learned in 2-3 sentences. Then invite them to ask their first question — e.g., 'You're all set! What would you like to start with?'",
  "",
  "BEHAVIORAL RULES:",
  "- Group 2-3 questions per message. Keep it conversational, not robotic.",
  "- If the user mentions something that needs a follow-up (e.g., a serious injury, an unusual goal), ask about it before moving on.",
  "- Don't repeat back every answer verbatim. Acknowledge briefly and move forward.",
  "- Emersus covers the full breadth of exercise science — workouts, nutrition, mental performance, recovery, sleep, injury rehab, and the underlying science. Don't make it sound like a gym-only tool.",
  "- Be warm but efficient. The whole onboarding should take 3-4 exchanges.",
  "",
  "PROFILE-UPDATE FENCES:",
  "After each user response, emit a profile-update fence containing a JSON object with the fields you extracted. Only include fields you have confident, non-null values for — never include a field with a null value. Valid fields:",
  "- primary_use_case (string): what they want to use Emersus for",
  "- goal (string): their primary fitness/health goal",
  "- experience_level (string): 'beginner', 'intermediate', or 'advanced'",
  "- injuries_limitations (string): any injuries or physical limitations",
  "- equipment_access (string): what equipment they have access to",
  "- available_days_per_week (number): training days per week",
  "- dietary_preferences (string): diet preferences or restrictions",
  "- weight_unit (string): 'kg' or 'lbs' — their preferred unit for tracking weights",
  "- distance_unit (string): 'km' or 'mi'",
  "- preferred_sports (array of strings): any of weights, running, cycling, swimming, climbing, mixed",
  "- default_pool_length_m (number): 25, 50, 22.86, 30.48",
  "- default_grade_system (string): 'V', 'YDS', 'Font', or 'French'",
  "",
  "FENCE FORMAT — follow this EXACTLY on its own lines:",
  "",
  "~~~profile-update",
  '{"goal": "hypertrophy", "experience_level": "intermediate"}',
  "~~~",
  "",
  "CRITICAL FENCE RULES:",
  "- The opening ~~~profile-update MUST be on its own line.",
  "- The JSON MUST be on the next line.",
  "- The closing ~~~ MUST be on its own line.",
  "- NEVER put the fence inline with prose text.",
  "- There MUST be a blank line between your visible text and the fence.",
  "- On the FINAL exchange (after all info is gathered), include \"onboarding_completed\": true in the fence JSON.",
  "",
  "IMPORTANT: Place the fence at the END of your message, after all visible text. The fence is stripped before display — the user never sees it.",
].join("\n");

function extractProfileUpdateFences(text) {
  const src = String(text || "");
  const profileFields = {};

  // Match both well-formed fences (with closing ~~~) and inline/unclosed ones.
  // Pattern 1: ~~~profile-update\n{...}\n~~~ (proper multi-line)
  // Pattern 2: ~~~profile-update\s*{...}~~~  (inline with closing)
  // Pattern 3: ~~~profile-update\s*{...}     (unclosed, at end of text)
  const re = /~~~profile-update\s*\r?\n?([\s\S]*?)(?:~~~|$)/g;
  let match;

  while ((match = re.exec(src)) !== null) {
    const raw = match[1].trim();
    // Extract JSON — find the first {...} in the captured content.
    const jsonMatch = raw.match(/\{[^}]*\}/);
    if (!jsonMatch) continue;
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === "object") {
        // Strip null values the model might emit despite instructions.
        for (const [k, v] of Object.entries(parsed)) {
          if (v !== null && v !== undefined) {
            profileFields[k] = v;
          }
        }
      }
    } catch (_err) {
      // Malformed JSON in fence — skip silently.
    }
  }

  // Strip all fence variations from displayed text.
  const cleanText = src
    .replace(/\n*~~~profile-update\s*\r?\n?[\s\S]*?(?:~~~|$)/g, "")
    .trim();
  return { cleanText, profileFields };
}

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
  }
}

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

  const rawText = extractTextFromResponse(payload);
  const { cleanText, profileFields } = extractProfileUpdateFences(rawText);

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

export { handleOnboarding, extractProfileUpdateFences };
