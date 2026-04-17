import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Cumulative BMR → TEA → NEAT → TEF → TDEE bar chart. Each step sits atop
// the previous so the composition of total expenditure is visible.

export function TdeeWaterfall({ title, display_width, summary, follow_up_chips, data }) {
  const { bmr, tea, neat, tef, tdee } = data;
  const segments = [
    { label: "BMR", value: bmr },
    { label: "TEA", value: tea },
    { label: "NEAT", value: neat },
    { label: "TEF", value: tef },
  ];
  const W = 560, H = 200, PAD = { t: 14, r: 14, b: 48, l: 40 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const maxY = Math.max(tdee, bmr + tea + neat + tef);
  const colW = plotW / (segments.length + 1);
  const colors = ["var(--chart-series-1)", "var(--chart-series-2)", "var(--chart-series-3)", "var(--chart-series-4)"];
  let cum = 0;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-tdw-svg", preserveAspectRatio: "xMinYMid meet" },
      segments.map((s, i) => {
        const barH = (s.value / maxY) * plotH;
        const baseH = (cum / maxY) * plotH;
        const cx = PAD.l + colW * i + colW / 2;
        cum += s.value;
        return h("g", { key: `s-${i}` },
          h("rect", {
            x: cx - colW / 3, y: H - PAD.b - baseH - barH,
            width: (colW / 3) * 2, height: barH,
            fill: colors[i % 4], rx: 2,
          }),
          h("text", { x: cx, y: H - PAD.b - baseH - barH - 4, fontSize: 10, fill: "var(--ink)", textAnchor: "middle", fontWeight: 600 }, `+${s.value}`),
          h("text", { x: cx, y: H - PAD.b + 16, fontSize: 10, fill: "var(--muted)", textAnchor: "middle" }, s.label),
          h("text", { x: cx, y: H - PAD.b + 28, fontSize: 8, fill: "var(--dim)", textAnchor: "middle", fontStyle: "italic" }, s.value.toFixed(0)),
        );
      }),
      // TDEE total
      (() => {
        const cx = PAD.l + colW * segments.length + colW / 2;
        const barH = (tdee / maxY) * plotH;
        return h("g", null,
          h("rect", { x: cx - colW / 3, y: H - PAD.b - barH, width: (colW / 3) * 2, height: barH, fill: "var(--accent)", rx: 2 }),
          h("text", { x: cx, y: H - PAD.b - barH - 4, fontSize: 11, fill: "var(--accent)", textAnchor: "middle", fontWeight: 700 }, tdee),
          h("text", { x: cx, y: H - PAD.b + 16, fontSize: 10, fill: "var(--accent)", textAnchor: "middle", fontWeight: 700, letterSpacing: "0.06em" }, "TDEE"),
        );
      })(),
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
