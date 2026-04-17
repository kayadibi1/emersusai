import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Bar chart of session RPE counts. Target RPE gets a vertical highlight line
// so "am I consistently at the right effort?" reads instantly.

export function RpeHistogram({ title, display_width, summary, follow_up_chips, data }) {
  const { buckets, target_rpe } = data;
  const sorted = buckets.slice().sort((a, b) => a.rpe - b.rpe);
  const maxCount = Math.max(1, ...sorted.map((b) => b.count));
  const W = 520, H = 200, PAD = { t: 14, r: 14, b: 32, l: 36 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const barW = plotW / sorted.length;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-rpe-svg", preserveAspectRatio: "xMinYMid meet" },
      target_rpe != null ? (() => {
        const idx = sorted.findIndex((b) => b.rpe === target_rpe);
        const xLine = idx >= 0 ? PAD.l + barW * (idx + 0.5) : null;
        return xLine != null ? h("line", { x1: xLine, y1: PAD.t, x2: xLine, y2: H - PAD.b, stroke: "var(--accent)", strokeDasharray: "3 3" }) : null;
      })() : null,
      sorted.map((b, i) => {
        const barH = (b.count / maxCount) * plotH;
        const isTarget = b.rpe === target_rpe;
        return h("g", { key: `b-${i}` },
          h("rect", {
            x: PAD.l + barW * i + 2, y: H - PAD.b - barH,
            width: barW - 4, height: barH, rx: 2,
            fill: isTarget ? "var(--accent)" : "var(--accent-soft)",
            stroke: "var(--accent-line)",
          }),
          h("text", { x: PAD.l + barW * (i + 0.5), y: H - PAD.b + 14, fontSize: 10, fill: "var(--muted)", textAnchor: "middle" }, `${b.rpe}`),
          b.count > 0 ? h("text", { x: PAD.l + barW * (i + 0.5), y: H - PAD.b - barH - 4, fontSize: 9, fill: "var(--ink)", textAnchor: "middle" }, `${b.count}`) : null,
        );
      }),
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
      h("text", { x: (PAD.l + W - PAD.r) / 2, y: H - 4, fontSize: 10, fill: "var(--muted)", textAnchor: "middle" }, "RPE"),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
