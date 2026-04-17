import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";
import { StatCard } from "../../primitives/stat-card.js";

const h = React.createElement;

// Body-weight-based protein target with meal breakdown + leucine threshold
// check per meal.

export function ProteinTargetCalculator({ title, display_width, summary, follow_up_chips, data }) {
  const { body_weight_kg, meal_count, total_g, per_meal_g, leucine_threshold_g } = data;
  const meetsThreshold = per_meal_g >= leucine_threshold_g;

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-ptc-inputs" },
      h("span", null, `${body_weight_kg} kg BW`),
      h("span", null, `${meal_count} meals`),
      h("span", null, `leucine threshold ${leucine_threshold_g}g`),
    ),
    h("div", { className: "wv-ptc-stats" },
      h(StatCard, { caption: "Total daily", value: Math.round(total_g), unit: "g" }),
      h(StatCard, { caption: "Per meal", value: Math.round(per_meal_g), unit: "g" }),
    ),
    h("div", { className: `wv-ptc-check ${meetsThreshold ? "pass" : "fail"}` },
      meetsThreshold
        ? `✓ ${per_meal_g.toFixed(0)}g per meal clears the ${leucine_threshold_g}g threshold`
        : `⚠ ${per_meal_g.toFixed(0)}g per meal is below the ${leucine_threshold_g}g threshold — consider fewer, larger meals`,
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
