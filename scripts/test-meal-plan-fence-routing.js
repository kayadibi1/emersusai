// scripts/test-meal-plan-fence-routing.js
//
// Verifies that shared/widget-fence-parser.js recognizes meal-plan and
// nutrition-log-confirm fences and produces well-formed segments.
//
// Usage: node scripts/test-meal-plan-fence-routing.js

import assert from "node:assert/strict";
import {
  parseLLMOutput,  // real export name from widget-fence-parser.js
} from "../shared/widget-fence-parser.js";

const mealPlanBlock = `
Here is your plan.

\`\`\`meal-plan
{
  "targets": {"training_day": {"kcal": 2800, "protein_g": 190, "carbs_g": 340, "fat_g": 80, "fiber_g": 40}},
  "day_types": [{"slug": "training_day", "name": "Training day", "meals": []}],
  "assignments": {"mode": "auto_from_workout", "default_day_type": "training_day"}
}
\`\`\`
`;

const logConfirmBlock = `
\`\`\`nutrition-log-confirm
{"resolved_items": [], "meal_slot": "lunch", "logged_date": "2026-04-11"}
\`\`\`
`;

console.log("[test-meal-plan-fence-routing] running");

{
  const segs = parseLLMOutput(mealPlanBlock);
  const mealSeg = segs.find(s => s.type === "meal-plan");
  assert.ok(mealSeg, "expected a meal-plan segment");
  const parsed = JSON.parse(mealSeg.content);
  assert.ok(parsed.targets.training_day.kcal === 2800);
  console.log("  \u2713 meal-plan fence parsed");
}

{
  const segs = parseLLMOutput(logConfirmBlock);
  const logSeg = segs.find(s => s.type === "nutrition-log-confirm");
  assert.ok(logSeg, "expected a nutrition-log-confirm segment");
  const parsed = JSON.parse(logSeg.content);
  assert.equal(parsed.meal_slot, "lunch");
  console.log("  \u2713 nutrition-log-confirm fence parsed");
}

console.log("[test-meal-plan-fence-routing] all assertions passed.");
