import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// 2-4 curves (whey / casein / soy / pea style) over hours, with a peak
// marker per curve so the "fast vs slow" story is instantly visible.

export function AbsorptionMultiProtein({ title, display_width, summary, follow_up_chips, data }) {
  const { curves, total_hours } = data;
  const allY = curves.flatMap((c) => c.points.map((p) => p.amount));
  const maxY = Math.max(1, ...allY);
  const W = 640, H = 240, PAD = { t: 14, r: 14, b: 32, l: 48 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const x = (hr) => PAD.l + (hr / total_hours) * plotW;
  const y = (amt) => PAD.t + (1 - amt / maxY) * plotH;
  const colors = ["var(--chart-series-1)", "var(--chart-series-2)", "var(--chart-series-3)", "var(--chart-series-4)"];

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-amp-svg", preserveAspectRatio: "xMinYMid meet" },
      curves.map((c, i) => {
        const path = c.points.map((p, j) => `${j === 0 ? "M" : "L"} ${x(p.hour).toFixed(1)} ${y(p.amount).toFixed(1)}`).join(" ");
        return h("g", { key: `c-${i}` },
          h("path", { d: path, stroke: colors[i % 4], strokeWidth: 2, fill: "none" }),
          c.peak_hour != null ? h("circle", {
            cx: x(c.peak_hour),
            cy: y(c.points.find((pt) => pt.hour === c.peak_hour)?.amount || maxY),
            r: 4, fill: colors[i % 4],
          }) : null,
        );
      }),
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
      h("line", { x1: PAD.l, y1: PAD.t, x2: PAD.l, y2: H - PAD.b, stroke: "var(--line)" }),
      h("text", { x: PAD.l, y: H - 6, fontSize: 10, fill: "var(--muted)" }, "0 h"),
      h("text", { x: W - PAD.r, y: H - 6, fontSize: 10, fill: "var(--muted)", textAnchor: "end" }, `${total_hours} h`),
    ),
    h("div", { className: "wv-amp-legend" },
      curves.map((c, i) =>
        h("span", { key: `lg-${i}`, className: "wv-amp-legend-item" },
          h("i", { className: "wv-amp-swatch", style: { background: colors[i % 4] } }),
          c.label,
          c.peak_hour != null ? h("span", { className: "wv-amp-peak" }, ` peak ${c.peak_hour}h`) : null,
        )
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
