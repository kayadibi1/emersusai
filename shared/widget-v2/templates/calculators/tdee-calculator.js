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

// Readonly TDEE card. The model calculates server-side and sends BMR + TDEE;
// this surfaces them with enough context that a user knows what to edit in
// prose (e.g. "actually I'm more active than moderate").

export function TDEECalculator({ title, display_width, summary, follow_up_chips, data }) {
  const { weight_kg, height_cm, age, sex, activity_level, bmr, tdee } = data;
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
        h(StatCard, { caption: "BMR", value: Math.round(bmr), unit: "kcal" }),
        h(StatCard, { caption: "TDEE", value: Math.round(tdee), unit: "kcal" }),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
