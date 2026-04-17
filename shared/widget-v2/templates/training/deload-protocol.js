import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Three-column before/during/after card showing sets + RPE targets, overlaid
// with a fatigue curve so the deload's timing relative to accumulation reads
// at a glance.

export function DeloadProtocol({ title, display_width, summary, follow_up_chips, data }) {
  const { before, during, after, fatigue_curve } = data;
  const maxF = Math.max(...fatigue_curve.map((p) => p.value));
  const W = 640, H = 140, PAD = { t: 14, r: 14, b: 20, l: 14 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (i / Math.max(1, fatigue_curve.length - 1)) * plotW;
  const y = (v) => PAD.t + (1 - v / Math.max(1e-9, maxF)) * plotH;
  const path = fatigue_curve.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-dp-cols" },
      [["Before", before], ["During", during], ["After", after]].map(([label, phase]) =>
        h("div", { key: label, className: "wv-dp-col" },
          h("div", { className: "wv-dp-col-label" }, label),
          h("div", { className: "wv-dp-col-metrics" },
            h("span", null, h("b", null, phase.sets), " sets"),
            h("span", null, h("b", null, phase.rpe), " RPE"),
          ),
        )
      ),
    ),
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-dp-svg", preserveAspectRatio: "xMinYMid meet" },
      h("path", { d: path, stroke: "var(--danger)", strokeWidth: 2, strokeDasharray: "5 4", fill: "none" }),
      fatigue_curve.map((p, i) =>
        h("g", { key: `fc-${i}` },
          h("circle", { cx: x(i), cy: y(p.value), r: 3, fill: "var(--danger)" }),
          h("text", { x: x(i), y: H - 6, fontSize: 9, fill: "var(--muted)", textAnchor: "middle" }, p.label),
        )
      ),
      h("text", { x: W - PAD.r, y: PAD.t + 8, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, "fatigue curve"),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
