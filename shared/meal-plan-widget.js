// shared/meal-plan-widget.js
//
// React component that renders a meal-plan JSONB document inside a widget
// iframe. Shows target cards for each day-type, a day-type selector, meal
// cards for the selected day-type, and the supplement stack. Exposes a
// `[Save plan]` button that POSTs to /api/emersus/meal-plans.
//
// This module is loaded inside the widget iframe — it imports React from
// esm.sh and writes JSX via React.createElement (no JSX transform).

import React from "https://esm.sh/react@18.2.0";

const { useState } = React;
const h = React.createElement;

// Slot order for display
const SLOT_ORDER = [
  "breakfast", "mid_morning", "lunch", "afternoon", "dinner",
  "evening", "pre_workout", "post_workout",
];

function MealCard({ meal }) {
  const foods = Array.isArray(meal.foods) ? meal.foods : [];
  return h("div", { className: "meal-card" }, [
    h("div", { className: "meal-card-header", key: "h" }, [
      h("span", { className: "meal-slot", key: "slot" }, meal.slot.replace(/_/g, " ")),
      h("span", { className: "meal-name", key: "name" }, meal.name),
    ]),
    h("ul", { className: "meal-foods", key: "l" },
      foods.map((f, i) =>
        h("li", { key: i }, `${f.description} — ${f.grams} g`)
      )
    ),
  ]);
}

function SupplementStack({ supplements }) {
  if (!supplements || supplements.length === 0) return null;
  return h("div", { className: "supplement-stack" }, [
    h("h4", { key: "h" }, "Supplement stack"),
    h("ul", { key: "l" },
      supplements.map((s, i) =>
        h("li", { key: i },
          `${s.description} — ${s.amount} ${s.unit}${s.timing && s.timing !== "any" ? " · " + s.timing.replace(/_/g, " ") : ""}`
        )
      )
    ),
  ]);
}

function TargetCard({ targets, dayTypeName }) {
  if (!targets) return null;
  return h("div", { className: "target-card" }, [
    h("div", { className: "target-card-title", key: "t" }, dayTypeName),
    h("dl", { className: "target-macros", key: "m" }, [
      h("dt", { key: "1" }, "kcal"),  h("dd", { key: "2" }, targets.kcal),
      h("dt", { key: "3" }, "P"),     h("dd", { key: "4" }, `${targets.protein_g} g`),
      h("dt", { key: "5" }, "C"),     h("dd", { key: "6" }, `${targets.carbs_g} g`),
      h("dt", { key: "7" }, "F"),     h("dd", { key: "8" }, `${targets.fat_g} g`),
      h("dt", { key: "9" }, "fiber"), h("dd", { key: "10" }, `${targets.fiber_g} g`),
    ]),
  ]);
}

export default function MealPlanWidget({ plan }) {
  const dayTypes = plan?.day_types ?? [];
  const [activeSlug, setActiveSlug] = useState(dayTypes[0]?.slug ?? null);
  const [saveState, setSaveState] = useState("idle");
  const [savedTitle, setSavedTitle] = useState("");

  const activeDayType = dayTypes.find(dt => dt.slug === activeSlug);
  const activeTargets = plan?.targets?.[activeSlug];

  const sortedMeals = (activeDayType?.meals ?? [])
    .slice()
    .sort((a, b) =>
      (SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
    );

  async function save() {
    setSaveState("saving");
    const title = savedTitle || `${plan.provenance?.profile_snapshot?.goal ?? "Meal"} plan`;
    try {
      const res = await fetch("/api/emersus/meal-plans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Auth header is injected by the parent chat app via the iframe bridge
          // (window.parent sends the token; widgets include it in window.EMERSUS_AUTH).
          ...(window.EMERSUS_AUTH ? { Authorization: `Bearer ${window.EMERSUS_AUTH}` } : {}),
        },
        body: JSON.stringify({ title, plan }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveState("saved");
    } catch (err) {
      console.error("[meal-plan-widget] save failed:", err);
      setSaveState("error");
    }
  }

  return h("div", { className: "meal-plan-widget" }, [
    h("div", { className: "meal-plan-tabs", key: "tabs" },
      dayTypes.map(dt =>
        h("button", {
          key: dt.slug,
          className: dt.slug === activeSlug ? "tab active" : "tab",
          onClick: () => setActiveSlug(dt.slug),
        }, dt.name)
      )
    ),
    h(TargetCard, { key: "targets", targets: activeTargets, dayTypeName: activeDayType?.name ?? "" }),
    h("div", { className: "meal-plan-meals", key: "meals" },
      sortedMeals.map((m, i) => h(MealCard, { key: i, meal: m }))
    ),
    h(SupplementStack, { key: "supps", supplements: activeDayType?.supplements }),
    h("div", { className: "meal-plan-actions", key: "actions" }, [
      h("input", {
        key: "title-input",
        type: "text",
        placeholder: "Plan title (optional)",
        value: savedTitle,
        onChange: (e) => setSavedTitle(e.target.value),
        disabled: saveState !== "idle",
      }),
      h("button", {
        key: "save",
        className: "primary",
        onClick: save,
        disabled: saveState !== "idle",
      },
        saveState === "idle"  ? "Save plan" :
        saveState === "saving" ? "Saving..." :
        saveState === "saved"  ? "\u2713 Saved" :
                                  "Save failed \u2014 retry"
      ),
    ]),
  ]);
}
