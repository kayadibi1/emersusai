// api/emersus/suggest-prompts-personalize.js
//
// Generates 6 personalized first-question chips for a user based on their
// onboarding profile. Uses the OpenAI Responses API with a strict:true
// function-calling tool. Falls back silently (returns null) on any failure
// or if the 4s timeout elapses.

// Read at call time so tests can set process.env.OPENAI_API_KEY before importing.
const OPENAI_MODEL = () => process.env.OPENAI_EMERSUS_MODEL || "gpt-4.1-mini";

const PROMPT_TOOL = {
  type: "function",
  name: "emit_personalized_prompts",
  strict: true,
  description:
    "Return exactly 6 suggested first-question prompts tailored to the user's profile.",
  parameters: {
    type: "object",
    required: ["prompts"],
    additionalProperties: false,
    properties: {
      prompts: {
        type: "array",
        description: "Exactly 6 suggested prompts.",
        items: {
          type: "object",
          required: ["id", "label", "prompt"],
          additionalProperties: false,
          properties: {
            id: { type: "string", description: "Short slug id (e.g. 'periodized-strength')" },
            label: { type: "string", description: "Chip label, max 28 chars" },
            prompt: { type: "string", description: "The question text the user would send" },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT =
  "You generate 6 first-question chip suggestions for a new user of an evidence-based fitness and nutrition chat. Match the user's goal, experience level, and equipment. Each label must fit in ~28 characters. Prompts should be concrete questions the user would actually ask.";

export async function generatePersonalizedPrompts(profile, { timeoutMs = 4000 } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  // No guard on apiKey — a missing/invalid key will cause fetch to return a
  // 401 or throw, both of which are caught below and return null. This also
  // allows tests to mock global.fetch without needing to set the env var.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL(),
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              "Profile:\n" +
              `- Goal: ${profile?.goal || "unspecified"}\n` +
              `- Experience: ${profile?.experience_level || "unspecified"}\n` +
              `- Equipment: ${JSON.stringify(profile?.equipment || {})}\n` +
              `- Dietary preferences: ${profile?.dietary_preferences || "unspecified"}\n\n` +
              "Generate 6 chips.",
          },
        ],
        tools: [PROMPT_TOOL],
        tool_choice: { type: "function", name: "emit_personalized_prompts" },
      }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const call = (body.output || []).find(
      (o) => o.type === "function_call" && o.name === "emit_personalized_prompts",
    );
    if (!call) return null;
    const args = JSON.parse(call.arguments || "{}");
    const prompts = Array.isArray(args.prompts) ? args.prompts : null;
    if (!prompts || prompts.length !== 6) return null;
    return prompts;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
