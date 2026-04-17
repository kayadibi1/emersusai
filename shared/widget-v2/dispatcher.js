import React from "react";
import { MacroRing } from "./templates/calculators/macro-ring.js";
import { TDEECalculator } from "./templates/calculators/tdee-calculator.js";
import { OneRMEstimator } from "./templates/calculators/one-rm-estimator.js";
import { ProteinDistributionBar } from "./templates/nutrition/protein-distribution-bar.js";
import { MealMacroStack } from "./templates/nutrition/meal-macro-stack.js";
import { PeriodizationLadder } from "./templates/training/periodization-ladder.js";
import { VolumeIntensityGrid } from "./templates/training/volume-intensity-grid.js";
import { MevMrvRange } from "./templates/training/mev-mrv-range.js";
import { RpeHistogram } from "./templates/training/rpe-histogram.js";
import { RepSchemeGrid } from "./templates/training/rep-scheme-grid.js";
import { TrainingStressBalance } from "./templates/training/training-stress-balance.js";
import { FatigueReadinessComposite } from "./templates/training/fatigue-readiness-composite.js";
import { WeeklyPlanCalendar } from "./templates/training/weekly-plan-calendar.js";
import { DeloadProtocol } from "./templates/training/deload-protocol.js";
import { PRTimeline } from "./templates/progress/pr-timeline.js";
import { VolumeTrend } from "./templates/progress/volume-trend.js";
import { DoseResponseCurve } from "./templates/pharma/dose-response-curve.js";
import { HalfLifeDecay } from "./templates/pharma/half-life-decay.js";
import { SupplementStackSchedule } from "./templates/pharma/supplement-stack-schedule.js";
import { LoadingVsMaintenance } from "./templates/pharma/loading-vs-maintenance.js";
import { AbsorptionMultiProtein } from "./templates/pharma/absorption-multi-protein.js";
import { EffectDurationStrip } from "./templates/pharma/effect-duration-strip.js";
import { DoseThresholdBand } from "./templates/pharma/dose-threshold-band.js";
import { StudyMatrix } from "./templates/evidence/study-matrix.js";
import { EffectSizeForest } from "./templates/evidence/effect-size-forest.js";

const h = React.createElement;

// Family → { type → component } routing table. Populated by Plan 2-7 as
// each family's templates are added.
const REGISTRY = {
  calculator: {
    macro_ring: MacroRing,
    tdee_calculator: TDEECalculator,
    one_rm_estimator: OneRMEstimator,
    // Plan 7 remaining: macro_calculator, plate_loader_visual,
    // rpe_to_percent_rm, body_fat_estimator, carb_cycling_calculator,
    // protein_target_calculator, pace_calculator
  },
  nutrition: {
    protein_distribution_bar: ProteinDistributionBar,
    meal_macro_stack: MealMacroStack,
  },
  training: {
    periodization_ladder: PeriodizationLadder,
    volume_intensity_grid: VolumeIntensityGrid,
    mev_mrv_range: MevMrvRange,
    rpe_histogram: RpeHistogram,
    rep_scheme_grid: RepSchemeGrid,
    training_stress_balance: TrainingStressBalance,
    fatigue_readiness_composite: FatigueReadinessComposite,
    weekly_plan_calendar: WeeklyPlanCalendar,
    deload_protocol: DeloadProtocol,
  },
  progress: {
    pr_timeline: PRTimeline,
    volume_trend: VolumeTrend,
  },
  pharma: {
    dose_response_curve: DoseResponseCurve,
    half_life_decay: HalfLifeDecay,
    supplement_stack_schedule: SupplementStackSchedule,
    loading_vs_maintenance: LoadingVsMaintenance,
    absorption_multi_protein: AbsorptionMultiProtein,
    effect_duration_strip: EffectDurationStrip,
    dose_threshold_band: DoseThresholdBand,
  },
  evidence: {
    study_matrix: StudyMatrix,
    effect_size_forest: EffectSizeForest,
  },
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
