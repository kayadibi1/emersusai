// api/emersus/suggest-prompts.js
//
// GET /api/emersus/suggest-prompts?profile_id=<uuid>
//
// Returns 6 prompt chips for the chat_v2 empty-state UI. When a profile_id is
// supplied (and Supabase is configured), we look up the user's goal +
// experience level and return a tailored set; otherwise we fall back to the
// generic 6. Prompt resolution is a pure function so it can be unit-tested
// without hitting the database.

import { supabaseAdmin } from "../lib/clients.js";

export const GENERIC_PROMPTS = [
  { id: "g-protein", label: "How much protein do I need?", prompt: "How much protein do I need per day for muscle growth?" },
  { id: "g-push-day", label: "Build me a push day", prompt: "Build me a push day workout for dumbbells, 50 minutes." },
  { id: "g-zone-2", label: "Best Zone 2 cardio protocol", prompt: "What's the best Zone 2 cardio protocol for an intermediate athlete?" },
  { id: "g-creatine", label: "Is creatine worth taking?", prompt: "Is creatine worth taking? What does the evidence say about loading vs maintenance?" },
  { id: "g-deload", label: "Deload frequency", prompt: "How should I deload as an intermediate lifter?" },
  { id: "g-cutting-day", label: "Plan a cutting day", prompt: "Plan a 2,250 kcal cutting day with 140g protein." },
];

const HYPERTROPHY_PROMPTS = [
  { id: "h-protein-window", label: "Anabolic window — real?", prompt: "Is the anabolic window real for hypertrophy, or does total daily protein matter more?" },
  { id: "h-volume-mev", label: "MEV vs MV for chest", prompt: "What's the MEV (minimum effective volume) for chest hypertrophy?" },
  { id: "h-set-rep", label: "Sets and reps for size", prompt: "What set and rep ranges drive the most hypertrophy?" },
  { id: "h-rest", label: "Rest interval evidence", prompt: "How long should I rest between sets for hypertrophy — what does the evidence say?" },
  { id: "h-frequency", label: "Frequency per muscle", prompt: "How many times per week should I train each muscle for hypertrophy?" },
  { id: "h-eccentric", label: "Eccentric overload", prompt: "Is eccentric overload worth programming, and how much extra hypertrophy does it produce?" },
];

const ENDURANCE_PROMPTS = [
  { id: "e-zone-2", label: "Zone 2 HR target", prompt: "What heart-rate range should I target for Zone 2 cardio at age 35?" },
  { id: "e-vo2-intervals", label: "VO2 max interval protocols", prompt: "Which VO2 max interval protocols have the strongest evidence?" },
  { id: "e-threshold", label: "Threshold work weekly dose", prompt: "How much threshold work per week is optimal for an intermediate cyclist?" },
  { id: "e-fueling", label: "Long-ride fueling", prompt: "How should I fuel a 3-hour endurance ride?" },
  { id: "e-polarized", label: "Polarized vs pyramidal", prompt: "Polarized vs pyramidal training — which produces more endurance gains?" },
  { id: "e-recovery", label: "Endurance recovery", prompt: "What recovery practices have the best evidence for endurance athletes?" },
];

const FAT_LOSS_PROMPTS = [
  { id: "f-deficit", label: "Calorie deficit size", prompt: "How aggressive a calorie deficit can I run while preserving muscle?" },
  { id: "f-protein-cut", label: "Protein on a cut", prompt: "How much protein should I eat while cutting?" },
  { id: "f-cardio", label: "Cardio for fat loss", prompt: "Steady-state vs intervals for fat loss — what does the evidence say?" },
  { id: "f-refeeds", label: "Refeed days — worth it?", prompt: "Are refeed days worth scheduling on a cut?" },
  { id: "f-weight-train", label: "Lifting on a deficit", prompt: "How should I adjust my lifting volume during a cut?" },
  { id: "f-hunger", label: "Hunger management", prompt: "What evidence-based strategies reduce hunger on a calorie deficit?" },
];

const GENERAL_HEALTH_PROMPTS = [
  { id: "gh-zone-2-min", label: "Zone 2 weekly minimum", prompt: "How much Zone 2 cardio per week is the health minimum?" },
  { id: "gh-strength", label: "Strength for longevity", prompt: "What strength training dose has the strongest evidence for longevity?" },
  { id: "gh-protein", label: "Protein for general health", prompt: "How much protein per day for general health, not lifting?" },
  { id: "gh-sleep", label: "Sleep and metabolic health", prompt: "How does sleep duration affect metabolic health markers?" },
  { id: "gh-vit-d", label: "Vitamin D — supplement?", prompt: "Should I supplement vitamin D? What does the evidence say about dosing?" },
  { id: "gh-omega-3", label: "Omega-3 dose", prompt: "What omega-3 dose has the strongest evidence for general health?" },
];

const BEGINNER_PROMPTS = [
  { id: "b-first-program", label: "First lifting program", prompt: "Recommend a beginner lifting program. What's the evidence behind starting strength vs 5/3/1?" },
  { id: "b-protein", label: "Protein basics", prompt: "How much protein do I need? I'm new to lifting." },
  { id: "b-cardio", label: "Cardio basics", prompt: "What's a sensible cardio starting point for a new lifter?" },
  { id: "b-rest", label: "Rest day frequency", prompt: "How many rest days per week should a beginner take?" },
  { id: "b-form", label: "Form vs weight", prompt: "How important is squat form vs the weight on the bar for a beginner?" },
  { id: "b-sleep", label: "Sleep for beginners", prompt: "How does sleep quality affect strength gains for a beginner?" },
];

/**
 * Resolve the prompt set for a given profile.
 * Profile shape: { goal?: string, experience?: string }
 */
export function promptsForProfile(profile) {
  if (!profile || typeof profile !== "object") return GENERIC_PROMPTS;
  const goal = String(profile.goal || "").toLowerCase();
  const experience = String(profile.experience || "").toLowerCase();

  // Beginner overrides goal-specific prompts so a brand-new lifter doesn't
  // get hypertrophy-volume trivia before they understand sets and reps.
  if (experience === "beginner" || experience === "new") return BEGINNER_PROMPTS;

  if (goal === "hypertrophy" || goal === "muscle_gain" || goal === "muscle") return HYPERTROPHY_PROMPTS;
  if (goal === "endurance" || goal === "cardio" || goal === "cycling" || goal === "running") return ENDURANCE_PROMPTS;
  if (goal === "fat_loss" || goal === "weight_loss" || goal === "cut") return FAT_LOSS_PROMPTS;
  if (goal === "general_health" || goal === "health" || goal === "longevity") return GENERAL_HEALTH_PROMPTS;

  return GENERIC_PROMPTS;
}

async function loadProfile(profileId) {
  if (!supabaseAdmin || !profileId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .select("goal,experience_level")
      .eq("id", profileId)
      .maybeSingle();
    if (error || !data) return null;
    return { goal: data.goal, experience: data.experience_level };
  } catch {
    return null;
  }
}

export default async function suggestPromptsHandler(req, res) {
  try {
    const profileId = String(req.query?.profile_id || "").trim();
    const profile = profileId ? await loadProfile(profileId) : null;
    const prompts = promptsForProfile(profile);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.json(prompts);
  } catch (err) {
    console.error("suggest-prompts handler error", err);
    res.json(GENERIC_PROMPTS);
  }
}
