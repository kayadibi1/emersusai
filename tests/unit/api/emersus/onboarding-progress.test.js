import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeOnboardingProgress,
  REQUIRED_FIELDS,
} from "../../../../api/emersus/onboarding-progress.js";

describe("computeOnboardingProgress", () => {
  test("empty profile → 0.0", () => {
    assert.equal(computeOnboardingProgress({}), 0.0);
    assert.equal(computeOnboardingProgress(null), 0.0);
    assert.equal(computeOnboardingProgress(undefined), 0.0);
  });

  test("all 5 required fields captured → 1.0", () => {
    const profile = {
      goal: "hypertrophy",
      experience_level: "intermediate",
      dietary_preferences: "no restrictions",
      equipment: { barbell: true, dumbbells: true },
      injuries_limitations: "none",
    };
    assert.equal(computeOnboardingProgress(profile), 1.0);
  });

  test("3 of 5 captured → 0.6", () => {
    const profile = {
      goal: "hypertrophy",
      experience_level: "intermediate",
      dietary_preferences: "no restrictions",
      equipment: null,
      injuries_limitations: "",
    };
    assert.equal(computeOnboardingProgress(profile), 0.6);
  });

  test("empty string counts as unset", () => {
    assert.equal(
      computeOnboardingProgress({ goal: "", experience_level: "beginner" }),
      0.2,
    );
  });

  test("empty jsonb object/array counts as unset for equipment", () => {
    assert.equal(computeOnboardingProgress({ equipment: {} }), 0.0);
    assert.equal(computeOnboardingProgress({ equipment: [] }), 0.0);
    assert.equal(computeOnboardingProgress({ equipment: { barbell: true } }), 0.2);
  });

  test("extra fields do not inflate progress", () => {
    const profile = {
      goal: "hypertrophy",
      full_name: "Test",
      weight_unit: "kg",
    };
    assert.equal(computeOnboardingProgress(profile), 0.2);
  });

  test("REQUIRED_FIELDS is a stable list of 5", () => {
    assert.equal(REQUIRED_FIELDS.length, 5);
    assert.deepEqual(REQUIRED_FIELDS, [
      "goal",
      "experience_level",
      "dietary_preferences",
      "equipment",
      "injuries_limitations",
    ]);
  });
});
