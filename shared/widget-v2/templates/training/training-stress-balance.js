import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// CTL / ATL / TSB triple-line chart. TSB zero-line highlighted; negative TSB
// region shaded to hint at accumulated fatigue risk.

export function TrainingStressBalance({ title, display_width, summary, follow_up_chips, data }) {
  const { series } = data;
  const sorted = series.slice().sort((a, b) => a.date.localeCompare(b.date));
  const allY = sorted.flatMap((p) => [p.ctl, p.atl, p.tsb]);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const W = 640, H = 220, PAD = { t: 14, r: 14, b: 30, l: 40 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (i / Math.max(1, sorted.length - 1)) * plotW;
  const y = (v) => PAD.t + (1 - (v - minY) / Math.max(1e-9, maxY - minY)) * plotH;
  const path = (key, color) => h("path", {
    d: sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" "),
    stroke: color, strokeWidth: 2, fill: "none",
  });

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-tsb-svg", preserveAspectRatio: "xMinYMid meet" },
      h("line", { x1: PAD.l, y1: y(0), x2: W - PAD.r, y2: y(0), stroke: "var(--muted)", strokeDasharray: "3 3" }),
      path("ctl", "var(--chart-series-2)"),
      path("atl", "var(--chart-series-4)"),
      path("tsb", "var(--chart-series-1)"),
      h("text", { x: W - PAD.r, y: y(0) - 4, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, "TSB=0"),
      h("text", { x: PAD.l, y: H - 4, fontSize: 9, fill: "var(--muted)" }, sorted[0].date),
      h("text", { x: W - PAD.r, y: H - 4, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, sorted[sorted.length - 1].date),
    ),
    h("div", { className: "wv-tsb-legend" },
      h("span", null, h("i", { style: { background: "var(--chart-series-2)" } }), " Fitness (CTL)"),
      h("span", null, h("i", { style: { background: "var(--chart-series-4)" } }), " Fatigue (ATL)"),
      h("span", null, h("i", { style: { background: "var(--chart-series-1)" } }), " Form (TSB)"),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
