// scripts/test-nutrition-parser.js
//
// Golden-fixture test for api/emersus/nutrition-parser.js.
// Hits the real OpenAI API — gated by EMERSUS_RUN_LLM_TESTS=1 so it doesn't
// run in every push automatically (costs $$$ per run).
//
// Requires:
//   - OPENAI_API_KEY
//   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (for the match pipeline)
//   - Foods catalog populated (at minimum: seeded supplements)
//
// Usage: EMERSUS_RUN_LLM_TESTS=1 node scripts/test-nutrition-parser.js

import "dotenv/config";
import assert from "node:assert/strict";
import { parseFoodDescription } from "../api/emersus/nutrition-parser.js";

if (!process.env.EMERSUS_RUN_LLM_TESTS) {
  console.log("[test-nutrition-parser] skipped (set EMERSUS_RUN_LLM_TESTS=1 to run)");
  process.exit(0);
}

const authHeader = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

const cases = [
  {
    input: "took 5g creatine and 2000 IU vitamin D",
    expect: (result) => {
      assert.ok(result.items.length + result.unresolved.length >= 2, "should parse ≥2 items");
      const hasCreatine = result.items.some(i => /creatine/i.test(i.food_description));
      const hasD = result.items.some(i => /vitamin d|d3/i.test(i.food_description));
      assert.ok(hasCreatine, "should match creatine");
      assert.ok(hasD, "should match vitamin D");
    },
  },
  {
    input: "I had a medium banana",
    expect: (result) => {
      const all = [...result.items, ...result.unresolved];
      const banana = all.find(i =>
        /banana/i.test(i.food_description ?? i.description)
      );
      assert.ok(banana, "should recognize banana");
      assert.equal(banana.kind, "food");
    },
  },
  {
    input: "log breakfast: 3 eggs, 2 slices whole wheat toast, 1 tbsp butter",
    expect: (result) => {
      const all = [...result.items, ...result.unresolved];
      assert.ok(all.length >= 3, `expected ≥3 items, got ${all.length}`);
      const egg = all.find(i => /egg/i.test(i.food_description ?? i.description));
      assert.ok(egg, "should recognize eggs");
    },
  },
];

console.log("[test-nutrition-parser] running", cases.length, "cases");
for (const tc of cases) {
  const result = await parseFoodDescription(tc.input, { authHeader });
  try {
    tc.expect(result);
    console.log(`  ✓ "${tc.input}"`);
  } catch (err) {
    console.error(`  ✗ "${tc.input}":`, err.message);
    console.error("    result:", JSON.stringify(result, null, 2));
    process.exit(1);
  }
}
console.log("[test-nutrition-parser] all assertions passed.");
