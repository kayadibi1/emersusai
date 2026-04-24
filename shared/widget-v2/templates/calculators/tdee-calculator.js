import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";
import { StatCard } from "../../primitives/stat-card.js";

const h = React.createElement;

const ACTIVITY_LABEL = {
  sedentary: "Sedentary (1.2×)",
  light: "Light (1.375×)",
  moderate: "Moderate (1.55×)",
  active: "Active (1.725×)",
  very_active: "Very active (1.9×)",
};
const ACTIVITY_MULT = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
};

// Mifflin-St Jeor (1990) — the standard clinical BMR formula. Renderer-
// computed so model-authored math drift (flagged in the 2026-04-23 diagnostic:
// widgets labeled "Mifflin-St Jeor" showed off-by-15-kcal values) can't reach
// the user. Model supplies only the atomic inputs.
function mifflinStJeor({ weight_kg, height_cm, age, sex }) {
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  return sex === "female" ? base - 161 : base + 5;
}

export function TDEECalculator({ title, display_width, summary, follow_up_chips, data }) {
  const { weight_kg, height_cm, age, sex, activity_level } = data;
  const bmr = Math.round(mifflinStJeor({ weight_kg, height_cm, age, sex }));
  const tdee = Math.round(bmr * (ACTIVITY_MULT[activity_level] || 1.55));
  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-tdee-body" },
      h(
        "div",
        { className: "wv-tdee-inputs" },
        h("span", null, `${weight_kg} kg`),
        h("span", null, `${height_cm} cm`),
        h("span", null, `${age} yr`),
        h("span", { className: "wv-tdee-capitalize" }, sex),
        h("span", null, ACTIVITY_LABEL[activity_level] || activity_level),
      ),
      h(
        "div",
        { className: "wv-tdee-stats" },
        h(StatCard, { caption: "BMR", value: bmr, unit: "kcal" }),
        h(StatCard, { caption: "TDEE", value: tdee, unit: "kcal" }),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
