function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function isExplicitEvidenceRequest(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return /\b(research|evidence|study|studies|paper|papers|meta[-\s]?analysis|systematic review|pubmed|literature|sources?)\b/.test(t);
}

function isLogFoodIntent(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    /^(log|track|record)\s+/.test(t) ||
    /^i\s+(just\s+)?(had|ate|drank|took)\b/.test(t) ||
    /^(took|taking)\s+(my\s+)?(supps?|stack|vitamins?|supplements?)\b/.test(t) ||
    /^(for|at)\s+(breakfast|lunch|dinner|snack|supper)\b.*[:\-]/.test(t) ||
    /\blog\s+(this|these|it|that)\b/.test(t)
  );
}

function isMealPlanIntent(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    /\b(meal plan|diet plan|eating plan|nutrition plan|macro plan|macro breakdown)\b/.test(t) ||
    /\b(cut plan|cutting plan|bulk plan|bulking plan|recomp plan|lean bulk plan)\b/.test(t) ||
    /\b(plan my meals|plan my diet|plan my macros|what should i eat|give me a diet)\b/.test(t) ||
    /\b(calorie deficit plan|calorie surplus plan|maintenance diet)\b/.test(t)
  );
}

function isWorkoutPlanIntent(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    /\b(workout plan|training plan|training program|workout program|workout split)\b/.test(t) ||
    /\b(training block|exercise routine|gym program|periodization plan)\b/.test(t) ||
    /\b(push pull legs|upper lower|full body program|bro split|4-day split)\b/.test(t) ||
    /\b(give me a program|build me a routine)\b/.test(t) ||
    /\bppl\b/.test(t)
  );
}

function isWorkoutAdjustmentIntent(text, workoutPlan) {
  const t = normalizeText(text);
  if (!t || !workoutPlan) return false;
  return (
    /\b(adjust|change|swap|replace|modify|tweak|update|edit|rework|reschedule|move)\b/.test(t) ||
    /\b(missed|skip|skipped|can't|cannot|too sore|reduce volume|increase volume|deload)\b/.test(t) ||
    /\b(day\s*[1-7]|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t)
  );
}

export function decideRetrieval({ question, workoutPlan }) {
  if (isExplicitEvidenceRequest(question)) {
    return { mode: "run", reason: "explicit_evidence_request" };
  }

  // Pure data-entry turns do not require scientific grounding because the
  // assistant should only acknowledge/log what the user supplied.
  if (isLogFoodIntent(question)) {
    return { mode: "skip", reason: "food_log_request" };
  }

  if (isMealPlanIntent(question)) {
    return { mode: "run", reason: "meal_plan_request" };
  }

  if (isWorkoutPlanIntent(question)) {
    return { mode: "run", reason: "workout_plan_request" };
  }

  if (isWorkoutAdjustmentIntent(question, workoutPlan)) {
    return { mode: "run", reason: "workout_adjustment_request" };
  }

  return { mode: "run", reason: "default" };
}

export function planRetrieval(ctx) {
  ctx.retrievalPolicy = decideRetrieval({
    question: ctx.question,
    workoutPlan: ctx.workoutPlan,
  });
  return ctx;
}

export {
  isExplicitEvidenceRequest,
  isLogFoodIntent,
  isMealPlanIntent,
  isWorkoutPlanIntent,
  isWorkoutAdjustmentIntent,
};
