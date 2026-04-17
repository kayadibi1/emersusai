import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Two overlaid protocol curves with an optional saturation horizontal line.
// Used for "loading phase vs steady-state maintenance" style comparisons.

export function LoadingVsMaintenance({ title, display_width, summary, follow_up_chips, data }) {
  const { protocols, saturation_y, x_label, y_label } = data;
  const all = protocols.flatMap((p) => p.points);
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(0, ...all.map((p) => p.y));
  const maxY = Math.max(saturation_y || 0, ...all.map((p) => p.y));
  const W = 640, H = 240, PAD = { t: 14, r: 14, b: 32, l: 48 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const xs = (v) => PAD.l + ((v - minX) / Math.max(1e-9, maxX - minX)) * plotW;
  const ys = (v) => PAD.t + (1 - (v - minY) / Math.max(1e-9, maxY - minY)) * plotH;

  const colors = ["var(--chart-series-1)", "var(--chart-series-2)"];

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-lvm-svg", preserveAspectRatio: "xMinYMid meet" },
      saturation_y != null ? h(React.Fragment, null,
        h("line", { x1: PAD.l, y1: ys(saturation_y), x2: W - PAD.r, y2: ys(saturation_y), stroke: "var(--muted)", strokeDasharray: "4 4" }),
        h("text", { x: W - PAD.r, y: ys(saturation_y) - 4, fontSize: 10, fill: "var(--muted)", textAnchor: "end" }, `saturation (${saturation_y})`),
      ) : null,
      protocols.map((p, i) =>
        h("path", {
          key: `p-${i}`,
          d: p.points.map((pt, j) => `${j === 0 ? "M" : "L"} ${xs(pt.x).toFixed(1)} ${ys(pt.y).toFixed(1)}`).join(" "),
          stroke: colors[i % 2], strokeWidth: 2, fill: "none",
        })
      ),
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
      h("line", { x1: PAD.l, y1: PAD.t, x2: PAD.l, y2: H - PAD.b, stroke: "var(--line)" }),
      h("text", { x: (PAD.l + W - PAD.r) / 2, y: H - 6, fontSize: 10, fill: "var(--muted)", textAnchor: "middle" }, x_label),
      h("text", { x: 14, y: (PAD.t + H - PAD.b) / 2, fontSize: 10, fill: "var(--muted)", textAnchor: "middle", transform: `rotate(-90 14 ${(PAD.t + H - PAD.b) / 2})` }, y_label),
    ),
    h("div", { className: "wv-lvm-legend" },
      protocols.map((p, i) =>
        h("span", { key: `lg-${i}`, className: "wv-lvm-legend-item" },
          h("i", { className: "wv-lvm-swatch", style: { background: colors[i % 2] } }),
          p.label,
        )
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
