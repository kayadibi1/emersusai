import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Blood-concentration-over-time curve based on a single-dose half-life.
// C(t) = initial_dose * 0.5^(t / half_life). Generates a dense polyline
// from t=0 to horizon_hours, plus vertical ticks at each elapsed half-life
// so the "5-half-lives ≈ fully cleared" heuristic is visible.

export function HalfLifeDecay({ title, display_width, summary, follow_up_chips, data }) {
  const { compound, half_life_hours, initial_dose, dose_unit, horizon_hours } = data;
  const W = 600, H = 220, PAD = { t: 14, r: 14, b: 30, l: 48 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const steps = 120;
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const t = (i / steps) * horizon_hours;
    const c = initial_dose * Math.pow(0.5, t / half_life_hours);
    return { t, c };
  });
  const maxC = initial_dose;
  const x = (t) => PAD.l + (t / horizon_hours) * plotW;
  const y = (c) => PAD.t + (1 - c / maxC) * plotH;
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p.c).toFixed(1)}`).join(" ");

  const halfLifeTicks = [];
  for (let k = 1; k * half_life_hours <= horizon_hours && k <= 6; k++) {
    halfLifeTicks.push(k);
  }

  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-hld-body" },
      h(
        "div",
        { className: "wv-hld-head" },
        h("span", { className: "wv-hld-compound" }, compound),
        h("span", { className: "wv-hld-meta" }, `t½ ${half_life_hours} h · horizon ${horizon_hours} h`),
      ),
      h(
        "svg",
        { viewBox: `0 0 ${W} ${H}`, className: "wv-hld-svg", preserveAspectRatio: "xMinYMid meet" },
        halfLifeTicks.map((k) =>
          h(
            React.Fragment,
            { key: `hl-${k}` },
            h("line", {
              x1: x(k * half_life_hours), y1: PAD.t,
              x2: x(k * half_life_hours), y2: H - PAD.b,
              stroke: "var(--grid-line)", strokeDasharray: "3 4",
            }),
            h("text", {
              x: x(k * half_life_hours), y: PAD.t + 10,
              fontSize: 9, fill: "var(--muted)", textAnchor: "middle",
            }, `${k}×t½`),
          ),
        ),
        h("path", { d: linePath, stroke: "var(--accent)", strokeWidth: 2, fill: "none" }),
        h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
        h("line", { x1: PAD.l, y1: PAD.t, x2: PAD.l, y2: H - PAD.b, stroke: "var(--line)" }),
        h("text", { x: PAD.l, y: H - PAD.b + 14, fontSize: 10, fill: "var(--muted)" }, "0 h"),
        h("text", { x: W - PAD.r, y: H - PAD.b + 14, fontSize: 10, fill: "var(--muted)", textAnchor: "end" }, `${horizon_hours} h`),
        h("text", { x: PAD.l - 8, y: PAD.t + 4, fontSize: 10, fill: "var(--muted)", textAnchor: "end" }, `${initial_dose} ${dose_unit}`),
        h("text", { x: PAD.l - 8, y: H - PAD.b + 4, fontSize: 10, fill: "var(--muted)", textAnchor: "end" }, "0"),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
