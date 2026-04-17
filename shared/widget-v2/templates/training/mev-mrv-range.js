import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Floating horizontal bars per muscle spanning MEV → MRV, with MAV tick +
// current-volume dot. Visualizes whether each muscle is under-volumed, in
// productive range, or risking junk volume.

export function MevMrvRange({ title, display_width, summary, follow_up_chips, data }) {
  const { muscles, metric_label } = data;
  const maxMrv = Math.max(...muscles.map((m) => m.mrv));
  const maxCurrent = Math.max(...muscles.map((m) => m.current));
  const axisMax = Math.max(maxMrv, maxCurrent) * 1.05;
  const W = 640, ROW_H = 28, PAD_L = 140, PAD_R = 16;
  const plotW = W - PAD_L - PAD_R;
  const H = 20 + muscles.length * ROW_H;
  const x = (v) => PAD_L + (v / axisMax) * plotW;

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-mmr-metric" }, metric_label),
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-mmr-svg", preserveAspectRatio: "xMinYMid meet" },
      muscles.map((m, i) => {
        const rowY = 14 + i * ROW_H;
        const inRange = m.current >= m.mev && m.current <= m.mrv;
        const dotColor = !inRange ? "var(--warning)" : m.current >= m.mav ? "var(--accent)" : "var(--accent-soft)";
        return h("g", { key: `m-${i}` },
          h("text", { x: PAD_L - 8, y: rowY + 4, fontSize: 11, fill: "var(--ink)", textAnchor: "end" }, m.name),
          h("rect", { x: x(m.mev), y: rowY - 5, width: x(m.mrv) - x(m.mev), height: 10, fill: "var(--accent-soft)", rx: 5 }),
          h("line", { x1: x(m.mav), y1: rowY - 7, x2: x(m.mav), y2: rowY + 7, stroke: "var(--accent)", strokeWidth: 1.5 }),
          h("circle", { cx: x(m.current), cy: rowY, r: 5, fill: dotColor, stroke: "var(--bg)", strokeWidth: 2 }),
        );
      }),
    ),
    h("div", { className: "wv-mmr-legend" },
      h("span", null, h("i", { className: "wv-mmr-band" }), " MEV–MRV"),
      h("span", null, h("i", { className: "wv-mmr-mav" }), " MAV"),
      h("span", null, h("i", { className: "wv-mmr-dot" }), " current"),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
