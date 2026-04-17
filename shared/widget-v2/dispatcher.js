import React from "react";
import { MacroRing } from "./templates/calculators/macro-ring.js";
import { ProteinDistributionBar } from "./templates/nutrition/protein-distribution-bar.js";
import { MealMacroStack } from "./templates/nutrition/meal-macro-stack.js";
import { PeriodizationLadder } from "./templates/training/periodization-ladder.js";
import { VolumeIntensityGrid } from "./templates/training/volume-intensity-grid.js";

const h = React.createElement;

// Family → { type → component } routing table. Populated by Plan 2-7 as
// each family's templates are added.
const REGISTRY = {
  calculator: {
    macro_ring: MacroRing,
    // Plan 7: one_rm_estimator, tdee_calculator, macro_calculator,
    // plate_loader_visual, rpe_to_percent_rm, body_fat_estimator,
    // carb_cycling_calculator, protein_target_calculator, pace_calculator
  },
  nutrition: {
    protein_distribution_bar: ProteinDistributionBar,
    meal_macro_stack: MealMacroStack,
  },
  training: {
    periodization_ladder: PeriodizationLadder,
    volume_intensity_grid: VolumeIntensityGrid,
  },
  pharma:    {},  // Plan 2
  evidence:  {},  // Plan 5
  progress:  {},  // Plan 6
};

function Diagnostic({ reason, family, type }) {
  return h(
    "div",
    { className: "wv-card wv-wide wv-diagnostic", role: "alert" },
    h("div", { className: "wv-diagnostic-head" }, `Widget render error`),
    h("div", { className: "wv-diagnostic-body" }, `${reason}: family=${family || "?"} type=${type || "?"}`),
  );
}

export function WidgetV2({ family, payload }) {
  const familyMap = REGISTRY[family];
  if (!familyMap) return h(Diagnostic, { reason: "unsupported family", family, type: payload?.type });
  const Component = familyMap[payload?.type];
  if (!Component) return h(Diagnostic, { reason: "unknown type", family, type: payload?.type });
  return h(Component, payload);
}
