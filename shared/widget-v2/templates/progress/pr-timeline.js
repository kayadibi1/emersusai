import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// SVG timeline with one dot per session keyed by date; Y axis is estimated
// 1RM via Epley (load × (1 + reps/30)). Dots sized by reps so the "how
// hard was this" signal isn't lost when the user scales up reps.

function estimatedOneRM(load, reps) {
  return load * (1 + reps / 30);
}

export function PRTimeline({ title, display_width, summary, follow_up_chips, data }) {
  const { lift, unit, entries } = data;
  const sorted = entries.slice().sort((a, b) => a.date.localeCompare(b.date));
  const values = sorted.map((e) => estimatedOneRM(e.load, e.reps));
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const vRange = Math.max(1, maxV - minV);
  const W = 600, H = 180, PAD = { t: 14, r: 14, b: 28, l: 40 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const firstDate = new Date(sorted[0].date).getTime();
  const lastDate = new Date(sorted[sorted.length - 1].date).getTime();
  const dateRange = Math.max(1, lastDate - firstDate);
  const x = (date) => PAD.l + ((new Date(date).getTime() - firstDate) / dateRange) * plotW;
  const y = (v) => PAD.t + (1 - (v - minV) / vRange) * plotH;

  const path = sorted
    .map((e, i) => `${i === 0 ? "M" : "L"} ${x(e.date).toFixed(1)} ${y(values[i]).toFixed(1)}`)
    .join(" ");

  const yTicks = [minV, (minV + maxV) / 2, maxV].map((v) => ({ v: Math.round(v), y: y(v) }));

  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-prt-body" },
      h(
        "div",
        { className: "wv-prt-head" },
        h("span", { className: "wv-prt-lift" }, lift),
        h("span", { className: "wv-prt-meta" }, `${sorted.length} entries · e1RM in ${unit}`),
      ),
      h(
        "svg",
        { viewBox: `0 0 ${W} ${H}`, className: "wv-prt-svg", preserveAspectRatio: "xMinYMid meet" },
        yTicks.map((t, i) =>
          h(
            React.Fragment,
            { key: `yt-${i}` },
            h("line", { x1: PAD.l, x2: W - PAD.r, y1: t.y, y2: t.y, stroke: "var(--grid-line)", strokeWidth: 1 }),
            h("text", { x: PAD.l - 6, y: t.y + 4, textAnchor: "end", fontSize: 10, fill: "var(--muted)" }, `${t.v}`),
          ),
        ),
        h("path", { d: path, stroke: "var(--accent)", strokeWidth: 2, fill: "none" }),
        sorted.map((e, i) =>
          h(
            "g",
            { key: `d-${i}` },
            h("circle", {
              cx: x(e.date), cy: y(values[i]),
              r: 3 + Math.min(4, e.reps * 0.4),
              fill: "var(--accent)",
            }),
          ),
        ),
        // x-axis labels: first + last date
        h("text", { x: PAD.l, y: H - 8, fontSize: 10, fill: "var(--muted)" }, sorted[0].date),
        h("text", { x: W - PAD.r, y: H - 8, fontSize: 10, fill: "var(--muted)", textAnchor: "end" }, sorted[sorted.length - 1].date),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
