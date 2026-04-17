import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// N (log scale) × duration scatter, with design shape encoding. Big n +
// long duration (top-right) = strongest evidence visually.

const DESIGN_SHAPE = { RCT: "circle", meta: "square", cohort: "triangle", review: "diamond", other: "x" };

export function StudyQualityMatrix({ title, display_width, summary, follow_up_chips, data }) {
  const { quality_studies: studies } = data;
  const W = 600, H = 300, PAD = { t: 20, r: 14, b: 44, l: 46 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const maxN = Math.max(...studies.map((s) => s.n));
  const maxD = Math.max(...studies.map((s) => s.duration_weeks));
  const x = (n) => PAD.l + (Math.log10(Math.max(1, n)) / Math.log10(Math.max(10, maxN))) * plotW;
  const y = (d) => PAD.t + (1 - d / Math.max(1, maxD)) * plotH;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-sqm-svg", preserveAspectRatio: "xMinYMid meet" },
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
      h("line", { x1: PAD.l, y1: PAD.t, x2: PAD.l, y2: H - PAD.b, stroke: "var(--line)" }),
      h("text", { x: (PAD.l + W - PAD.r) / 2, y: H - 24, fontSize: 10, fill: "var(--muted)", textAnchor: "middle" }, "participants (log)"),
      h("text", { x: 14, y: (PAD.t + H - PAD.b) / 2, fontSize: 10, fill: "var(--muted)", textAnchor: "middle", transform: `rotate(-90 14 ${(PAD.t + H - PAD.b) / 2})` }, "weeks"),
      studies.map((s, i) => {
        const cx = x(s.n), cy = y(s.duration_weeks);
        const color = "var(--accent)";
        const shape = DESIGN_SHAPE[s.design];
        const R = 6;
        let marker;
        if (shape === "circle") marker = h("circle", { cx, cy, r: R, fill: color });
        else if (shape === "square") marker = h("rect", { x: cx - R, y: cy - R, width: 2 * R, height: 2 * R, fill: color });
        else if (shape === "triangle") marker = h("polygon", { points: `${cx},${cy - R} ${cx + R},${cy + R} ${cx - R},${cy + R}`, fill: color });
        else if (shape === "diamond") marker = h("polygon", { points: `${cx},${cy - R} ${cx + R},${cy} ${cx},${cy + R} ${cx - R},${cy}`, fill: color });
        else marker = h("text", { x: cx, y: cy + 4, fontSize: 14, fill: color, textAnchor: "middle", fontWeight: 700 }, "×");
        return h("g", { key: `s-${i}` },
          marker,
          h("text", { x: cx + R + 4, y: cy + 4, fontSize: 9, fill: "var(--muted)" }, s.label),
        );
      }),
      // legend
      h("text", { x: PAD.l, y: H - 4, fontSize: 9, fill: "var(--muted)" }, "● RCT  ■ Meta  ▲ Cohort  ◆ Review"),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
