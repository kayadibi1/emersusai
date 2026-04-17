import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Horizontal forest plot. Each row: label on left, CI whisker + point
// estimate across a shared X axis. Vertical zero line emphasizes which
// studies cross the null.

export function EffectSizeForest({ title, display_width, summary, follow_up_chips, data }) {
  const { outcome, rows } = data;
  const minE = Math.min(0, ...rows.map((r) => r.ci_low));
  const maxE = Math.max(0, ...rows.map((r) => r.ci_high));
  const span = Math.max(0.1, maxE - minE);
  const W = 600;
  const rowH = 32;
  const PAD = { t: 30, r: 14, b: 14, l: 180 };
  const H = PAD.t + PAD.b + rows.length * rowH;
  const plotW = W - PAD.l - PAD.r;
  const x = (v) => PAD.l + ((v - minE) / span) * plotW;
  const zeroX = x(0);

  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-esf-body" },
      h("div", { className: "wv-esf-outcome" }, outcome),
      h(
        "svg",
        { viewBox: `0 0 ${W} ${H}`, className: "wv-esf-svg", preserveAspectRatio: "xMinYMid meet" },
        // axis ticks
        h("line", { x1: PAD.l, y1: PAD.t - 10, x2: W - PAD.r, y2: PAD.t - 10, stroke: "var(--line)" }),
        h("text", { x: PAD.l, y: PAD.t - 14, fontSize: 10, fill: "var(--muted)" }, minE.toFixed(1)),
        h("text", { x: W - PAD.r, y: PAD.t - 14, fontSize: 10, fill: "var(--muted)", textAnchor: "end" }, maxE.toFixed(1)),
        // zero line
        h("line", {
          x1: zeroX, y1: PAD.t - 8, x2: zeroX, y2: H - PAD.b,
          stroke: "var(--line-strong)", strokeDasharray: "3 4",
        }),
        rows.map((r, i) => {
          const yRow = PAD.t + i * rowH + rowH / 2;
          const isNull = r.ci_low <= 0 && r.ci_high >= 0;
          const color = isNull ? "var(--muted)" : r.effect > 0 ? "var(--accent)" : "var(--danger)";
          return h(
            "g",
            { key: `esf-${i}` },
            h("text", {
              x: PAD.l - 10, y: yRow + 4, fontSize: 11, fill: "var(--ink)", textAnchor: "end",
            }, r.label),
            h("line", {
              x1: x(r.ci_low), y1: yRow, x2: x(r.ci_high), y2: yRow,
              stroke: color, strokeWidth: 2,
            }),
            h("line", { x1: x(r.ci_low), y1: yRow - 4, x2: x(r.ci_low), y2: yRow + 4, stroke: color, strokeWidth: 2 }),
            h("line", { x1: x(r.ci_high), y1: yRow - 4, x2: x(r.ci_high), y2: yRow + 4, stroke: color, strokeWidth: 2 }),
            h("circle", { cx: x(r.effect), cy: yRow, r: 4, fill: color }),
          );
        }),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
