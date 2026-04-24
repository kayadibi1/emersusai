// 100-prompt diagnostic bank for widget-v2 "graphics don't make sense" investigation.
//
// Stratification:
//   • 70 IN-USE prompts weighted by prod frequency (14 days, 19 live types)
//     Top-3 types (study_matrix / macro_ring / deload_protocol) get wider
//     variety sampling to expose within-template data-quality drift.
//   • 30 DARK probes targeting types that have never fired in prod. Prompts
//     are worded so the target template is clearly the best fit — if the
//     model still picks something else, we know it's template-blind.
//
// Each prompt is realistic user voice, no forcing language like
// "Show me a <template>". Tagged with expected_family and target_type so
// the grader can judge type-fit even when the model picks a sibling.

export const PROMPTS = [
  // ─────────────── IN-USE (70) ──────────────────────────────

  // evidence.study_matrix — top of prod distribution, 14 slots
  { id: 1,  family: "evidence", target: "study_matrix", prompt: "What do we actually know about creatine for strength?" },
  { id: 2,  family: "evidence", target: "study_matrix", prompt: "Summarize the research on ashwagandha and testosterone." },
  { id: 3,  family: "evidence", target: "study_matrix", prompt: "How strong is the evidence for beta-alanine?" },
  { id: 4,  family: "evidence", target: "study_matrix", prompt: "What does the literature say about caffeine and endurance performance?" },
  { id: 5,  family: "evidence", target: "study_matrix", prompt: "Is there good evidence for citrulline malate for lifting?" },
  { id: 6,  family: "evidence", target: "study_matrix", prompt: "Summarize the evidence around HMB." },
  { id: 7,  family: "evidence", target: "study_matrix", prompt: "What's the state of research on tart cherry for recovery?" },
  { id: 8,  family: "evidence", target: "study_matrix", prompt: "Walk me through the evidence for intermittent fasting and hypertrophy." },
  { id: 9,  family: "evidence", target: "study_matrix", prompt: "What do studies show about cold water immersion after training?" },
  { id: 10, family: "evidence", target: "study_matrix", prompt: "Is blood flow restriction training backed by research?" },
  { id: 11, family: "evidence", target: "study_matrix", prompt: "What's the research on sugar and athletic performance?" },
  { id: 12, family: "evidence", target: "study_matrix", prompt: "What does the science say about collagen for tendon healing?" },
  { id: 13, family: "evidence", target: "study_matrix", prompt: "Review the evidence on omega-3s for muscle recovery." },
  { id: 14, family: "evidence", target: "study_matrix", prompt: "How well-supported is the claim that dairy boosts IGF-1?" },

  // calculator.macro_ring — 12 slots
  { id: 15, family: "calculator", target: "macro_ring", prompt: "I'm 80kg cutting at 2200 kcal with 180g protein — what should my macros look like?" },
  { id: 16, family: "calculator", target: "macro_ring", prompt: "Give me a macro split for 2800 kcal maintenance, 150g protein." },
  { id: 17, family: "calculator", target: "macro_ring", prompt: "What macros hit 3200 kcal with 200g protein for a lean bulk?" },
  { id: 18, family: "calculator", target: "macro_ring", prompt: "How should I split 2000 kcal if I want 160g protein and lower carbs?" },
  { id: 19, family: "calculator", target: "macro_ring", prompt: "Macros for a 2500 kcal day with 140g protein." },
  { id: 20, family: "calculator", target: "macro_ring", prompt: "What do my macros look like at 1800 kcal, 130g protein, keto-ish?" },
  { id: 21, family: "calculator", target: "macro_ring", prompt: "Show a balanced macro breakdown for 3000 kcal, 170g protein." },
  { id: 22, family: "calculator", target: "macro_ring", prompt: "I eat 2400 kcal with 175g protein — how do my carbs and fats land?" },
  { id: 23, family: "calculator", target: "macro_ring", prompt: "Macro split for 2700 kcal, 165g protein, higher carb training days." },
  { id: 24, family: "calculator", target: "macro_ring", prompt: "I'm targeting 1900 kcal with 150g protein on a cut — macros?" },
  { id: 25, family: "calculator", target: "macro_ring", prompt: "3500 kcal bulk with 190g protein — how do the ratios work out?" },
  { id: 26, family: "calculator", target: "macro_ring", prompt: "Quick macro breakdown: 2300 kcal, 160g protein, moderate carbs." },

  // training.deload_protocol — 7 slots
  { id: 27, family: "training", target: "deload_protocol", prompt: "How should I structure a deload week after 6 hard weeks?" },
  { id: 28, family: "training", target: "deload_protocol", prompt: "What does a proper deload look like for squat and bench?" },
  { id: 29, family: "training", target: "deload_protocol", prompt: "I'm burnt out — plan me a deload." },
  { id: 30, family: "training", target: "deload_protocol", prompt: "How much volume should I cut during a deload?" },
  { id: 31, family: "training", target: "deload_protocol", prompt: "Give me a deload protocol for a powerlifting block." },
  { id: 32, family: "training", target: "deload_protocol", prompt: "Deload ideas for week 5 of hypertrophy training?" },
  { id: 33, family: "training", target: "deload_protocol", prompt: "Intensity vs volume cuts for a deload — what's standard?" },

  // nutrition.protein_distribution_bar — 5 slots
  { id: 34, family: "nutrition", target: "protein_distribution_bar", prompt: "How should I spread 180g protein across 4 meals?" },
  { id: 35, family: "nutrition", target: "protein_distribution_bar", prompt: "Protein distribution for 160g across breakfast, lunch, pre-workout, dinner." },
  { id: 36, family: "nutrition", target: "protein_distribution_bar", prompt: "Is it better to front-load protein or spread it evenly?" },
  { id: 37, family: "nutrition", target: "protein_distribution_bar", prompt: "Visualize my per-meal protein split targeting 200g." },
  { id: 38, family: "nutrition", target: "protein_distribution_bar", prompt: "Break 150g protein across 5 small meals — what's the split?" },

  // calculator.one_rm_estimator — 4 slots
  { id: 39, family: "calculator", target: "one_rm_estimator", prompt: "Estimate my 1RM — 140kg for 3 reps on deadlift." },
  { id: 40, family: "calculator", target: "one_rm_estimator", prompt: "What's my bench 1RM if I hit 80kg for 8?" },
  { id: 41, family: "calculator", target: "one_rm_estimator", prompt: "Squat 120kg × 5 reps, what's that project to for a single?" },
  { id: 42, family: "calculator", target: "one_rm_estimator", prompt: "60kg × 10 on overhead press — predicted 1RM?" },

  // calculator.tdee_calculator — 4 slots
  { id: 43, family: "calculator", target: "tdee_calculator", prompt: "TDEE for 78kg male, 178cm, 30y, moderate activity?" },
  { id: 44, family: "calculator", target: "tdee_calculator", prompt: "What's my maintenance if I'm 65kg, 168cm, 28y, light activity?" },
  { id: 45, family: "calculator", target: "tdee_calculator", prompt: "Maintenance calories: 90kg male, 183cm, 35y, very active?" },
  { id: 46, family: "calculator", target: "tdee_calculator", prompt: "TDEE quick check — 70kg female, 170cm, 25y, moderate." },

  // training.periodization_ladder — 3 slots
  { id: 47, family: "training", target: "periodization_ladder", prompt: "Plan a 16-week periodized strength block." },
  { id: 48, family: "training", target: "periodization_ladder", prompt: "Map out accumulation, intensification, realization for 12 weeks." },
  { id: 49, family: "training", target: "periodization_ladder", prompt: "Periodization plan toward a meet in 20 weeks." },

  // progress.pr_timeline — 3 slots
  { id: 50, family: "progress", target: "pr_timeline", prompt: "My deadlift: 140kg in Jan, 145 in Feb, 150 in Mar, 152.5 in Apr — how's progress?" },
  { id: 51, family: "progress", target: "pr_timeline", prompt: "Track my bench PRs across 2026: 95kg Jan, 100 Mar, 102.5 Apr." },
  { id: 52, family: "progress", target: "pr_timeline", prompt: "Squat PRs over a year: 130 → 140 → 150 → 160kg, roughly quarterly." },

  // nutrition.meal_macro_stack — 3 slots
  { id: 53, family: "nutrition", target: "meal_macro_stack", prompt: "What do my macros look like across breakfast, lunch, dinner if I eat 2500 kcal?" },
  { id: 54, family: "nutrition", target: "meal_macro_stack", prompt: "Per-meal macro breakdown across my 3 meals today." },
  { id: 55, family: "nutrition", target: "meal_macro_stack", prompt: "Compare the carb load of breakfast vs lunch vs dinner in a 2800 kcal day." },

  // pharma.loading_vs_maintenance — 2 slots
  { id: 56, family: "pharma", target: "loading_vs_maintenance", prompt: "Is creatine loading worth it, or just go straight to maintenance?" },
  { id: 57, family: "pharma", target: "loading_vs_maintenance", prompt: "Compare creatine loading phase to straight 5g/day maintenance." },

  // pharma.half_life_decay — 2 slots
  { id: 58, family: "pharma", target: "half_life_decay", prompt: "I took 200mg caffeine at 2pm — how much is left by bedtime?" },
  { id: 59, family: "pharma", target: "half_life_decay", prompt: "Show how caffeine levels decay over 24 hours after a 150mg dose." },

  // evidence.butterfly_comparison — 2 slots
  { id: 60, family: "evidence", target: "butterfly_comparison", prompt: "Low-bar vs high-bar squat for hypertrophy — what do studies show?" },
  { id: 61, family: "evidence", target: "butterfly_comparison", prompt: "Compare whey vs plant protein across the research." },

  // evidence.evidence_strength_card — 2 slots
  { id: 62, family: "evidence", target: "evidence_strength_card", prompt: "How confident can we be that creatine works?" },
  { id: 63, family: "evidence", target: "evidence_strength_card", prompt: "Evidence strength rating for beta-alanine on endurance." },

  // evidence.effect_size_forest — 2 slots
  { id: 64, family: "evidence", target: "effect_size_forest", prompt: "Show me effect sizes across creatine trials." },
  { id: 65, family: "evidence", target: "effect_size_forest", prompt: "Forest plot of protein supplementation effects on lean mass." },

  // Singletons (1 each × 6 types) — 6 slots
  { id: 66, family: "training",  target: "rep_scheme_grid",            prompt: "What rep schemes hit what goals — hypertrophy vs strength vs power?" },
  { id: 67, family: "progress",  target: "volume_trend",                prompt: "Weekly squat tonnage: 4800, 5200, 5600, 5900 kg — trending up?" },
  { id: 68, family: "training",  target: "volume_intensity_grid",       prompt: "Map my weekly volume × intensity across squat bench deadlift for a block." },
  { id: 69, family: "calculator", target: "protein_target_calculator",  prompt: "How much protein should I eat at 82kg for lean bulking?" },
  { id: 70, family: "pharma",    target: "dose_response_curve",         prompt: "Is there a dose-response for creatine above 5g?" },

  // ─────────────── DARK TEMPLATES (30) — never-fired in prod ───────

  // pharma: 4
  { id: 71, family: "pharma", target: "supplement_stack_schedule", prompt: "I take creatine, caffeine, and protein — when should I take each through the day?" },
  { id: 72, family: "pharma", target: "absorption_multi_protein",  prompt: "How do whey, casein, and soy differ in absorption speed?" },
  { id: 73, family: "pharma", target: "effect_duration_strip",     prompt: "How long does caffeine's ergogenic effect actually last once it kicks in?" },
  { id: 74, family: "pharma", target: "dose_threshold_band",       prompt: "What's the minimum effective dose of caffeine for performance, and where's the ceiling?" },

  // training: 5
  { id: 75, family: "training", target: "mev_mrv_range",               prompt: "How many sets per week is the minimum and maximum for chest hypertrophy?" },
  { id: 76, family: "training", target: "rpe_histogram",               prompt: "My last block's RPEs — I logged 45 sets: mostly 7s and 8s, a few 9s and 10s. Distribution?" },
  { id: 77, family: "training", target: "training_stress_balance",     prompt: "My acute vs chronic training load — am I overreaching?" },
  { id: 78, family: "training", target: "weekly_plan_calendar",        prompt: "Plan my training week: 4 sessions, upper/lower split, with rest days." },
  { id: 79, family: "training", target: "fatigue_readiness_composite", prompt: "Composite readiness check — sleep 6h, HRV low, RPE trending up. Ready to train?" },

  // nutrition: 5
  { id: 80, family: "nutrition", target: "food_nutrient_scatter",   prompt: "Plot calorie density vs protein density for chicken, eggs, Greek yogurt, tuna, tofu, beef." },
  { id: 81, family: "nutrition", target: "hydration_timeline",      prompt: "Hydration schedule across a training day, 80kg athlete." },
  { id: 82, family: "nutrition", target: "micronutrient_radar",     prompt: "How does my micronutrient intake compare to RDA across vitamins A, C, D, E, iron, calcium?" },
  { id: 83, family: "nutrition", target: "calorie_balance_ledger",  prompt: "Daily calorie in/out for a cut: 2200 in, 2600 out, over a week." },
  { id: 84, family: "nutrition", target: "tdee_waterfall",          prompt: "Break my TDEE into BMR, TEF, NEAT, and training components." },

  // evidence: 5
  { id: 85, family: "evidence", target: "forest_plot",            prompt: "Full forest plot of creatine trials with effect sizes and confidence intervals." },
  { id: 86, family: "evidence", target: "study_quality_matrix",   prompt: "Grade the quality of the major creatine RCTs — design, blinding, sample size." },
  { id: 87, family: "evidence", target: "meta_regression_line",   prompt: "How does effect size vary with dose across creatine studies?" },
  { id: 88, family: "evidence", target: "ci_ladder",              prompt: "Rank the effect sizes with CIs for different protein sources on hypertrophy." },
  { id: 89, family: "evidence", target: "citation_timeline",      prompt: "Timeline of the key creatine studies from 1990 to today." },

  // progress: 6
  { id: 90, family: "progress", target: "adherence_calendar_heatmap", prompt: "Calendar heatmap of my training adherence over the last 8 weeks." },
  { id: 91, family: "progress", target: "body_comp_trend",            prompt: "My body comp: 80kg / 20% BF in Jan, 78kg / 18% in Mar, 76kg / 16% now. Progress?" },
  { id: 92, family: "progress", target: "goal_trajectory_dual",       prompt: "I'm targeting 100kg bench by December — I'm at 85kg now. Project me vs target." },
  { id: 93, family: "progress", target: "intervention_slopegraph",    prompt: "Before vs after adding creatine: bench went 80 → 85, squat 100 → 110, deadlift 130 → 140 over 8 weeks." },
  { id: 94, family: "progress", target: "vo2max_trend",               prompt: "My VO2 max across 6 months: 45, 46, 48, 49, 50, 51 ml/kg/min. Trending?" },
  { id: 95, family: "progress", target: "pr_celebration_card",        prompt: "Just hit a new squat PR — 160kg, up from 152.5kg last month!" },

  // calculator: 5
  { id: 96, family: "calculator", target: "macro_calculator",       prompt: "Full macro calculation: 80kg, 15% BF, cutting at 500kcal deficit." },
  { id: 97, family: "calculator", target: "plate_loader_visual",    prompt: "What plates load up to 142.5kg on a 20kg bar?" },
  { id: 98, family: "calculator", target: "rpe_to_percent_rm",      prompt: "RPE 8 for 5 reps — what percent of 1RM is that?" },
  { id: 99, family: "calculator", target: "body_fat_estimator",     prompt: "Estimate body fat: 82kg, 180cm, 34-inch waist, 40-inch chest, 15-inch neck, male." },
  { id: 100, family: "calculator", target: "pace_calculator",       prompt: "I want a 4:30 marathon — what per-km pace is that?" },
];
