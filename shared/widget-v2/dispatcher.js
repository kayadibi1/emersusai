import React from "react";
import { MacroRing } from "./templates/calculators/macro-ring.js";
import { TDEECalculator } from "./templates/calculators/tdee-calculator.js";
import { OneRMEstimator } from "./templates/calculators/one-rm-estimator.js";
import { MacroCalculator } from "./templates/calculators/macro-calculator.js";
import { PlateLoaderVisual } from "./templates/calculators/plate-loader-visual.js";
import { RpeToPercentRM } from "./templates/calculators/rpe-to-percent-rm.js";
import { BodyFatEstimator } from "./templates/calculators/body-fat-estimator.js";
import { CarbCyclingCalculator } from "./templates/calculators/carb-cycling-calculator.js";
import { ProteinTargetCalculator } from "./templates/calculators/protein-target-calculator.js";
import { PaceCalculator } from "./templates/calculators/pace-calculator.js";
import { ProteinDistributionBar } from "./templates/nutrition/protein-distribution-bar.js";
import { MealMacroStack } from "./templates/nutrition/meal-macro-stack.js";
import { FoodNutrientScatter } from "./templates/nutrition/food-nutrient-scatter.js";
import { HydrationTimeline } from "./templates/nutrition/hydration-timeline.js";
import { MicronutrientRadar } from "./templates/nutrition/micronutrient-radar.js";
import { CalorieBalanceLedger } from "./templates/nutrition/calorie-balance-ledger.js";
import { MealTimingStrip } from "./templates/nutrition/meal-timing-strip.js";
import { TdeeWaterfall } from "./templates/nutrition/tdee-waterfall.js";
import { MacroRingNutrition } from "./templates/nutrition/macro-ring-nutrition.js";
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
import { LiftProgressGrid } from "./templates/progress/lift-progress-grid.js";
import { WeeklyVolumeTrendProgress } from "./templates/progress/weekly-volume-trend.js";
import { AdherenceCalendarHeatmap } from "./templates/progress/adherence-calendar-heatmap.js";
import { BodyCompTrend } from "./templates/progress/body-comp-trend.js";
import { GoalTrajectoryDual } from "./templates/progress/goal-trajectory-dual.js";
import { InterventionSlopegraph } from "./templates/progress/intervention-slopegraph.js";
import { SessionConsistencyStrip } from "./templates/progress/session-consistency-strip.js";
import { Vo2maxTrend } from "./templates/progress/vo2max-trend.js";
import { SleepConsistencyBars } from "./templates/progress/sleep-consistency-bars.js";
import { PrCelebrationCard } from "./templates/progress/pr-celebration-card.js";
import { StreakCounterCard } from "./templates/progress/streak-counter-card.js";
import { DoseResponseCurve } from "./templates/pharma/dose-response-curve.js";
import { HalfLifeDecay } from "./templates/pharma/half-life-decay.js";
import { SupplementStackSchedule } from "./templates/pharma/supplement-stack-schedule.js";
import { LoadingVsMaintenance } from "./templates/pharma/loading-vs-maintenance.js";
import { AbsorptionMultiProtein } from "./templates/pharma/absorption-multi-protein.js";
import { EffectDurationStrip } from "./templates/pharma/effect-duration-strip.js";
import { DoseThresholdBand } from "./templates/pharma/dose-threshold-band.js";
import { StudyMatrix } from "./templates/evidence/study-matrix.js";
import { EffectSizeForest } from "./templates/evidence/effect-size-forest.js";
import { ForestPlot } from "./templates/evidence/forest-plot.js";
import { EvidenceStrengthCard } from "./templates/evidence/evidence-strength-card.js";
import { ButterflyComparison } from "./templates/evidence/butterfly-comparison.js";
import { StudyQualityMatrix } from "./templates/evidence/study-quality-matrix.js";
import { MetaRegressionLine } from "./templates/evidence/meta-regression-line.js";
import { CiLadder } from "./templates/evidence/ci-ladder.js";
import { CitationTimeline } from "./templates/evidence/citation-timeline.js";
import { StudyBeeswarm } from "./templates/evidence/study-beeswarm.js";

const h = React.createElement;

// Family → { type → component } routing table. Populated by Plan 2-7 as
// each family's templates are added.
const REGISTRY = {
  calculator: {
    macro_ring: MacroRing,
    tdee_calculator: TDEECalculator,
    one_rm_estimator: OneRMEstimator,
    macro_calculator: MacroCalculator,
    plate_loader_visual: PlateLoaderVisual,
    rpe_to_percent_rm: RpeToPercentRM,
    body_fat_estimator: BodyFatEstimator,
    carb_cycling_calculator: CarbCyclingCalculator,
    protein_target_calculator: ProteinTargetCalculator,
    pace_calculator: PaceCalculator,
  },
  nutrition: {
    protein_distribution_bar: ProteinDistributionBar,
    meal_macro_stack: MealMacroStack,
    food_nutrient_scatter: FoodNutrientScatter,
    hydration_timeline: HydrationTimeline,
    micronutrient_radar: MicronutrientRadar,
    calorie_balance_ledger: CalorieBalanceLedger,
    meal_timing_strip: MealTimingStrip,
    tdee_waterfall: TdeeWaterfall,
    macro_ring_nutrition: MacroRingNutrition,
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
    pr_progression_line: PRTimeline,
    volume_trend: VolumeTrend,
    lift_progress_grid: LiftProgressGrid,
    weekly_volume_trend: WeeklyVolumeTrendProgress,
    adherence_calendar_heatmap: AdherenceCalendarHeatmap,
    body_comp_trend: BodyCompTrend,
    goal_trajectory_dual: GoalTrajectoryDual,
    intervention_slopegraph: InterventionSlopegraph,
    session_consistency_strip: SessionConsistencyStrip,
    vo2max_trend: Vo2maxTrend,
    sleep_consistency_bars: SleepConsistencyBars,
    pr_celebration_card: PrCelebrationCard,
    streak_counter_card: StreakCounterCard,
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
    forest_plot: ForestPlot,
    evidence_strength_card: EvidenceStrengthCard,
    butterfly_comparison: ButterflyComparison,
    study_quality_matrix: StudyQualityMatrix,
    meta_regression_line: MetaRegressionLine,
    ci_ladder: CiLadder,
    citation_timeline: CitationTimeline,
    study_beeswarm: StudyBeeswarm,
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

// Error boundary so a single throwing template renders a Diagnostic fallback
// instead of crashing the whole chat tree.
class WidgetErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    if (typeof console !== "undefined" && console.error) {
      console.error("[widget-v2] template threw:", error);
    }
  }
  render() {
    if (this.state.error) {
      return h(Diagnostic, {
        reason: `render threw: ${this.state.error?.message || String(this.state.error)}`,
        family: this.props.family,
        type: this.props.type,
      });
    }
    return this.props.children;
  }
}

export function WidgetV2({ family, payload }) {
  const familyMap = REGISTRY[family];
  if (!familyMap) return h(Diagnostic, { reason: "unsupported family", family, type: payload?.type });
  const Component = familyMap[payload?.type];
  if (!Component) return h(Diagnostic, { reason: "unknown type", family, type: payload?.type });
  return h(
    WidgetErrorBoundary,
    { family, type: payload?.type },
    h(Component, payload),
  );
}
