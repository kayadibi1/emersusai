import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Radar / spider chart — 3-10 axes, each value is % of RDI (0-200+). Inner
// threshold ring marks 50%-RDI so deficiencies pop visually.

export function MicronutrientRadar({ title, display_width, summary, follow_up_chips, data }) {
  const { axes } = data;
  const N = axes.length;
  if (N === 0) {
    return h(CardFrame, { title, summary, display_width },
      h("div", { className: "wv-mnr-empty" }, "No micronutrient data available."),
      h(FollowUpChips, { chips: follow_up_chips }),
    );
  }
  const CX = 200, CY = 200, R = 140;
  const pct = (i, r = R) => {
    const theta = (Math.PI * 2 * i) / N - Math.PI / 2;
    return { x: CX + r * Math.cos(theta), y: CY + r * Math.sin(theta) };
  };
  const scale = (v) => Math.min(R, (v / 120) * R);
  const pathOf = (vals) => vals.map((v, i) => {
    const { x, y } = pct(i, scale(v));
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ") + " Z";
  const userPath = pathOf(axes.map((a) => a.pct));
  const thresholdPath = pathOf(axes.map(() => 50));

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: "0 0 400 400", className: "wv-mnr-svg", preserveAspectRatio: "xMinYMid meet" },
      // grid circles
      [30, 60, 100, 120].map((pct, i) =>
        h("circle", { key: `g-${i}`, cx: CX, cy: CY, r: scale(pct), fill: "none", stroke: "var(--grid-line)" })
      ),
      axes.map((a, i) => {
        const { x, y } = pct(i, R + 16);
        const end = pct(i, R);
        return h("g", { key: `a-${i}` },
          h("line", { x1: CX, y1: CY, x2: end.x, y2: end.y, stroke: "var(--grid-line)" }),
          h("text", { x, y, fontSize: 10, fill: "var(--muted)", textAnchor: "middle" }, a.name),
        );
      }),
      h("path", { d: thresholdPath, fill: "none", stroke: "var(--warning)", strokeDasharray: "4 4", strokeWidth: 1.5 }),
      h("path", { d: userPath, fill: "var(--accent-soft)", stroke: "var(--accent)", strokeWidth: 2 }),
      axes.map((a, i) => {
        const { x, y } = pct(i, scale(a.pct));
        return h("circle", { key: `d-${i}`, cx: x, cy: y, r: 3, fill: "var(--accent)" });
      }),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
