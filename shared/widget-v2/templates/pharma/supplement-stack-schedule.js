import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Daily lane chart — one supplement per row; dose pills placed at their `hour`
// across a 0-23h time axis. Lets users scan overlapping stacks at a glance.

export function SupplementStackSchedule({ title, display_width, summary, follow_up_chips, data }) {
  const { supplements, day_label } = data;
  const HOURS = 24;
  const W = 640, ROW_H = 32, LABEL_W = 110, PAD_R = 16;
  const plotW = W - LABEL_W - PAD_R;
  const H = ROW_H * (supplements.length + 1) + 12;
  const hourX = (h) => LABEL_W + (h / HOURS) * plotW;

  return h(CardFrame, { title, summary, display_width },
    day_label ? h("div", { className: "wv-sss-day" }, day_label) : null,
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-sss-svg", preserveAspectRatio: "xMinYMid meet" },
      // hour grid lines
      [0, 6, 12, 18, 24].map((hr) =>
        h(React.Fragment, { key: `g-${hr}` },
          h("line", { x1: hourX(hr), y1: 8, x2: hourX(hr), y2: H - 4, stroke: "var(--grid-line)" }),
          h("text", { x: hourX(hr), y: H - 2, fontSize: 9, fill: "var(--muted)", textAnchor: hr === 0 ? "start" : hr === 24 ? "end" : "middle" }, `${hr}:00`),
        ),
      ),
      supplements.map((s, i) => {
        const rowY = 16 + i * ROW_H;
        return h("g", { key: `s-${i}` },
          h("text", { x: LABEL_W - 8, y: rowY + 4, fontSize: 11, fill: "var(--ink)", textAnchor: "end" }, s.name),
          h("line", { x1: LABEL_W, y1: rowY, x2: W - PAD_R, y2: rowY, stroke: "var(--line)", strokeDasharray: "2 3" }),
          ...s.doses.map((d, j) =>
            h("g", { key: `d-${i}-${j}` },
              h("rect", {
                x: hourX(d.hour) - 14, y: rowY - 10,
                width: 28, height: 20, rx: 10,
                fill: "var(--accent-soft)", stroke: "var(--accent)", strokeWidth: 1,
              }),
              h("text", { x: hourX(d.hour), y: rowY + 4, fontSize: 9, fill: "var(--accent)", textAnchor: "middle", fontWeight: 600 }, `${d.amount}${d.unit}`),
            ),
          ),
        );
      }),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
