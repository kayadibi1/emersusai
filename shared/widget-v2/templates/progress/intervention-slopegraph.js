import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Two-column before/after slopegraph. Each person = a line; slope sign
// color-codes the change (up = accent, down = danger, flat = muted).

export function InterventionSlopegraph({ title, display_width, summary, follow_up_chips, data }) {
  const { before_label, after_label, people } = data;
  const all = people.flatMap((p) => [p.before, p.after]);
  const minV = Math.min(...all), maxV = Math.max(...all);
  const W = 520, H = 300, PAD = { t: 40, r: 14, b: 20, l: 14 };
  const xL = PAD.l + 120, xR = W - PAD.r - 120;
  const y = (v) => PAD.t + (1 - (v - minV) / Math.max(1e-9, maxV - minV)) * (H - PAD.t - PAD.b);

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-isg-svg", preserveAspectRatio: "xMinYMid meet" },
      h("text", { x: xL, y: PAD.t - 10, fontSize: 11, fill: "var(--muted)", textAnchor: "middle", fontWeight: 600 }, before_label),
      h("text", { x: xR, y: PAD.t - 10, fontSize: 11, fill: "var(--muted)", textAnchor: "middle", fontWeight: 600 }, after_label),
      people.map((p, i) => {
        const color = p.after > p.before ? "var(--accent)" : p.after < p.before ? "var(--danger)" : "var(--muted)";
        return h("g", { key: `p-${i}` },
          h("line", { x1: xL, y1: y(p.before), x2: xR, y2: y(p.after), stroke: color, strokeWidth: 1.5, opacity: 0.8 }),
          h("circle", { cx: xL, cy: y(p.before), r: 4, fill: color }),
          h("circle", { cx: xR, cy: y(p.after), r: 4, fill: color }),
          h("text", { x: xL - 8, y: y(p.before) + 3, fontSize: 9, fill: "var(--ink)", textAnchor: "end" }, `${p.label} ${p.before}`),
          h("text", { x: xR + 8, y: y(p.after) + 3, fontSize: 9, fill: "var(--ink)" }, p.after),
        );
      }),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
