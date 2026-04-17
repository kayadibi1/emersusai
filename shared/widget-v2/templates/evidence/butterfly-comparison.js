import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Pros on the right, cons on the left, both extending from a center axis.
// Bar length = magnitude of the point. Subject printed at the center.

export function ButterflyComparison({ title, display_width, summary, follow_up_chips, data }) {
  const { subject, pros, cons } = data;
  const maxMag = Math.max(...pros.map((p) => p.magnitude), ...cons.map((c) => c.magnitude));
  const W = 640, ROW_H = 24, PAD = { t: 16, b: 16 };
  const H = PAD.t + PAD.b + Math.max(pros.length, cons.length) * ROW_H;
  const CENTER = W / 2;
  const side = (W - 160) / 2;
  const bar = (mag) => (mag / maxMag) * side;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-bc-svg", preserveAspectRatio: "xMinYMid meet" },
      h("text", { x: CENTER, y: PAD.t - 2, fontSize: 11, fill: "var(--accent)", textAnchor: "middle", fontWeight: 700, letterSpacing: "0.1em" }, subject),
      h("line", { x1: CENTER, y1: PAD.t + 4, x2: CENTER, y2: H - PAD.b, stroke: "var(--line-strong)" }),
      cons.map((c, i) =>
        h("g", { key: `c-${i}` },
          h("rect", { x: CENTER - bar(c.magnitude), y: PAD.t + 4 + i * ROW_H, width: bar(c.magnitude), height: ROW_H - 6, fill: "var(--danger)", opacity: 0.7 }),
          h("text", { x: CENTER - 8, y: PAD.t + 4 + i * ROW_H + 14, fontSize: 10, fill: "var(--ink)", textAnchor: "end" }, c.label),
        )
      ),
      pros.map((p, i) =>
        h("g", { key: `p-${i}` },
          h("rect", { x: CENTER, y: PAD.t + 4 + i * ROW_H, width: bar(p.magnitude), height: ROW_H - 6, fill: "var(--accent)", opacity: 0.75 }),
          h("text", { x: CENTER + 8, y: PAD.t + 4 + i * ROW_H + 14, fontSize: 10, fill: "var(--ink)" }, p.label),
        )
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
