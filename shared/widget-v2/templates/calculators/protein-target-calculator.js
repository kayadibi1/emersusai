import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";
import { StatCard } from "../../primitives/stat-card.js";

const h = React.createElement;

// Leucine threshold for MPS activation: ~2.5g (≈ 20-25g whole protein for
// most mixed-source diets). Used only when the model doesn't supply.
const DEFAULT_LEUCINE_THRESHOLD_G = 25;

// Renderer computes per_meal_g from total_g / meal_count, and defaults the
// leucine threshold — closes the "model invents leucine threshold" drift
// flagged in the 2026-04-23 diagnostic.
export function ProteinTargetCalculator({ title, display_width, summary, follow_up_chips, data }) {
  const { body_weight_kg, meal_count, total_g } = data;
  const leucine = data.leucine_threshold_g || DEFAULT_LEUCINE_THRESHOLD_G;
  const perMeal = meal_count > 0 ? total_g / meal_count : 0;
  const meetsThreshold = perMeal >= leucine;

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-ptc-inputs" },
      h("span", null, `${body_weight_kg} kg BW`),
      h("span", null, `${meal_count} meals`),
      h("span", null, `leucine threshold ${leucine}g`),
    ),
    h("div", { className: "wv-ptc-stats" },
      h(StatCard, { caption: "Total daily", value: Math.round(total_g), unit: "g" }),
      h(StatCard, { caption: "Per meal", value: Math.round(perMeal), unit: "g" }),
    ),
    h("div", { className: `wv-ptc-check ${meetsThreshold ? "pass" : "fail"}` },
      meetsThreshold
        ? `✓ ${perMeal.toFixed(0)}g per meal clears the ${leucine}g threshold`
        : `⚠ ${perMeal.toFixed(0)}g per meal is below the ${leucine}g threshold — consider fewer, larger meals`,
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
