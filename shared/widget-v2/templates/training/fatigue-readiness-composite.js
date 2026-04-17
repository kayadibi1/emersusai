import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Big readiness ring + contributing signal bars (HRV, RHR, sleep, soreness,
// mood, etc.). 0-100 scale uniformly. Quick "go or deload" gut-check card.

export function FatigueReadinessComposite({ title, display_width, summary, follow_up_chips, data }) {
  const { readiness_score, signals } = data;
  const CIRC = 2 * Math.PI * 48;
  const dashed = (readiness_score / 100) * CIRC;
  const color = readiness_score >= 75 ? "var(--chart-series-1)" : readiness_score >= 50 ? "var(--warning)" : "var(--danger)";

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-frc-body" },
      h("svg", { viewBox: "0 0 120 120", width: 120, height: 120, className: "wv-frc-ring" },
        h("circle", { cx: 60, cy: 60, r: 48, fill: "none", stroke: "var(--surface)", strokeWidth: 12 }),
        h("circle", {
          cx: 60, cy: 60, r: 48, fill: "none", stroke: color, strokeWidth: 12,
          strokeDasharray: `${dashed} ${CIRC - dashed}`, transform: "rotate(-90 60 60)", strokeLinecap: "round",
        }),
        h("text", { x: 60, y: 56, textAnchor: "middle", fontSize: 28, fontWeight: 700, fill: "var(--ink)" }, `${readiness_score}`),
        h("text", { x: 60, y: 74, textAnchor: "middle", fontSize: 9, fill: "var(--muted)", letterSpacing: "0.14em" }, "READINESS"),
      ),
      h("div", { className: "wv-frc-signals" },
        signals.map((s, i) =>
          h("div", { key: `s-${i}`, className: "wv-frc-signal" },
            h("div", { className: "wv-frc-signal-row" },
              h("span", { className: "wv-frc-signal-name" }, s.name),
              h("span", { className: "wv-frc-signal-score" }, `${s.score}`),
            ),
            h("div", { className: "wv-frc-signal-track" },
              h("div", { className: "wv-frc-signal-bar", style: { width: `${s.score}%`, background: s.score >= 75 ? "var(--chart-series-1)" : s.score >= 50 ? "var(--warning)" : "var(--danger)" } }),
            ),
          )
        ),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
