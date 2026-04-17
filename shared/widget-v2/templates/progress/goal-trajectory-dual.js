import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Actual (solid) + projected (shaded cone from low to high) + goal-zone
// horizontal ribbon. Instant "am I on track?" read.

export function GoalTrajectoryDual({ title, display_width, summary, follow_up_chips, data }) {
  const { actual, projected, goal_value } = data;
  const allY = [...actual.map((p) => p.value), ...projected.flatMap((p) => [p.low, p.high]), goal_value];
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const ordered = [...actual, ...projected].sort((a, b) => a.date.localeCompare(b.date));
  const W = 640, H = 240, PAD = { t: 14, r: 14, b: 36, l: 44 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const iOf = (date) => ordered.findIndex((p) => p.date === date);
  const x = (date) => PAD.l + (iOf(date) / Math.max(1, ordered.length - 1)) * plotW;
  const y = (v) => PAD.t + (1 - (v - minY) / Math.max(1e-9, maxY - minY)) * plotH;

  const actualPath = actual.slice().sort((a, b) => a.date.localeCompare(b.date))
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const proj = projected.slice().sort((a, b) => a.date.localeCompare(b.date));
  const highPath = proj.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.date).toFixed(1)} ${y(p.high).toFixed(1)}`).join(" ");
  const lowPath = proj.slice().reverse().map((p) => `L ${x(p.date).toFixed(1)} ${y(p.low).toFixed(1)}`).join(" ");
  const cone = `${highPath} ${lowPath} Z`;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-gtd-svg", preserveAspectRatio: "xMinYMid meet" },
      h("line", { x1: PAD.l, y1: y(goal_value), x2: W - PAD.r, y2: y(goal_value), stroke: "var(--accent)", strokeDasharray: "4 4" }),
      h("text", { x: W - PAD.r, y: y(goal_value) - 4, fontSize: 9, fill: "var(--accent)", textAnchor: "end" }, `goal ${goal_value}`),
      h("path", { d: cone, fill: "var(--accent-soft)", stroke: "var(--accent-line)" }),
      h("path", { d: actualPath, stroke: "var(--accent)", strokeWidth: 2.5, fill: "none" }),
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
