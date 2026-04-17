import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Simple weekly-volume line. Y axis = data.metric units (tonnage, sets,
// minutes, etc.); X is week_start date. Area fill under the line makes
// the trend direction readable at a glance.

export function VolumeTrend({ title, display_width, summary, follow_up_chips, data }) {
  const { metric, trend_points } = data;
  const sorted = trend_points.slice().sort((a, b) => a.week_start.localeCompare(b.week_start));
  const maxV = Math.max(1, ...sorted.map((p) => p.value));
  const minV = Math.min(0, ...sorted.map((p) => p.value));
  const W = 600, H = 160, PAD = { t: 10, r: 14, b: 26, l: 40 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (i / Math.max(1, sorted.length - 1)) * plotW;
  const y = (v) => PAD.t + (1 - (v - minV) / (maxV - minV || 1)) * plotH;
  const linePath = sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${x(sorted.length - 1).toFixed(1)} ${y(minV).toFixed(1)} L ${x(0).toFixed(1)} ${y(minV).toFixed(1)} Z`;

  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-vt-body" },
      h(
        "div",
        { className: "wv-vt-head" },
        h("span", { className: "wv-vt-metric" }, metric),
        h("span", { className: "wv-vt-range" }, `${sorted[0].week_start} → ${sorted[sorted.length - 1].week_start}`),
      ),
      h(
        "svg",
        { viewBox: `0 0 ${W} ${H}`, className: "wv-vt-svg", preserveAspectRatio: "xMinYMid meet" },
        h("path", { d: areaPath, fill: "var(--accent-soft)" }),
        h("path", { d: linePath, stroke: "var(--accent)", strokeWidth: 2, fill: "none" }),
        sorted.map((p, i) =>
          h("circle", { key: `p-${i}`, cx: x(i), cy: y(p.value), r: 2.5, fill: "var(--accent)" })
        ),
        h("text", { x: PAD.l - 6, y: y(maxV) + 4, textAnchor: "end", fontSize: 10, fill: "var(--muted)" }, Math.round(maxV)),
        h("text", { x: PAD.l - 6, y: y(minV) + 4, textAnchor: "end", fontSize: 10, fill: "var(--muted)" }, Math.round(minV)),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
