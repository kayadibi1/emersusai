import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Scatter of session start-hours across dates. Consistent trainers show a
// tight vertical band; chaotic schedules spread vertically.

export function SessionConsistencyStrip({ title, display_width, summary, follow_up_chips, data }) {
  const { sessions } = data;
  const sorted = sessions.slice().sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set(sorted.map((s) => s.date))];
  const W = 640, H = 220, PAD = { t: 14, r: 14, b: 32, l: 40 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const x = (date) => PAD.l + (dates.indexOf(date) / Math.max(1, dates.length - 1)) * plotW;
  const y = (hour) => PAD.t + (hour / 24) * plotH;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-scs-svg", preserveAspectRatio: "xMinYMid meet" },
      [0, 6, 12, 18, 24].map((hr) =>
        h(React.Fragment, { key: `h-${hr}` },
          h("line", { x1: PAD.l, y1: y(hr), x2: W - PAD.r, y2: y(hr), stroke: "var(--grid-line)" }),
          h("text", { x: PAD.l - 4, y: y(hr) + 3, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, `${hr}:00`),
        )
      ),
      sorted.map((s, i) =>
        h("circle", { key: `s-${i}`, cx: x(s.date), cy: y(s.hour), r: 4, fill: "var(--accent)", opacity: 0.8 })
      ),
      h("text", { x: PAD.l, y: H - 14, fontSize: 9, fill: "var(--muted)" }, dates[0]),
      h("text", { x: W - PAD.r, y: H - 14, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, dates[dates.length - 1]),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
