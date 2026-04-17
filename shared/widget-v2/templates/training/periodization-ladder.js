import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Horizontal phase timeline. Each phase = one bar spanning its start_week
// through end_week. Bar height proportional to relative_load. Labels inside
// each bar; weeks axis below.

const PHASE_COLORS = ["--chart-series-1", "--chart-series-2", "--chart-series-3", "--chart-series-4", "--chart-series-5"];

export function PeriodizationLadder({ title, display_width, summary, follow_up_chips, data }) {
  const { weeks, focus_metric, phases } = data;
  const maxLoad = Math.max(1, ...phases.map((p) => p.relative_load));

  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-pl-body" },
      h(
        "div",
        { className: "wv-pl-head" },
        h("span", { className: "wv-pl-head-label" }, `${weeks}-week block`),
        h("span", { className: "wv-pl-head-metric" }, `Focus: ${focus_metric}`),
      ),
      h(
        "div",
        { className: "wv-pl-phases" },
        phases.map((p, i) => {
          const span = p.end_week - p.start_week + 1;
          const widthPct = (span / weeks) * 100;
          const heightPct = Math.max(28, (p.relative_load / maxLoad) * 100);
          return h(
            "div",
            {
              key: `ph-${i}`,
              className: "wv-pl-phase",
              style: {
                width: `${widthPct}%`,
                background: `var(${PHASE_COLORS[i % PHASE_COLORS.length]})`,
                height: `${heightPct}%`,
              },
              title: `${p.name} · week ${p.start_week}-${p.end_week} · load ${p.relative_load}`,
            },
            h("div", { className: "wv-pl-phase-name" }, p.name),
            h("div", { className: "wv-pl-phase-meta" }, `w${p.start_week}-${p.end_week} · ${p.relative_load}`),
          );
        }),
      ),
      h(
        "div",
        { className: "wv-pl-axis" },
        Array.from({ length: weeks }, (_, i) =>
          h("span", { key: `w-${i}`, className: "wv-pl-tick" }, `${i + 1}`),
        ),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
