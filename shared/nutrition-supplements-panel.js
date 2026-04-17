// shared/nutrition-supplements-panel.js
//
// Focused supplements view. Shows today's stack (prescribed from the active
// plan, grouped by timing), lets the user check off each for one-tap logging,
// and exposes an "Add supplement" search.

import React from "react";
import { localDateStr } from "./date-utils.js";
import { resolveDayType } from "./meal-plan-day-type.js";
import { createClient } from "@supabase/supabase-js";
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

const TIMING_ORDER = ["morning", "with_meal", "pre_workout", "post_workout", "bedtime", "any"];

export default function NutritionSupplementsPanel({ onOpenFoodDetail }) {
  const [mealPlan, setMealPlan] = useState(null);
  const [workoutPlan, setWorkoutPlan] = useState(null);
  const [todayLogged, setTodayLogged] = useState([]);
  const [loading, setLoading] = useState(true);
  const todayStr = localDateStr();

  async function load() {
    setLoading(true);
    try {
      const sb = window.EMERSUS_SUPABASE ?? createClient(window.EMERSUS_SUPABASE_URL, window.EMERSUS_ANON_KEY);
      if (!window.EMERSUS_SUPABASE) window.EMERSUS_SUPABASE = sb;

      const [mpRes, dayRes, { data: wp }] = await Promise.all([
        authFetch("/api/emersus/meal-plans/active"),
        authFetch(`/api/emersus/meal-journal/day?date=${todayStr}`),
        sb.from("workout_plans")
          .select("id, plan")
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const mp = mpRes.ok ? await mpRes.json() : { meal_plan: null };
      const day = dayRes.ok ? await dayRes.json() : { entries: [] };
      setMealPlan(mp.meal_plan);
      setWorkoutPlan(wp);
      setTodayLogged((day.entries ?? []).filter(e => e.food?.kind === "supplement"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return h("div", { className: "supps-loading" }, "Loading...");

  const prescribed = [];
  if (mealPlan?.plan?.day_types) {
    const todaySlug = resolveDayType({
      date: todayStr,
      mealPlan: mealPlan.plan,
      workoutPlan: workoutPlan?.plan,
    });
    const dt = mealPlan.plan.day_types.find(d => d.slug === todaySlug)
            ?? mealPlan.plan.day_types[0];
    if (dt?.supplements) prescribed.push(...dt.supplements);
  }

  const groups = {};
  for (const s of prescribed) {
    const t = s.timing ?? "any";
    groups[t] = groups[t] ?? [];
    groups[t].push(s);
  }

  async function logSupplement(supp) {
    // Find the food_id via foods_search
    const sr = await authFetch(`/api/emersus/foods/search?q=${encodeURIComponent(supp.description)}&kind=supplement&limit=1`);
    if (!sr.ok) return;
    const { results } = await sr.json();
    if (!results || results.length === 0) {
      alert("Couldn't find matching supplement in catalog. Add it via Log supplement.");
      return;
    }
    const food = results[0];
    const amountUnit = food.base_unit === "100g" ? "g" : "serving";
    const amount = food.base_unit === "100g" ? supp.amount : 1;
    const now = new Date();
    const mealSlot = now.getHours() < 14 ? "supplements_am" : "supplements_pm";

    const res = await authFetch("/api/emersus/meal-journal/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: [{
          food_id: food.id,
          logged_date: todayStr,
          meal_slot: mealSlot,
          amount,
          amount_unit: amountUnit,
          source: "plan_check_off",
          plan_id: mealPlan.id,
        }],
      }),
    });
    if (res.ok) await load();
  }

  return h("div", { className: "supps-panel" }, [
    h("h2", { key: "h" }, "Supplements"),
    !mealPlan && h("div", { key: "no", className: "empty" },
      "No active meal plan. Supplements in plans appear here for one-tap logging."),
    TIMING_ORDER.map(timing => {
      const list = groups[timing];
      if (!list || list.length === 0) return null;
      return h("div", { key: timing, className: "supps-group" }, [
        h("h3", { key: "h" }, timing.replace(/_/g, " ")),
        h("ul", { key: "l" },
          list.map((s, i) => {
            const alreadyLogged = todayLogged.some(e =>
              e.food?.description?.toLowerCase() === s.description.toLowerCase()
            );
            return h("li", {
              key: i,
              className: alreadyLogged ? "logged" : "",
            }, [
              h("span", { className: "desc", key: "d" },
                `${s.description} - ${s.amount} ${s.unit}`),
              alreadyLogged
                ? h("span", { key: "c", className: "check" }, "Logged")
                : h("button", { key: "b", onClick: () => logSupplement(s) }, "Log"),
            ]);
          })
        ),
      ]);
    }),
  ]);
}
