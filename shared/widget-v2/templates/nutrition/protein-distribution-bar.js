import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Horizontal per-meal protein bars against the daily target. Meals sorted
// by `hour` so the timeline reads left-to-right logically (AM → PM).

function formatHour(h24) {
  const h12 = ((h24 + 11) % 12) + 1;
  const ampm = h24 < 12 ? "am" : "pm";
  return `${h12}${ampm}`;
}

export function ProteinDistributionBar({ title, display_width, summary, follow_up_chips, data }) {
  const { daily_target_g, meals } = data;
  const sortedMeals = meals.slice().sort((a, b) => a.hour - b.hour);
  const totalEmitted = sortedMeals.reduce((s, m) => s + (m.grams || 0), 0);
  const maxBar = Math.max(daily_target_g, totalEmitted, ...sortedMeals.map((m) => m.grams));
  const widthOf = (g) => `${Math.min(100, (g / maxBar) * 100)}%`;
  const deltaPct = Math.round((totalEmitted / daily_target_g) * 100);

  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-pdb-body" },
      h(
        "div",
        { className: "wv-pdb-head" },
        h("span", { className: "wv-pdb-head-label" }, "Daily target"),
        h("span", { className: "wv-pdb-head-value" }, `${daily_target_g} g`),
        h(
          "span",
          {
            className: "wv-pdb-head-emitted",
            style: { color: totalEmitted >= daily_target_g ? "var(--chart-series-2, var(--accent))" : "var(--warning)" },
          },
          `${totalEmitted} g emitted · ${deltaPct}%`,
        ),
      ),
      h(
        "ul",
        { className: "wv-pdb-list" },
        sortedMeals.map((m, i) =>
          h(
            "li",
            { key: `pdb-${i}`, className: "wv-pdb-row" },
            h("span", { className: "wv-pdb-row-slot" }, m.slot),
            h("span", { className: "wv-pdb-row-hour" }, formatHour(m.hour)),
            h(
              "div",
              { className: "wv-pdb-track" },
              h("div", { className: "wv-pdb-bar", style: { width: widthOf(m.grams) } }),
            ),
            h("span", { className: "wv-pdb-row-grams" }, `${m.grams}g`),
          ),
        ),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
