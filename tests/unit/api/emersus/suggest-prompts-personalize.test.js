import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generatePersonalizedPrompts } from "../../../../api/emersus/suggest-prompts-personalize.js";

describe("generatePersonalizedPrompts", () => {
  test("returns 6 prompts with id/label/prompt shape", async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        output: [{
          type: "function_call",
          name: "emit_personalized_prompts",
          arguments: JSON.stringify({
            prompts: [
              { id: "p1", label: "Periodized strength", prompt: "Design a 12-week periodized strength program" },
              { id: "p2", label: "Protein timing", prompt: "When should I eat protein?" },
              { id: "p3", label: "Deload frequency", prompt: "How often should I deload?" },
              { id: "p4", label: "Accessory volume", prompt: "How much accessory work?" },
              { id: "p5", label: "Sleep impact", prompt: "How does sleep affect strength?" },
              { id: "p6", label: "Creatine protocol", prompt: "Best creatine protocol?" },
            ],
          }),
        }],
      }),
    });
    const profile = { goal: "hypertrophy", experience_level: "intermediate", equipment: { barbell: true } };
    const prompts = await generatePersonalizedPrompts(profile);
    assert.equal(prompts.length, 6);
    assert.ok(prompts[0].id);
    assert.ok(prompts[0].label);
    assert.ok(prompts[0].prompt);
  });

  test("returns null on LLM 500", async () => {
    global.fetch = async () => ({ ok: false, status: 500, text: async () => "server error" });
    const prompts = await generatePersonalizedPrompts({ goal: "hypertrophy" });
    assert.equal(prompts, null);
  });

  test("returns null on timeout", async () => {
    global.fetch = async () => new Promise((resolve) => setTimeout(resolve, 6000));
    const prompts = await generatePersonalizedPrompts({ goal: "hypertrophy" }, { timeoutMs: 100 });
    assert.equal(prompts, null);
  });
});
