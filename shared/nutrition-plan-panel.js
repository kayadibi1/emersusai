// shared/nutrition-plan-panel.js
//
// Plan tab composition for /app/nutrition/. Reads the active meal plan
// from /api/emersus/meal-plans/active and fetches workout plan directly
// from Supabase per A3. Lets the user switch day types, edit targets,
// override assignments on specific dates, and regenerate the plan from chat.

import React from "react";
import { createClient } from "@supabase/supabase-js";
import { resolveDayType } from "./meal-plan-day-type.js";

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

function TargetCard({ targets, dayTypeName, editing, onChange, onToggleEdit, onSave }) {
  if (!targets) return null;
  const fields = [
    ["kcal",      "kcal"],
    ["protein_g", "protein (g)"],
    ["carbs_g",   "carbs (g)"],
    ["fat_g",     "fat (g)"],
    ["fiber_g",   "fiber (g)"],
  ];
  return h("div", { className: "target-card" }, [
    h("div", { className: "tc-header", key: "h" }, [
      h("h3", { key: "t" }, `Targets - ${dayTypeName}`),
      h("button", { key: "e", onClick: onToggleEdit }, editing ? "Cancel" : "Edit targets"),
      editing && h("button", { key: "s", className: "primary", onClick: onSave }, "Save"),
    ]),
    h("dl", { className: "tc-grid", key: "g" },
      fields.flatMap(([key, label]) => [
        h("dt", { key: `${key}-dt` }, label),
        editing
          ? h("dd", { key: `${key}-dd` },
              h("input", {
                type: "number",
                min: 0,
                value: targets[key] ?? 0,
                onChange: (e) => onChange(key, parseFloat(e.target.value) || 0),
              })
            )
          : h("dd", { key: `${key}-dd` }, targets[key] ?? "-"),
      ])
    ),
  ]);
}

function AssignmentsCalendar({ mealPlan, workoutPlan, onOverride }) {
  const today = new Date();
  const month = today.getMonth();
  const year = today.getFullYear();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = firstOfMonth.getDay();

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push({ empty: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dt = resolveDayType({ date, mealPlan: mealPlan?.plan, workoutPlan: workoutPlan?.plan });
    const hasWorkout = mealPlan?.plan?.assignments?.mode === "auto_from_workout"
      && (workoutPlan?.plan?.schedule ?? []).some(s => s.date === date);
    cells.push({ date, dt, hasWorkout, d });
  }

  return h("div", { className: "assignments-calendar" }, [
    h("div", { key: "m", className: "month-label" },
      firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    ),
    h("div", { key: "g", className: "grid" },
      cells.map((c, i) =>
        c.empty
          ? h("div", { key: `e${i}`, className: "cell empty" })
          : h("div", {
              key: c.date,
              className: `cell day-type-${c.dt}`,
              onClick: () => onOverride?.(c.date, c.dt),
              title: c.hasWorkout ? "Workout session scheduled" : "",
            }, [
              h("span", { className: "dom", key: "d" }, c.d),
              c.hasWorkout && h("span", { className: "dot", key: "wk" }, "."),
            ])
      )
    ),
  ]);
}

export default function NutritionPlanPanel({ onRegenerateViaChat }) {
  const [mealPlan, setMealPlan] = useState(null);
  const [workoutPlan, setWorkoutPlan] = useState(null);
  const [activeSlug, setActiveSlug] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editedTargets, setEditedTargets] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      // Fetch meal plan via authFetch
      const mpRes = await authFetch("/api/emersus/meal-plans/active");
      const mp = mpRes.ok ? await mpRes.json() : { meal_plan: null };

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

      setMealPlan(mp.meal_plan);
      setWorkoutPlan(workoutPlanData);
      if (mp.meal_plan?.plan?.day_types?.[0]) {
        setActiveSlug(mp.meal_plan.plan.day_types[0].slug);
      }
    } catch (err) {
      console.error("[plan-panel] load failed:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return h("div", { className: "plan-loading" }, "Loading plan...");

  if (!mealPlan) {
    return h("div", { className: "plan-empty" }, [
      h("h3", { key: "h" }, "No active plan"),
      h("p", { key: "p" }, "Ask the coach in chat for a meal plan to get started."),
      h("button", { key: "b", className: "primary", onClick: onRegenerateViaChat }, "Open chat"),
    ]);
  }

  const activeDayType = mealPlan.plan.day_types.find(dt => dt.slug === activeSlug);
  const activeTargets = editing
    ? editedTargets
    : mealPlan.plan.targets?.[activeSlug];

  async function saveTargets() {
    const newPlan = structuredClone(mealPlan.plan);
    newPlan.targets[activeSlug] = editedTargets;
    const res = await authFetch(`/api/emersus/meal-plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: mealPlan.title, plan: newPlan }),
    });
    if (res.ok) {
      setEditing(false);
      setEditedTargets(null);
      await load();
    }
  }

  async function overrideDate(date, currentDayType) {
    const next = prompt(`Override ${date} to day-type:`, currentDayType);
    if (!next) return;
    const newOverrides = { ...(mealPlan.plan.assignments.overrides ?? {}), [date]: next };
    const res = await authFetch(`/api/emersus/meal-plans/${mealPlan.id}/assignments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overrides: newOverrides }),
    });
    if (res.ok) await load();
  }

  async function undo() {
    const res = await authFetch(`/api/emersus/meal-plans/${mealPlan.id}/undo`, { method: "POST" });
    if (res.ok) await load();
  }

  return h("div", { className: "plan-panel" }, [
    h("div", { className: "plan-header", key: "h" }, [
      h("h2", { key: "t" }, mealPlan.title),
      h("span", { key: "p" },
        mealPlan.plan.provenance?.profile_snapshot
          ? `Based on ${mealPlan.plan.provenance.profile_snapshot.goal ?? ""} - ${mealPlan.plan.provenance.profile_snapshot.body_weight_kg} kg`
          : ""
      ),
    ]),

    h("div", { className: "day-type-tabs", key: "tabs" },
      mealPlan.plan.day_types.map(dt =>
        h("button", {
          key: dt.slug,
          className: dt.slug === activeSlug ? "tab active" : "tab",
          onClick: () => setActiveSlug(dt.slug),
        }, dt.name)
      )
    ),

    h(TargetCard, {
      key: "targets",
      targets: activeTargets,
      dayTypeName: activeDayType?.name ?? "",
      editing,
      onChange: (k, v) => setEditedTargets({ ...(editedTargets ?? activeTargets), [k]: v }),
      onToggleEdit: () => {
        if (editing) {
          setEditing(false);
          setEditedTargets(null);
        } else {
          setEditing(true);
          setEditedTargets({ ...mealPlan.plan.targets?.[activeSlug] });
        }
      },
      onSave: saveTargets,
    }),

    h("div", { className: "plan-meals", key: "meals" },
      (activeDayType?.meals ?? []).map((m, i) =>
        h("div", { key: i, className: "plan-meal-card" }, [
          h("div", { className: "mh", key: "h" },
            `${m.slot.replace(/_/g, " ")} - ${m.name}`),
          h("ul", { key: "l" },
            (m.foods ?? []).map((f, j) =>
              h("li", { key: j }, `${f.description} - ${f.grams} g`)
            )
          ),
        ])
      )
    ),

    activeDayType?.supplements && activeDayType.supplements.length > 0 &&
    h("div", { className: "plan-supplements", key: "supps" }, [
      h("h3", { key: "h" }, "Supplement stack"),
      h("ul", { key: "l" },
        activeDayType.supplements.map((s, i) =>
          h("li", { key: i },
            `${s.description} - ${s.amount} ${s.unit}${s.timing && s.timing !== "any" ? " - " + s.timing.replace(/_/g, " ") : ""}`
          )
        )
      ),
    ]),

    h("div", { className: "plan-actions", key: "a" }, [
      h("button", { key: "re", onClick: onRegenerateViaChat }, "Regenerate plan"),
      h("button", { key: "u", onClick: undo }, "Undo last change"),
    ]),

    h(AssignmentsCalendar, {
      key: "cal",
      mealPlan,
      workoutPlan,
      onOverride: overrideDate,
    }),
  ]);
}
