import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Classic forest plot: per-study squares (sized by √n) with CI whiskers
// plus a pooled diamond at the bottom. Zero line dashed.

export function ForestPlot({ title, display_width, summary, follow_up_chips, data }) {
  const { outcome_label, x_axis, fp_studies, pooled } = data;
  const W = 640, rowH = 28;
  const H = 50 + (fp_studies.length + 1) * rowH;
  const PAD = { l: 200, r: 16, t: 20 };
  const plotW = W - PAD.l - PAD.r;
  const x = (v) => PAD.l + ((v - x_axis.min) / Math.max(1e-9, x_axis.max - x_axis.min)) * plotW;
  const maxN = Math.max(...fp_studies.map((s) => s.n));

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-fp-outcome" }, outcome_label),
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-fp-svg", preserveAspectRatio: "xMinYMid meet" },
      h("line", { x1: x(0), y1: PAD.t, x2: x(0), y2: H - 20, stroke: "var(--line-strong)", strokeDasharray: "3 3" }),
      h("text", { x: PAD.l, y: PAD.t - 6, fontSize: 9, fill: "var(--muted)" }, x_axis.min.toFixed(2)),
      h("text", { x: W - PAD.r, y: PAD.t - 6, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, x_axis.max.toFixed(2)),
      h("text", { x: x(0), y: PAD.t - 6, fontSize: 9, fill: "var(--muted)", textAnchor: "middle" }, "0"),
      fp_studies.map((s, i) => {
        const yRow = PAD.t + 10 + i * rowH;
        const size = 4 + 8 * Math.sqrt(s.n / maxN);
        const color = s.is_outlier ? "var(--warning)" : "var(--accent)";
        return h("g", { key: `s-${i}` },
          h("text", { x: PAD.l - 8, y: yRow + 4, fontSize: 11, fill: "var(--ink)", textAnchor: "end" }, s.label),
          h("line", { x1: x(s.ci_low), y1: yRow, x2: x(s.ci_high), y2: yRow, stroke: color, strokeWidth: 1.5 }),
          h("line", { x1: x(s.ci_low), y1: yRow - 4, x2: x(s.ci_low), y2: yRow + 4, stroke: color }),
          h("line", { x1: x(s.ci_high), y1: yRow - 4, x2: x(s.ci_high), y2: yRow + 4, stroke: color }),
          h("rect", { x: x(s.effect) - size / 2, y: yRow - size / 2, width: size, height: size, fill: color }),
        );
      }),
      // pooled diamond
      (() => {
        const yRow = PAD.t + 10 + fp_studies.length * rowH;
        const cx = x(pooled.effect);
        const lx = x(pooled.ci_low), rx = x(pooled.ci_high);
        return h("g", null,
          h("text", { x: PAD.l - 8, y: yRow + 4, fontSize: 11, fill: "var(--accent)", textAnchor: "end", fontWeight: 700 }, `Pooled (k=${pooled.k})`),
          h("polygon", { points: `${lx},${yRow} ${cx},${yRow - 8} ${rx},${yRow} ${cx},${yRow + 8}`, fill: "var(--accent)" }),
        );
      })(),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
