import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Three overlaid lines: bodyweight, LBM, fat mass. Whether you're "gaining
// muscle while losing fat" reads in the spread between LBM and FM.

export function BodyCompTrend({ title, display_width, summary, follow_up_chips, data }) {
  const { comp_points } = data;
  const sorted = comp_points.slice().sort((a, b) => a.date.localeCompare(b.date));
  const all = sorted.flatMap((p) => [p.bw, p.lbm, p.fm]);
  const minV = Math.min(...all), maxV = Math.max(...all);
  const W = 640, H = 240, PAD = { t: 14, r: 14, b: 40, l: 44 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (i / Math.max(1, sorted.length - 1)) * plotW;
  const y = (v) => PAD.t + (1 - (v - minV) / Math.max(1e-9, maxV - minV)) * plotH;
  const line = (key, color) => h("path", {
    d: sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" "),
    stroke: color, strokeWidth: 2, fill: "none",
  });

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-bct-svg", preserveAspectRatio: "xMinYMid meet" },
      line("bw", "var(--chart-series-1)"),
      line("lbm", "var(--chart-series-2)"),
      line("fm", "var(--chart-series-4)"),
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
      h("text", { x: PAD.l, y: H - 14, fontSize: 9, fill: "var(--muted)" }, sorted[0].date),
      h("text", { x: W - PAD.r, y: H - 14, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, sorted[sorted.length - 1].date),
    ),
    h("div", { className: "wv-bct-legend" },
      h("span", null, h("i", { style: { background: "var(--chart-series-1)" } }), " BW"),
      h("span", null, h("i", { style: { background: "var(--chart-series-2)" } }), " Lean"),
      h("span", null, h("i", { style: { background: "var(--chart-series-4)" } }), " Fat"),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
