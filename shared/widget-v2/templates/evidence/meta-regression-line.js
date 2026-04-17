import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Scatter of study effects by dose (or any moderator) + fitted regression
// line + R². Dots labeled, regression drawn through the min/max domain.

export function MetaRegressionLine({ title, display_width, summary, follow_up_chips, data }) {
  const { x_label, y_label, regression_points: points, regression } = data;
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y), 0);
  const maxY = Math.max(...points.map((p) => p.y));
  const W = 600, H = 300, PAD = { t: 14, r: 14, b: 40, l: 48 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const x = (v) => PAD.l + ((v - minX) / Math.max(1e-9, maxX - minX)) * plotW;
  const y = (v) => PAD.t + (1 - (v - minY) / Math.max(1e-9, maxY - minY)) * plotH;
  const regY = (xv) => regression.slope * xv + regression.intercept;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-mrl-svg", preserveAspectRatio: "xMinYMid meet" },
      h("line", { x1: x(minX), y1: y(regY(minX)), x2: x(maxX), y2: y(regY(maxX)), stroke: "var(--accent)", strokeWidth: 2 }),
      points.map((p, i) =>
        h("g", { key: `p-${i}` },
          h("circle", { cx: x(p.x), cy: y(p.y), r: 5, fill: "var(--accent-soft)", stroke: "var(--accent)", strokeWidth: 1.5 }),
          h("text", { x: x(p.x) + 7, y: y(p.y) + 3, fontSize: 9, fill: "var(--muted)" }, p.label),
        )
      ),
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
      h("line", { x1: PAD.l, y1: PAD.t, x2: PAD.l, y2: H - PAD.b, stroke: "var(--line)" }),
      h("text", { x: (PAD.l + W - PAD.r) / 2, y: H - 20, fontSize: 10, fill: "var(--muted)", textAnchor: "middle" }, x_label),
      h("text", { x: 14, y: (PAD.t + H - PAD.b) / 2, fontSize: 10, fill: "var(--muted)", textAnchor: "middle", transform: `rotate(-90 14 ${(PAD.t + H - PAD.b) / 2})` }, y_label),
      h("text", { x: W - PAD.r, y: PAD.t + 12, fontSize: 10, fill: "var(--accent)", textAnchor: "end", fontWeight: 600 }, `R² = ${regression.r_squared.toFixed(2)}`),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
