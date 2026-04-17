import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Dual-direction bar chart — intake extends upward, expenditure downward,
// both from a shared baseline. Net balance (intake − expenditure) printed
// on the right of each row.

export function CalorieBalanceLedger({ title, display_width, summary, follow_up_chips, data }) {
  const { days } = data;
  const maxVal = Math.max(...days.flatMap((d) => [d.intake, d.expenditure]), 1);
  const W = 640, ROW_H = 32, PAD_L = 90, PAD_R = 80;
  const plotW = W - PAD_L - PAD_R;
  const H = 20 + days.length * ROW_H;
  const barW = (v) => (v / maxVal) * plotW / 2;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-cbl-svg", preserveAspectRatio: "xMinYMid meet" },
      h("line", { x1: PAD_L + plotW / 2, y1: 8, x2: PAD_L + plotW / 2, y2: H - 4, stroke: "var(--line)" }),
      days.map((day, i) => {
        const rowY = 14 + i * ROW_H;
        const net = day.intake - day.expenditure;
        const netColor = net > 0 ? "var(--warning)" : net < 0 ? "var(--accent)" : "var(--muted)";
        return h("g", { key: `d-${i}` },
          h("text", { x: PAD_L - 8, y: rowY + 4, fontSize: 10, fill: "var(--muted)", textAnchor: "end" }, day.date),
          h("rect", { x: PAD_L + plotW / 2, y: rowY - 8, width: barW(day.intake), height: 16, fill: "var(--accent-soft)", stroke: "var(--accent-line)" }),
          h("rect", { x: PAD_L + plotW / 2 - barW(day.expenditure), y: rowY - 8, width: barW(day.expenditure), height: 16, fill: "rgba(128,128,128,0.15)", stroke: "var(--line-strong)" }),
          h("text", { x: W - PAD_R + 6, y: rowY + 4, fontSize: 11, fill: netColor, fontWeight: 600 }, `${net > 0 ? "+" : ""}${net}`),
        );
      }),
      h("text", { x: PAD_L + plotW / 4, y: H - 4, fontSize: 9, fill: "var(--muted)", textAnchor: "middle" }, "← expenditure"),
      h("text", { x: PAD_L + (plotW * 3) / 4, y: H - 4, fontSize: 9, fill: "var(--muted)", textAnchor: "middle" }, "intake →"),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
