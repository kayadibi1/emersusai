import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Horizontal stacked bar per meal: protein/carbs/fat segments proportional
// to kcal contribution. Total kcal of the meal is the bar's length relative
// to the day's biggest meal — this preserves meal-size comparison inside
// the same widget while keeping the breakdown ratios readable.

export function MealMacroStack({ title, display_width, summary, follow_up_chips, data }) {
  const { daily_total_kcal, macro_meals } = data;
  const mealTotals = macro_meals.map((m) => m.protein_kcal + m.carbs_kcal + m.fat_kcal);
  const maxMeal = Math.max(1, ...mealTotals);
  const widthOf = (kcal) => `${(kcal / maxMeal) * 100}%`;
  const totalEmitted = mealTotals.reduce((s, k) => s + k, 0);

  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-mms-body" },
      h(
        "div",
        { className: "wv-mms-head" },
        h("span", { className: "wv-mms-head-label" }, "Daily total"),
        h("span", { className: "wv-mms-head-value" }, `${daily_total_kcal} kcal`),
        h("span", { className: "wv-mms-head-emitted" }, `${totalEmitted} kcal across meals`),
      ),
      h(
        "ul",
        { className: "wv-mms-list" },
        macro_meals.map((m, i) => {
          const total = mealTotals[i] || 1;
          const ppct = (m.protein_kcal / total) * 100;
          const cpct = (m.carbs_kcal / total) * 100;
          const fpct = (m.fat_kcal / total) * 100;
          return h(
            "li",
            { key: `mms-${i}`, className: "wv-mms-row" },
            h("span", { className: "wv-mms-row-name" }, m.name),
            h(
              "div",
              { className: "wv-mms-track", style: { width: widthOf(mealTotals[i]) } },
              h("div", { className: "wv-mms-seg wv-mms-seg-protein", style: { width: `${ppct}%` } }, ppct > 14 ? "P" : null),
              h("div", { className: "wv-mms-seg wv-mms-seg-carbs", style: { width: `${cpct}%` } }, cpct > 14 ? "C" : null),
              h("div", { className: "wv-mms-seg wv-mms-seg-fat", style: { width: `${fpct}%` } }, fpct > 14 ? "F" : null),
            ),
            h("span", { className: "wv-mms-row-kcal" }, `${mealTotals[i]} kcal`),
          );
        }),
      ),
      h(
        "div",
        { className: "wv-mms-legend" },
        h("span", { className: "wv-mms-legend-item" }, h("i", { className: "wv-mms-dot wv-mms-seg-protein" }), " Protein"),
        h("span", { className: "wv-mms-legend-item" }, h("i", { className: "wv-mms-dot wv-mms-seg-carbs" }), " Carbs"),
        h("span", { className: "wv-mms-legend-item" }, h("i", { className: "wv-mms-dot wv-mms-seg-fat" }), " Fat"),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
