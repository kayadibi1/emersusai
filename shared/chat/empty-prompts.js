// shared/chat/empty-prompts.js — anchored prompt chips for empty chat threads.
//
// Renders 6 chips drawn from a ~100-prompt local pool. Picks 6 random prompts
// on mount, rotates every ROTATE_MS to 6 new ones (no overlap with the
// previous set — each rotation is a full refresh). Evidence-based brand voice
// across training, nutrition, supplements, recovery, cardio/metabolic, and
// hormones. Click fills the composer; no auto-send.

import React from "react";

const { useEffect, useState } = React;
const h = React.createElement;

const ROTATE_MS = 5000;
const VISIBLE = 6;

const PROMPT_POOL = [
  // Training
  "How much protein do I need per day?",
  "Build me a push day",
  "Best Zone 2 cardio protocol",
  "How to deload properly",
  "Optimal rep range for hypertrophy",
  "Training split for fat loss",
  "How often should I train each muscle?",
  "Compound vs isolation exercises",
  "When to switch programs",
  "Beginner full-body routine",
  "Is pre-exhaustion worth it?",
  "Drop sets vs straight sets",
  "How long should rest periods be?",
  "Periodization for natural lifters",
  "Push-pull-legs vs upper-lower",
  "Is training to failure necessary?",
  "Best volume for muscle growth",
  "Tempo training for strength",
  "Progressive overload strategies",
  "How to break a strength plateau",
  "Warm-up routine for heavy lifts",
  "Accessory lifts that matter most",
  "Training around an injury",
  "How to assess recovery",
  "Minimum effective dose of training",

  // Nutrition
  "Calorie deficit size for cutting",
  "Carbs for endurance athletes",
  "Protein timing for muscle gain",
  "Fiber intake for athletes",
  "Pre-workout meal timing",
  "Post-workout nutrition window",
  "Intermittent fasting benefits",
  "Creatine loading vs maintenance",
  "Caffeine dosing for workouts",
  "Electrolytes during endurance",
  "Fat loss vs muscle retention",
  "Refeeds in a cut",
  "Bulk vs recomp strategy",
  "Carb cycling effectiveness",
  "Protein quality sources",
  "Does meal frequency matter?",
  "Hydration strategies that work",
  "Sugar and athletic performance",
  "Low-carb for lifting",
  "Vegan protein combinations",
  "Leucine threshold per meal",
  "Insulin sensitivity and food",
  "Pre-bed protein meal",
  "Nutrition for hybrid athletes",
  "Plan a cutting day",

  // Supplements
  "Is creatine worth taking?",
  "Best time to take creatine",
  "Fish oil dosage for inflammation",
  "Vitamin D for athletes",
  "Magnesium for sleep",
  "Ashwagandha and testosterone",
  "Beta-alanine effectiveness",
  "Citrulline vs arginine",
  "Whey vs casein protein",
  "Collagen for joints",
  "Omega-3 EPA vs DHA",
  "Is a multivitamin necessary?",
  "Managing caffeine tolerance",
  "What's in a good pre-workout?",
  "Tongkat ali evidence",

  // Recovery
  "Sleep duration for muscle growth",
  "Ice bath benefits and risks",
  "Sauna for recovery",
  "Active vs passive recovery",
  "When to stretch",
  "Foam rolling evidence",
  "Massage for soreness",
  "Optimal sleep position",
  "HRV for training decisions",
  "Overtraining symptoms",
  "Deload frequency",
  "REM sleep importance",
  "Blue light and sleep",
  "Sleep extension benefits",
  "CBD for recovery",

  // Cardio + metabolic
  "Zone 2 heart rate calculation",
  "HIIT vs steady state",
  "Fasted cardio for fat loss",
  "Running form basics",
  "VO2 max training",
  "Lower blood pressure with training",
  "Resting heart rate targets",
  "Metabolic flexibility",
  "Reversing insulin resistance",
  "Lactate threshold testing",
  "Exercise for diabetes prevention",
  "Lower cholesterol with training",
  "Balancing hybrid training",
  "Heart rate recovery time",
  "Mitochondrial density training",

  // Hormones / health
  "Natural testosterone optimization",
  "Cortisol and training",
  "Thyroid and metabolism",
  "Training around the cycle",
  "Menopause and muscle loss",
  "Managing inflammation naturally",
  "Longevity training protocols",
  "Cognition and exercise",
  "Gut health for athletes",
  "Sleep apnea and performance",
];

function pickRandom(pool, count, excludeSet) {
  const exclude = excludeSet instanceof Set ? excludeSet : new Set(excludeSet || []);
  const available = pool.filter((p) => !exclude.has(p));
  // Fisher-Yates shuffle (partial — we only need `count` items).
  const arr = available.slice();
  for (let i = 0; i < Math.min(count, arr.length); i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

function toChips(strings) {
  return strings.map((s) => ({ id: s, label: s, prompt: s }));
}

export function EmptyPrompts({ onPick }) {
  // Seed with a fresh random draw on every mount so reloads look different.
  const [prompts, setPrompts] = useState(() => toChips(pickRandom(PROMPT_POOL, VISIBLE)));

  useEffect(() => {
    const id = setInterval(() => {
      setPrompts((current) => {
        const exclude = new Set(current.map((c) => c.prompt));
        return toChips(pickRandom(PROMPT_POOL, VISIBLE, exclude));
      });
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  // key changes with each rotation so the chip row cross-fades via CSS.
  const rotationKey = prompts.map((p) => p.id).join("|");

  return h(
    "div",
    { className: "empty-prompts", "aria-label": "Try one of these prompts" },
    h("span", { className: "empty-prompts-label" }, "Try one of these"),
    h(
      "div",
      { className: "empty-prompts-row", key: rotationKey },
      prompts.map((prompt, idx) =>
        h(
          "button",
          {
            key: prompt.id,
            type: "button",
            className: "empty-prompt-chip",
            "data-prompt": prompt.prompt,
            "data-chip-idx": idx,
            onClick: () => onPick?.(prompt.prompt),
            onKeyDown: (e) => {
              const row = e.currentTarget.parentElement;
              const chips = row ? Array.from(row.querySelectorAll("[data-chip-idx]")) : [];
              const cur = chips.indexOf(e.currentTarget);
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                chips[(cur + 1) % chips.length]?.focus();
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                chips[(cur - 1 + chips.length) % chips.length]?.focus();
              } else if (e.key === "Home") {
                e.preventDefault();
                chips[0]?.focus();
              } else if (e.key === "End") {
                e.preventDefault();
                chips[chips.length - 1]?.focus();
              }
            },
          },
          prompt.label,
        ),
      ),
    ),
  );
}

export default EmptyPrompts;
