import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Quadrant scatter — protein density × fiber density style. Numbered dots
// with a legend table underneath so food names don't clutter the chart.

export function FoodNutrientScatter({ title, display_width, summary, follow_up_chips, data }) {
  const { foods, x_label, y_label } = data;
  const maxX = Math.max(...foods.map((f) => f.x)) * 1.05;
  const maxY = Math.max(...foods.map((f) => f.y)) * 1.05;
  const W = 520, H = 320, PAD = { t: 14, r: 14, b: 40, l: 40 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const x = (v) => PAD.l + (v / maxX) * plotW;
  const y = (v) => PAD.t + (1 - v / maxY) * plotH;

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-fns-layout" },
      h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-fns-svg", preserveAspectRatio: "xMinYMid meet" },
        // quadrants
        h("line", { x1: x(maxX / 2), y1: PAD.t, x2: x(maxX / 2), y2: H - PAD.b, stroke: "var(--grid-line)" }),
        h("line", { x1: PAD.l, y1: y(maxY / 2), x2: W - PAD.r, y2: y(maxY / 2), stroke: "var(--grid-line)" }),
        foods.map((f, i) => h("g", { key: `f-${i}` },
          h("circle", { cx: x(f.x), cy: y(f.y), r: 7, fill: "var(--accent)", opacity: 0.85 }),
          h("text", { x: x(f.x), y: y(f.y) + 3, fontSize: 9, fill: "var(--accent-text)", textAnchor: "middle", fontWeight: 700 }, i + 1),
        )),
        h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
        h("line", { x1: PAD.l, y1: PAD.t, x2: PAD.l, y2: H - PAD.b, stroke: "var(--line)" }),
        h("text", { x: (PAD.l + W - PAD.r) / 2, y: H - 6, fontSize: 10, fill: "var(--muted)", textAnchor: "middle" }, x_label),
        h("text", { x: 14, y: (PAD.t + H - PAD.b) / 2, fontSize: 10, fill: "var(--muted)", textAnchor: "middle", transform: `rotate(-90 14 ${(PAD.t + H - PAD.b) / 2})` }, y_label),
      ),
      h("ol", { className: "wv-fns-legend" },
        foods.map((f, i) => h("li", { key: `lg-${i}` }, f.name)),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
