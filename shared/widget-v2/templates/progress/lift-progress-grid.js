import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// 1-9 card grid: per lift a current number, delta %, sparkline, and an
// optional plateau flag. Quick gym-bag dashboard.

function Sparkline({ values }) {
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const W = 100, H = 24;
  const path = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / span) * H;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-lpg-spark", preserveAspectRatio: "none" },
    h("path", { d: path, stroke: "var(--accent)", strokeWidth: 1.5, fill: "none" }),
  );
}

export function LiftProgressGrid({ title, display_width, summary, follow_up_chips, data }) {
  const { lifts } = data;
  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-lpg-grid" },
      lifts.map((l, i) =>
        h("div", { key: `l-${i}`, className: "wv-lpg-card" },
          h("div", { className: "wv-lpg-name" }, l.name),
          h("div", { className: "wv-lpg-current" }, l.current),
          h("div", { className: `wv-lpg-delta ${l.delta_pct >= 0 ? "up" : "down"}` }, `${l.delta_pct > 0 ? "+" : ""}${l.delta_pct.toFixed(1)}%`),
          h(Sparkline, { values: l.sparkline }),
          l.plateau ? h("div", { className: "wv-lpg-plateau" }, "plateau") : null,
        )
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
