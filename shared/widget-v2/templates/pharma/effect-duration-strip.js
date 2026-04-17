import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// One lozenge per compound showing onset → peak-window → wear-off across a
// shared time axis. Makes "how long will I feel this" visually obvious for
// stimulants, nootropics, pain relievers etc.

export function EffectDurationStrip({ title, display_width, summary, follow_up_chips, data }) {
  const { compounds, total_hours } = data;
  const W = 640, LABEL_W = 130, PAD_R = 14, ROW_H = 32;
  const plotW = W - LABEL_W - PAD_R;
  const H = 30 + compounds.length * ROW_H;
  const x = (hr) => LABEL_W + (hr / total_hours) * plotW;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-eds-svg", preserveAspectRatio: "xMinYMid meet" },
      // hour ticks
      [0, total_hours / 4, total_hours / 2, (total_hours * 3) / 4, total_hours].map((hr, i) =>
        h(React.Fragment, { key: `t-${i}` },
          h("line", { x1: x(hr), y1: 14, x2: x(hr), y2: H - 4, stroke: "var(--grid-line)" }),
          h("text", { x: x(hr), y: H - 2, fontSize: 9, fill: "var(--muted)", textAnchor: i === 0 ? "start" : i === 4 ? "end" : "middle" }, `${Math.round(hr)}h`),
        )
      ),
      compounds.map((c, i) => {
        const rowY = 22 + i * ROW_H;
        return h("g", { key: `c-${i}` },
          h("text", { x: LABEL_W - 8, y: rowY + 4, fontSize: 11, fill: "var(--ink)", textAnchor: "end" }, c.name),
          // onset→peak ramp
          h("rect", {
            x: x(c.onset_hour),
            y: rowY - 6, height: 12,
            width: Math.max(2, x(c.peak_start_hour) - x(c.onset_hour)),
            fill: "var(--accent-soft)", stroke: "var(--accent-line)",
          }),
          // peak window
          h("rect", {
            x: x(c.peak_start_hour),
            y: rowY - 8, height: 16,
            width: Math.max(2, x(c.peak_end_hour) - x(c.peak_start_hour)),
            fill: "var(--accent)", rx: 2,
          }),
          // peak→wearoff taper
          h("rect", {
            x: x(c.peak_end_hour),
            y: rowY - 6, height: 12,
            width: Math.max(2, x(c.wearoff_hour) - x(c.peak_end_hour)),
            fill: "var(--accent-soft)", stroke: "var(--accent-line)",
          }),
        );
      }),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
