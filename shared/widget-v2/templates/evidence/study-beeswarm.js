import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Every study as a dot positioned by effect, jittered vertically to avoid
// overlap. Zero line dashed. Simpler than forest_plot when you just want
// to show the spread of effect estimates without CIs.

export function StudyBeeswarm({ title, display_width, summary, follow_up_chips, data }) {
  const { outcome, beeswarm_dots: dots } = data;
  const minE = Math.min(0, ...dots.map((d) => d.effect));
  const maxE = Math.max(...dots.map((d) => d.effect));
  const W = 640, H = 220, PAD = { t: 30, r: 14, b: 36, l: 14 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const x = (e) => PAD.l + ((e - minE) / Math.max(1e-9, maxE - minE)) * plotW;
  // deterministic jitter using label hash
  const hash = (s) => Array.from(s).reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const jitter = (label) => ((hash(label) % 100) / 100 - 0.5) * (plotH - 20);

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-bs-outcome" }, outcome),
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-bs-svg", preserveAspectRatio: "xMinYMid meet" },
      h("line", { x1: x(0), y1: PAD.t, x2: x(0), y2: H - PAD.b, stroke: "var(--muted)", strokeDasharray: "3 4" }),
      h("line", { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: "var(--line)" }),
      dots.map((d, i) => {
        const cx = x(d.effect);
        const cy = PAD.t + plotH / 2 + jitter(d.label);
        const color = d.effect > 0 ? "var(--accent)" : d.effect < 0 ? "var(--danger)" : "var(--muted)";
        return h("circle", { key: `d-${i}`, cx, cy, r: 5, fill: color, opacity: 0.8 });
      }),
      h("text", { x: x(0), y: PAD.t - 8, fontSize: 9, fill: "var(--muted)", textAnchor: "middle" }, "0"),
      h("text", { x: PAD.l, y: H - 14, fontSize: 9, fill: "var(--muted)" }, minE.toFixed(2)),
      h("text", { x: W - PAD.r, y: H - 14, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, maxE.toFixed(2)),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
