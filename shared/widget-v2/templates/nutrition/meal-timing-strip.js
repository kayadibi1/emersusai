import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Three rows around a workout anchor: logged meals (top), recommended
// timing window (middle), and elapsed-hours axis (bottom). Workout is the
// vertical anchor so pre/post relationships read at a glance.

export function MealTimingStrip({ title, display_width, summary, follow_up_chips, data }) {
  const { workout_hour, logged, recommended_window } = data;
  const allHours = [...logged.map((m) => m.hour), workout_hour, ...(recommended_window ? [recommended_window.start, recommended_window.end] : [])];
  const minH = Math.floor(Math.min(...allHours)) - 1;
  const maxH = Math.ceil(Math.max(...allHours)) + 1;
  const W = 640, H = 160, PAD = { t: 20, r: 14, b: 28, l: 14 };
  const plotW = W - PAD.l - PAD.r;
  const x = (hr) => PAD.l + ((hr - minH) / (maxH - minH)) * plotW;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-mts-svg", preserveAspectRatio: "xMinYMid meet" },
      // workout anchor
      h("line", { x1: x(workout_hour), y1: PAD.t - 6, x2: x(workout_hour), y2: H - PAD.b + 6, stroke: "var(--accent)", strokeWidth: 2 }),
      h("text", { x: x(workout_hour), y: PAD.t - 10, fontSize: 10, fill: "var(--accent)", textAnchor: "middle", fontWeight: 600 }, "workout"),
      // recommended window
      recommended_window ? h("rect", {
        x: x(recommended_window.start), y: 40,
        width: x(recommended_window.end) - x(recommended_window.start), height: 22,
        fill: "var(--accent-soft)", stroke: "var(--accent-line)",
      }) : null,
      recommended_window ? h("text", { x: (x(recommended_window.start) + x(recommended_window.end)) / 2, y: 56, fontSize: 10, fill: "var(--accent)", textAnchor: "middle" }, "recommended") : null,
      // logged meals
      logged.map((m, i) => h("g", { key: `m-${i}` },
        h("circle", { cx: x(m.hour), cy: 92, r: 8, fill: "var(--chart-series-3)" }),
        h("text", { x: x(m.hour), y: 110, fontSize: 9, fill: "var(--ink)", textAnchor: "middle" }, m.label),
      )),
      // axis
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
      [minH, Math.round((minH + maxH) / 2), maxH].map((hr, i) => h("text", { key: `t-${i}`, x: x(hr), y: H - 6, fontSize: 9, fill: "var(--muted)", textAnchor: "middle" }, `${hr}:00`)),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
