import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Stacked bar per week, muscles are the stack layers. `weeks[i].muscle_sets`
// is an array of `{muscle, sets}` entries (array-of-entries instead of a
// map — strict-mode OpenAI schemas can't express object-with-dynamic-keys).
// Consistent muscle_order ensures stacking stays readable across weeks.

export function WeeklyVolumeTrendProgress({ title, display_width, summary, follow_up_chips, data }) {
  const { weeks, muscle_order } = data;
  const colors = ["--chart-series-1", "--chart-series-2", "--chart-series-3", "--chart-series-4", "--chart-series-5"];
  const lookup = (w) => {
    const m = {};
    for (const row of w.muscle_sets || []) m[row.muscle] = row.sets;
    return m;
  };
  const totals = weeks.map((w) => { const m = lookup(w); return muscle_order.reduce((s, name) => s + (m[name] || 0), 0); });
  const maxTotal = Math.max(...totals);
  const W = 640, H = 220, PAD = { t: 14, r: 14, b: 36, l: 40 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const barW = plotW / weeks.length;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-wvt-svg", preserveAspectRatio: "xMinYMid meet" },
      weeks.map((w, i) => {
        let offset = 0;
        const m = lookup(w);
        return h("g", { key: `w-${i}` },
          ...muscle_order.map((name, j) => {
            const v = m[name] || 0;
            const hPx = (v / maxTotal) * plotH;
            const y = H - PAD.b - offset - hPx;
            offset += hPx;
            return h("rect", { key: `b-${i}-${j}`, x: PAD.l + barW * i + 3, y, width: barW - 6, height: hPx, fill: `var(${colors[j % 5]})` });
          }),
          h("text", { x: PAD.l + barW * (i + 0.5), y: H - PAD.b + 14, fontSize: 9, fill: "var(--muted)", textAnchor: "middle" }, w.week_start.slice(5)),
        );
      }),
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
    ),
    h("div", { className: "wv-wvt-legend" },
      muscle_order.map((m, j) =>
        h("span", { key: `lg-${j}` },
          h("i", { style: { background: `var(${colors[j % 5]})` } }), m
        )
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
