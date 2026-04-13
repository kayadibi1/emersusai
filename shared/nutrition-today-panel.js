// shared/nutrition-today-panel.js
//
// Today tab composition. Top-level layout for the default view on /app/nutrition/.
// Shows quick actions, 5-macro rings, today's meal timeline, supplements card,
// and a micronutrient snapshot pill.

import React from "react";
import { createClient } from "@supabase/supabase-js";
import { MacroRing, MACRO_COLORS, StreakBanner } from "./nutrition-charts.js";
import { resolveDayType } from "./meal-plan-day-type.js";
import { localDateStr } from "./date-utils.js";

const { useEffect, useState } = React;
const h = React.createElement;

function authFetch(path, init = {}) {
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(window.EMERSUS_AUTH ? { Authorization: `Bearer ${window.EMERSUS_AUTH}` } : {}),
    },
  });
}

export default function NutritionTodayPanel({
  onOpenFoodDetail,
  onOpenLogModal,
  onNavigateJournal,
  onNavigatePlan,
}) {
  const [today, setToday] = useState(null);
  const [streak, setStreak] = useState({ current: 0, best: 0 });
  const [mealPlan, setMealPlan] = useState(null);
  const [workoutPlan, setWorkoutPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  const todayStr = localDateStr();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Parallel fetches
        const [dashRes, streakRes, planRes] = await Promise.all([
          authFetch(`/api/emersus/rpc/get_nutrition_dashboard?p_date=${todayStr}`),
          authFetch(`/api/emersus/rpc/get_macro_hit_streak`),
          authFetch(`/api/emersus/meal-plans/active`),
        ]);

        // Fetch workout plan directly from Supabase per A3
        const sb = window.EMERSUS_SUPABASE ?? createClient(window.EMERSUS_SUPABASE_URL, window.EMERSUS_ANON_KEY);
        if (!window.EMERSUS_SUPABASE) window.EMERSUS_SUPABASE = sb;
        const { data: workoutPlanData } = await sb
          .from("workout_plans")
          .select("id, title, plan, previous_plan, archived_at")
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cancelled) return;
        const [dashJson, streakJson, planJson] = await Promise.all([
          dashRes.ok ? dashRes.json() : { error: true },
          streakRes.ok ? streakRes.json() : { current: 0, best: 0 },
          planRes.ok ? planRes.json() : { meal_plan: null },
        ]);
        if (cancelled) return;
        setToday(dashJson.error ? null : dashJson);
        setStreak(streakJson);
        setMealPlan(planJson.meal_plan);
        setWorkoutPlan(workoutPlanData);
      } catch (err) {
        console.error("[today-panel] load failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [todayStr]);

  if (loading) return h("div", { className: "today-loading" }, "Loading todayâ€¦");

  const dayType = mealPlan
    ? resolveDayType({ date: todayStr, mealPlan: mealPlan.plan, workoutPlan: workoutPlan?.plan })
    : "rest_day";

  const targets = mealPlan?.plan?.targets?.[dayType] ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  const actuals = today?.actuals ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };

  return h("div", { className: "today-panel" }, [
    h("div", { className: "quick-actions", key: "qa" }, [
      h("button", { key: "log", className: "primary", onClick: () => onOpenLogModal?.("food") }, "Log food"),
      h("button", { key: "supp", onClick: () => onOpenLogModal?.("supplement") }, "Log supplement"),
      h("button", { key: "copy", onClick: () => onNavigateJournal?.() }, "Open journal"),
      mealPlan && h("button", { key: "plan", onClick: () => onNavigatePlan?.() }, "View plan"),
    ]),

    h("div", { className: "day-type-badge", key: "dtb" }, dayType.replace(/_/g, " ")),

    h("div", { className: "macro-rings", key: "rings" }, [
      h(MacroRing, { key: "k", actual: actuals.kcal,      target: targets.kcal,      label: "kcal",    color: MACRO_COLORS.kcal }),
      h(MacroRing, { key: "p", actual: actuals.protein_g, target: targets.protein_g, label: "protein", color: MACRO_COLORS.protein }),
      h(MacroRing, { key: "c", actual: actuals.carbs_g,   target: targets.carbs_g,   label: "carbs",   color: MACRO_COLORS.carbs }),
      h(MacroRing, { key: "f", actual: actuals.fat_g,     target: targets.fat_g,     label: "fat",     color: MACRO_COLORS.fat }),
      h(MacroRing, { key: "fi", actual: actuals.fiber_g,  target: targets.fiber_g,   label: "fiber",   color: MACRO_COLORS.fiber }),
    ]),

    h(StreakBanner, { key: "streak", current: streak.current, best: streak.best }),

    h("div", { className: "meal-timeline", key: "timeline" }, [
      h("h3", { key: "h" }, "Today"),
      (today?.meal_breakdown ?? []).map(meal =>
        h("div", { key: meal.meal_slot, className: "meal-slot-card" }, [
          h("div", { className: "meal-slot-header", key: "h" }, [
            h("span", { className: "slot-name", key: "n" }, meal.meal_slot.replace(/_/g, " ")),
            h("span", { className: "slot-kcal", key: "k" }, `${Math.round(meal.kcal ?? 0)} kcal`),
          ]),
          h("ul", { className: "entries", key: "e" },
            (meal.entries ?? []).map((e, i) =>
              h("li", { key: i, onClick: () => onOpenFoodDetail?.(e.food_id) },
                `${e.food_description} â€” ${e.amount} ${e.amount_unit}`
              )
            )
          ),
        ])
      ),
      (today?.meal_breakdown ?? []).length === 0 &&
        h("div", { className: "empty", key: "empty" }, "Nothing logged today yet."),
    ]),
  ]);
}
