// app/progress/nutrition-pane.js
//
// Nutrition analytics pane for /app/progress/#nutrition. Reads the
// analytics RPCs from Task 21 and composes the charts from
// shared/nutrition-charts.js.

import React from "react";
import { localDateStr, localDateOffset } from "/shared/date-utils.js";
import {
  WeeklyMacroBars,
  MicronutrientCard,
  StreakBanner,
} from "/shared/nutrition-charts.js";

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

async function jsonOrThrow(response, fallbackMessage) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || fallbackMessage);
  }
  return payload;
}

const RANGES = [
  { id: "4w",  label: "4W",  days: 28 },
  { id: "8w",  label: "8W",  days: 56 },
  { id: "12w", label: "12W", days: 84 },
  { id: "all", label: "All", days: 365 },
];

function rpc(name, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) qs.set(k, v);
  return authFetch(`/api/emersus/rpc/${name}?${qs.toString()}`);
}

export default function NutritionPane() {
  const [range, setRange] = useState("4w");
  const [state, setState] = useState({ loading: true, error: null });
  const [data, setData] = useState({
    weekly: [],
    streak: { current: 0, best: 0 },
    adherence: null,
    topFoods: [],
    micros: [],
    activePlanId: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ loading: true, error: null });
      try {
        const days = RANGES.find(r => r.id === range)?.days ?? 28;
        const end = localDateStr();
        const start = localDateOffset(-days);

        // Load the active plan id for adherence
        const planRes = await authFetch("/api/emersus/meal-plans/active");
        const activePlan = await jsonOrThrow(planRes, "Failed to load active meal plan.");
        const activePlanId = activePlan?.meal_plan?.id ?? null;

        // Parallel fan-out
        const [weeklyRes, streakRes, topRes, adherenceRes, microRes] = await Promise.all([
          rpc("get_weekly_macro_averages", { p_range_start: start, p_range_end: end }),
          rpc("get_macro_hit_streak", {}),
          rpc("get_top_foods", { p_range_start: start, p_range_end: end, p_limit: 10 }),
          activePlanId ? rpc("get_plan_adherence", { p_plan_id: activePlanId, p_range_start: start, p_range_end: end }) : null,
          rpc("get_micronutrient_status", { p_date: end }),
        ]);

        if (cancelled) return;
        const weekly = await jsonOrThrow(weeklyRes, "Failed to load weekly nutrition averages.");
        const streak = await jsonOrThrow(streakRes, "Failed to load macro streak.");
        const topFoods = await jsonOrThrow(topRes, "Failed to load top foods.");
        const micros = await jsonOrThrow(microRes, "Failed to load micronutrient status.");
        const adherence = adherenceRes
          ? await jsonOrThrow(adherenceRes, "Failed to load meal plan adherence.")
          : null;

        setData({
          weekly: Array.isArray(weekly) ? weekly : [],
          streak: streak && typeof streak === "object" ? streak : { current: 0, best: 0 },
          topFoods: Array.isArray(topFoods) ? topFoods : [],
          adherence: adherence && typeof adherence === "object" ? adherence : null,
          micros: Array.isArray(micros) ? micros : [],
          activePlanId,
        });
        setState({ loading: false, error: null });
      } catch (err) {
        console.error("[nutrition-pane] load failed:", err);
        if (!cancelled) setState({ loading: false, error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [range]);

  if (state.loading) return h("div", { className: "np-loading" }, "Loading nutrition analytics\u2026");
  if (state.error) {
    return h("div", { className: "progress-loading" }, `Nutrition analytics failed to load: ${state.error}`);
  }

  return h("div", { className: "nutrition-pane" }, [
    h("div", { className: "range-pills", key: "r" },
      RANGES.map(r =>
        h("button", {
          key: r.id,
          className: r.id === range ? "pill active" : "pill",
          onClick: () => setRange(r.id),
        }, r.label)
      )
    ),

    h("div", { className: "stat-cards", key: "s" }, [
      h("div", { className: "card", key: "ma" }, [
        h("div", { className: "label", key: "l" }, "Macro adherence"),
        h("div", { className: "value", key: "v" },
          data.adherence ? `${data.adherence.macro_adherence_pct}%` : "\u2014"),
      ]),
      h("div", { className: "card", key: "st" }, [
        h("div", { className: "label", key: "l" }, "Streak"),
        h("div", { className: "value", key: "v" },
          `${data.streak.current} / ${data.streak.best}`),
      ]),
      h("div", { className: "card", key: "pa" }, [
        h("div", { className: "label", key: "l" }, "Plan meal adherence"),
        h("div", { className: "value", key: "v" },
          data.adherence ? `${data.adherence.meal_adherence_pct}%` : "\u2014"),
      ]),
      h("div", { className: "card", key: "sa" }, [
        h("div", { className: "label", key: "l" }, "Supplement adherence"),
        h("div", { className: "value", key: "v" },
          data.adherence ? `${data.adherence.supplement_adherence_pct}%` : "\u2014"),
      ]),
    ]),

    h(StreakBanner, { key: "streak", current: data.streak.current, best: data.streak.best }),

    h("section", { className: "section-weekly", key: "w" }, [
      h("h3", { key: "h" }, "Weekly kcal"),
      h(WeeklyMacroBars, { days: data.weekly }),
    ]),

    h("section", { className: "section-top-foods", key: "tf" }, [
      h("h3", { key: "h" }, "Top foods"),
      h("ul", { className: "top-list", key: "l" },
        data.topFoods.map((f, i) =>
          h("li", { key: i }, [
            h("span", { className: "desc", key: "d" }, f.description),
            h("span", { className: "count", key: "c" }, `${f.log_count}\u00d7`),
            h("span", { className: "kcal", key: "k" }, `${Math.round(f.total_kcal)} kcal`),
          ])
        )
      ),
    ]),

    h("section", { className: "section-micros", key: "m" }, [
      h("h3", { key: "h" }, "Micronutrients (today)"),
      h("div", { className: "micro-grid", key: "g" },
        data.micros.map(n => h(MicronutrientCard, { key: n.slug, nutrient: n }))
      ),
    ]),
  ]);
}
