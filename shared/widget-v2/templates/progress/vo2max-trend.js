import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// VO₂ max over time with Cooper age-group zone bands (poor → excellent).
// User provides age_group (e.g. "30-39_male"); the component ships with a
// reasonable default band set. Numbers are textbook Cooper-test zones.

const ZONES = {
  "20-29_male":   [{ label: "Poor", max: 38 }, { label: "Fair", max: 43 }, { label: "Good", max: 51 }, { label: "Excellent", max: 99 }],
  "30-39_male":   [{ label: "Poor", max: 33 }, { label: "Fair", max: 39 }, { label: "Good", max: 47 }, { label: "Excellent", max: 99 }],
  "40-49_male":   [{ label: "Poor", max: 30 }, { label: "Fair", max: 35 }, { label: "Good", max: 43 }, { label: "Excellent", max: 99 }],
  "20-29_female": [{ label: "Poor", max: 31 }, { label: "Fair", max: 36 }, { label: "Good", max: 44 }, { label: "Excellent", max: 99 }],
  "30-39_female": [{ label: "Poor", max: 28 }, { label: "Fair", max: 33 }, { label: "Good", max: 41 }, { label: "Excellent", max: 99 }],
};

export function Vo2maxTrend({ title, display_width, summary, follow_up_chips, data }) {
  const { vo2_points, age_group } = data;
  const zones = ZONES[age_group] || ZONES["30-39_male"];
  const sorted = vo2_points.slice().sort((a, b) => a.date.localeCompare(b.date));
  const minV = 0;
  const maxV = Math.max(55, ...sorted.map((p) => p.value));
  const W = 640, H = 240, PAD = { t: 14, r: 14, b: 36, l: 44 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (i / Math.max(1, sorted.length - 1)) * plotW;
  const y = (v) => PAD.t + (1 - (v - minV) / Math.max(1e-9, maxV - minV)) * plotH;
  const path = sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-v2m-svg", preserveAspectRatio: "xMinYMid meet" },
      zones.map((z, i) => {
        const prevMax = i === 0 ? minV : zones[i - 1].max;
        const fill = ["rgba(248,113,113,0.10)", "rgba(251,191,36,0.10)", "rgba(96,165,250,0.10)", "rgba(52,211,153,0.12)"][i] || "transparent";
        return h("g", { key: `z-${i}` },
          h("rect", { x: PAD.l, y: y(Math.min(z.max, maxV)), width: plotW, height: y(prevMax) - y(Math.min(z.max, maxV)), fill }),
          h("text", { x: W - PAD.r - 4, y: y((prevMax + Math.min(z.max, maxV)) / 2) + 3, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, z.label),
        );
      }),
      h("path", { d: path, stroke: "var(--accent)", strokeWidth: 2.5, fill: "none" }),
      sorted.map((p, i) => h("circle", { key: `p-${i}`, cx: x(i), cy: y(p.value), r: 3, fill: "var(--accent)" })),
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
