import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// X = dose, Y = effect %. Recommended range shown as a vertical band under
// the curve. Points rendered as dots sized by study_n so under-powered
// data points visually recede.

export function DoseResponseCurve({ title, display_width, summary, follow_up_chips, data }) {
  const { compound, unit, points, recommended_range } = data;
  const sorted = points.slice().sort((a, b) => a.dose - b.dose);
  const doses = sorted.map((p) => p.dose);
  const effects = sorted.map((p) => p.effect_pct);
  const minDose = Math.min(...doses);
  const maxDose = Math.max(...doses);
  const minEff = Math.min(0, ...effects);
  const maxEff = Math.max(...effects);
  const W = 600, H = 240, PAD = { t: 14, r: 14, b: 36, l: 48 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (d) => PAD.l + ((d - minDose) / Math.max(1, maxDose - minDose)) * plotW;
  const y = (e) => PAD.t + (1 - (e - minEff) / Math.max(1, maxEff - minEff)) * plotH;

  const linePath = sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.dose).toFixed(1)} ${y(p.effect_pct).toFixed(1)}`).join(" ");

  const maxN = Math.max(1, ...sorted.map((p) => p.study_n || 1));

  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-drc-body" },
      h(
        "div",
        { className: "wv-drc-head" },
        h("span", { className: "wv-drc-compound" }, compound),
        h("span", { className: "wv-drc-unit" }, `dose (${unit})`),
      ),
      h(
        "svg",
        { viewBox: `0 0 ${W} ${H}`, className: "wv-drc-svg", preserveAspectRatio: "xMinYMid meet" },
        recommended_range ? h("rect", {
          x: x(recommended_range.min),
          y: PAD.t,
          width: Math.max(2, x(recommended_range.max) - x(recommended_range.min)),
          height: plotH,
          fill: "var(--accent-soft)",
        }) : null,
        h("path", { d: linePath, stroke: "var(--accent)", strokeWidth: 2, fill: "none" }),
        sorted.map((p, i) =>
          h("circle", {
            key: `pt-${i}`,
            cx: x(p.dose),
            cy: y(p.effect_pct),
            r: 3 + 3 * Math.sqrt((p.study_n || 0) / maxN),
            fill: "var(--accent)",
            opacity: 0.85,
          })
        ),
        // axes
        h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
        h("line", { x1: PAD.l, y1: PAD.t, x2: PAD.l, y2: H - PAD.b, stroke: "var(--line)" }),
        h("text", { x: PAD.l, y: H - PAD.b + 16, fontSize: 10, fill: "var(--muted)" }, `${minDose}`),
        h("text", { x: W - PAD.r, y: H - PAD.b + 16, fontSize: 10, fill: "var(--muted)", textAnchor: "end" }, `${maxDose}`),
        h("text", { x: PAD.l - 8, y: y(maxEff) + 4, fontSize: 10, fill: "var(--muted)", textAnchor: "end" }, `${Math.round(maxEff)}%`),
        h("text", { x: PAD.l - 8, y: y(minEff) + 4, fontSize: 10, fill: "var(--muted)", textAnchor: "end" }, `${Math.round(minEff)}%`),
        recommended_range ? h(
          "text",
          { x: x((recommended_range.min + recommended_range.max) / 2), y: PAD.t + 12, fontSize: 10, fill: "var(--accent)", textAnchor: "middle", fontWeight: 600 },
          `range ${recommended_range.min}-${recommended_range.max} ${unit}`,
        ) : null,
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
