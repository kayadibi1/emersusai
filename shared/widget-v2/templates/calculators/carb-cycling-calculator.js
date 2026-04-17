import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// 7-day strip: each day labeled high/med/low with its carb grams. Average
// matches the weekly target. Useful for periodized nutrition.

const TIER_COLOR = { high: "var(--chart-series-1)", med: "var(--chart-series-3)", low: "var(--muted)" };

export function CarbCyclingCalculator({ title, display_width, summary, follow_up_chips, data }) {
  const { weekly_avg_g, plan } = data;
  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-cc-header" }, `Avg ${weekly_avg_g}g carbs/day across the week`),
    h("div", { className: "wv-cc-grid" },
      plan.map((d, i) =>
        h("div", { key: `d-${i}`, className: "wv-cc-day", style: { background: `color-mix(in oklab, ${TIER_COLOR[d.tier]} 20%, transparent)`, borderColor: TIER_COLOR[d.tier] } },
          h("div", { className: "wv-cc-dow" }, d.day),
          h("div", { className: "wv-cc-tier", style: { color: TIER_COLOR[d.tier] } }, d.tier.toUpperCase()),
          h("div", { className: "wv-cc-g" }, `${d.carbs_g}g`),
        )
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
