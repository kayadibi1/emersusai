import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Protocols ranked by effect, each with a CI whisker. Overlapping CIs
// indicate no statistical preference; non-overlapping ones do.

export function CiLadder({ title, display_width, summary, follow_up_chips, data }) {
  const { outcome, ladder_protocols } = data;
  const sorted = ladder_protocols.slice().sort((a, b) => b.effect - a.effect);
  const minX = Math.min(...sorted.map((p) => p.ci_low));
  const maxX = Math.max(...sorted.map((p) => p.ci_high));
  const W = 640, ROW_H = 30, PAD_L = 180, PAD_R = 14, PAD_T = 30;
  const plotW = W - PAD_L - PAD_R;
  const H = PAD_T + sorted.length * ROW_H + 10;
  const x = (v) => PAD_L + ((v - minX) / Math.max(1e-9, maxX - minX)) * plotW;

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-cil-outcome" }, outcome),
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-cil-svg", preserveAspectRatio: "xMinYMid meet" },
      h("line", { x1: x(0), y1: PAD_T - 10, x2: x(0), y2: H - 10, stroke: "var(--muted)", strokeDasharray: "3 4" }),
      h("text", { x: PAD_L, y: PAD_T - 14, fontSize: 9, fill: "var(--muted)" }, minX.toFixed(2)),
      h("text", { x: W - PAD_R, y: PAD_T - 14, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, maxX.toFixed(2)),
      sorted.map((p, i) => {
        const rowY = PAD_T + i * ROW_H;
        return h("g", { key: `p-${i}` },
          h("text", { x: PAD_L - 8, y: rowY + 4, fontSize: 11, fill: "var(--ink)", textAnchor: "end" }, p.label),
          h("line", { x1: x(p.ci_low), y1: rowY, x2: x(p.ci_high), y2: rowY, stroke: "var(--accent)", strokeWidth: 2 }),
          h("line", { x1: x(p.ci_low), y1: rowY - 5, x2: x(p.ci_low), y2: rowY + 5, stroke: "var(--accent)", strokeWidth: 2 }),
          h("line", { x1: x(p.ci_high), y1: rowY - 5, x2: x(p.ci_high), y2: rowY + 5, stroke: "var(--accent)", strokeWidth: 2 }),
          h("circle", { cx: x(p.effect), cy: rowY, r: 5, fill: "var(--accent)" }),
        );
      }),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
