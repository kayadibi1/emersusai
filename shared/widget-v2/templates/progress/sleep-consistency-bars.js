import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// One horizontal bar per night spanning from bedtime to wake time. Target
// bedtime + wake time shown as vertical ribbons for a visual consistency
// check.

export function SleepConsistencyBars({ title, display_width, summary, follow_up_chips, data }) {
  const { nights, target_bed, target_wake } = data;
  const sorted = nights.slice().sort((a, b) => a.date.localeCompare(b.date));
  // Map hours so late-evening and early-morning align: convert bedtime < 12 to bedtime + 24
  const adjust = (h) => h < 12 ? h + 24 : h;
  const all = sorted.flatMap((n) => [adjust(n.bed_hour), n.wake_hour + 24]);
  const minH = Math.min(...all) - 0.5;
  const maxH = Math.max(...all) + 0.5;
  const W = 640, ROW_H = 22, PAD_T = 14, PAD_B = 28;
  const H = PAD_T + sorted.length * ROW_H + PAD_B;
  const xOf = (hr) => ((hr - minH) / (maxH - minH)) * (W - 100) + 80;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-scb-svg", preserveAspectRatio: "xMinYMid meet" },
      target_bed != null ? h("line", { x1: xOf(adjust(target_bed)), y1: PAD_T - 4, x2: xOf(adjust(target_bed)), y2: H - PAD_B, stroke: "var(--accent-line)", strokeDasharray: "3 3" }) : null,
      target_wake != null ? h("line", { x1: xOf(target_wake + 24), y1: PAD_T - 4, x2: xOf(target_wake + 24), y2: H - PAD_B, stroke: "var(--accent-line)", strokeDasharray: "3 3" }) : null,
      sorted.map((n, i) => {
        const rowY = PAD_T + i * ROW_H + ROW_H / 2;
        const startX = xOf(adjust(n.bed_hour));
        const endX = xOf(n.wake_hour + 24);
        return h("g", { key: `n-${i}` },
          h("text", { x: 76, y: rowY + 3, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, n.date.slice(5)),
          h("rect", { x: startX, y: rowY - 6, width: Math.max(2, endX - startX), height: 12, rx: 3, fill: "var(--accent-soft)", stroke: "var(--accent-line)" }),
        );
      }),
      h("line", { x1: 80, y1: H - PAD_B, x2: W - 20, y2: H - PAD_B, stroke: "var(--line)" }),
      h("text", { x: 80, y: H - 10, fontSize: 9, fill: "var(--muted)" }, `${Math.round(minH)}:00`),
      h("text", { x: W - 20, y: H - 10, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, `${Math.round(maxH) % 24}:00`),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
