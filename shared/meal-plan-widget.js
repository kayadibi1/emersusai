// shared/meal-plan-widget.js
//
// React component that renders a meal-plan JSONB document inside a widget
// iframe. Shows target cards for each day-type, a day-type selector, meal
// cards for the selected day-type, and the supplement stack. Exposes a
// `[Save plan]` button that POSTs to /api/emersus/meal-plans.
//
// This module is loaded inside the widget iframe â€” it imports React from
// esm.sh and writes JSX via React.createElement (no JSX transform).

import React from "react";

const { useState } = React;
const h = React.createElement;

// Slot order for display
const SLOT_ORDER = [
  "breakfast", "mid_morning", "lunch", "afternoon", "dinner",
  "evening", "pre_workout", "post_workout",
];

function MealCard({ meal }) {
  const foods = Array.isArray(meal.foods) ? meal.foods : [];
  return h("div", { className: "meal-card", style: { marginBottom: 12, padding: "10px 12px", background: "var(--color-background-tertiary, rgba(255,255,255,0.04))", borderRadius: "var(--border-radius-md, 10px)" } }, [
    h("div", { className: "meal-card-header", key: "h", style: { display: "flex", gap: 8, alignItems: "baseline", marginBottom: 6 } }, [
      h("span", { className: "meal-slot", key: "slot", style: { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary, rgba(255,255,255,0.55))" } }, meal.slot.replace(/_/g, " ")),
      h("span", { className: "meal-name", key: "name", style: { fontSize: 13, fontWeight: 500, color: "var(--color-text-primary, #f9f9fd)" } }, meal.name),
    ]),
    h("ul", { className: "meal-foods", key: "l", style: { margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--color-text-secondary, rgba(255,255,255,0.7))", lineHeight: 1.6 } },
      foods.map((f, i) =>
        h("li", { key: i }, `${f.description} \u2014 ${f.grams} g`)
      )
    ),
  ]);
}

function SupplementStack({ supplements }) {
  if (!supplements || supplements.length === 0) return null;
  return h("div", { className: "supplement-stack", style: { marginTop: 12, padding: "10px 12px", background: "var(--color-background-tertiary, rgba(255,255,255,0.04))", borderRadius: "var(--border-radius-md, 10px)" } }, [
    h("div", { key: "h", style: { fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary, rgba(255,255,255,0.55))", marginBottom: 6 } }, "Supplement stack"),
    h("ul", { key: "l", style: { margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--color-text-secondary, rgba(255,255,255,0.7))", lineHeight: 1.6 } },
      supplements.map((s, i) =>
        h("li", { key: i },
          `${s.description} \u2014 ${s.amount} ${s.unit}${s.timing && s.timing !== "any" ? " \u00b7 " + s.timing.replace(/_/g, " ") : ""}`
        )
      )
    ),
  ]);
}

function TargetCard({ targets, dayTypeName }) {
  if (!targets) return null;
  const labelStyle = { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary, rgba(255,255,255,0.55))", margin: 0 };
  const valueStyle = { fontSize: 18, fontWeight: 500, color: "var(--color-text-primary, #f9f9fd)", margin: 0 };
  const cellStyle = { flex: 1, minWidth: 60, textAlign: "center" };
  return h("div", { className: "target-card", style: { background: "var(--color-background-tertiary, rgba(255,255,255,0.04))", borderRadius: "var(--border-radius-md, 10px)", padding: "12px 16px", marginBottom: 12 } }, [
    dayTypeName ? h("div", { className: "target-card-title", key: "t", style: { fontSize: 13, fontWeight: 500, color: "var(--color-text-primary, #f9f9fd)", marginBottom: 10 } }, dayTypeName) : null,
    h("div", { className: "target-macros", key: "m", style: { display: "flex", gap: 8, flexWrap: "wrap" } }, [
      h("div", { key: "1", style: cellStyle }, h("div", { style: labelStyle }, "kcal"), h("div", { style: valueStyle }, targets.kcal)),
      h("div", { key: "2", style: cellStyle }, h("div", { style: labelStyle }, "protein"), h("div", { style: valueStyle }, `${targets.protein_g}g`)),
      h("div", { key: "3", style: cellStyle }, h("div", { style: labelStyle }, "carbs"), h("div", { style: valueStyle }, `${targets.carbs_g}g`)),
      h("div", { key: "4", style: cellStyle }, h("div", { style: labelStyle }, "fat"), h("div", { style: valueStyle }, `${targets.fat_g}g`)),
      h("div", { key: "5", style: cellStyle }, h("div", { style: labelStyle }, "fiber"), h("div", { style: valueStyle }, `${targets.fiber_g}g`)),
    ]),
  ]);
}

// Named exports for inline reuse by MealPlanCard in react-chat-app.js.
// These are presentational-only and depend on nothing but React.createElement.
export { MealCard, SupplementStack, TargetCard, SLOT_ORDER };

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
