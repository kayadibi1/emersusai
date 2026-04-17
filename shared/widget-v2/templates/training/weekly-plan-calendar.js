import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// 7-column strip: one card per day with session label + intensity-saturated
// background. Rest days read as pale; hard days read as vivid.

export function WeeklyPlanCalendar({ title, display_width, summary, follow_up_chips, data }) {
  const { days } = data;
  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-wpc-grid" },
      days.map((d, i) => {
        const intensity = d.intensity || 0;
        const bg = intensity > 0
          ? `color-mix(in oklab, var(--accent) ${Math.round(intensity * 85)}%, transparent)`
          : "var(--surface)";
        const fg = intensity > 0.55 ? "var(--accent-text)" : "var(--ink)";
        return h("div", { key: `d-${i}`, className: "wv-wpc-day", style: { background: bg, color: fg } },
          h("div", { className: "wv-wpc-label" }, d.label),
          h("div", { className: "wv-wpc-session" }, d.session || "rest"),
          d.intensity != null ? h("div", { className: "wv-wpc-int" }, `${Math.round(d.intensity * 100)}%`) : null,
        );
      }),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
