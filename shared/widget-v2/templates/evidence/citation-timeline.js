import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Studies plotted by publication year along a horizontal axis; dot radius
// and opacity track citation count so "which findings did the field
// actually pay attention to" is visually obvious.

export function CitationTimeline({ title, display_width, summary, follow_up_chips, data }) {
  const { timeline_studies: studies } = data;
  const years = studies.map((s) => s.year);
  const minY = Math.min(...years), maxY = Math.max(...years);
  const maxCites = Math.max(...studies.map((s) => s.citations));
  const W = 640, H = 180, PAD = { t: 30, r: 16, b: 28, l: 16 };
  const plotW = W - PAD.l - PAD.r;
  const x = (yr) => PAD.l + ((yr - minY) / Math.max(1, maxY - minY)) * plotW;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-ctl-svg", preserveAspectRatio: "xMinYMid meet" },
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
      [minY, Math.floor((minY + maxY) / 2), maxY].map((yr, i) =>
        h("text", { key: `y-${i}`, x: x(yr), y: H - 12, fontSize: 9, fill: "var(--muted)", textAnchor: "middle" }, `${yr}`)
      ),
      studies.map((s, i) => {
        const cx = x(s.year);
        const cy = H - PAD.b - 22;
        const r = 4 + (s.citations / Math.max(1, maxCites)) * 12;
        const op = 0.35 + (s.citations / Math.max(1, maxCites)) * 0.6;
        return h("g", { key: `s-${i}` },
          h("circle", { cx, cy, r, fill: "var(--accent)", opacity: op }),
          s.citations > maxCites * 0.5 ? h("text", { x: cx, y: cy - r - 4, fontSize: 9, fill: "var(--ink)", textAnchor: "middle", fontWeight: 600 }, s.label) : null,
        );
      }),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
