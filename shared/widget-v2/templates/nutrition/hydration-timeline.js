import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Cumulative fluid intake vs ideal pace line across a 24h day. Meal and
// workout events get icons at their hour so context is visible.

const EVENT_ICON = { meal: "🍽", workout: "🏋" };

export function HydrationTimeline({ title, display_width, summary, follow_up_chips, data }) {
  const { target_ml, events } = data;
  const sorted = events.slice().sort((a, b) => a.hour - b.hour);
  let cum = 0;
  const cumPoints = sorted.filter((e) => (e.kind || "fluid") === "fluid").map((e) => { cum += e.volume_ml; return { hour: e.hour, total: cum }; });
  const W = 640, H = 220, PAD = { t: 14, r: 14, b: 40, l: 48 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const x = (hr) => PAD.l + (hr / 24) * plotW;
  const yMax = Math.max(target_ml, cum, 1);
  const y = (v) => PAD.t + (1 - v / yMax) * plotH;
  const cumPath = cumPoints.length > 0
    ? `M ${x(0).toFixed(1)} ${y(0).toFixed(1)} ` + cumPoints.map((p) => `L ${x(p.hour).toFixed(1)} ${y(p.total).toFixed(1)}`).join(" ")
    : "";
  const idealPath = `M ${x(0)} ${y(0)} L ${x(24)} ${y(target_ml)}`;

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-ht-svg", preserveAspectRatio: "xMinYMid meet" },
      h("path", { d: idealPath, stroke: "var(--muted)", strokeDasharray: "4 4", strokeWidth: 1.5, fill: "none" }),
      h("path", { d: cumPath, stroke: "var(--accent)", strokeWidth: 2.5, fill: "none" }),
      sorted.filter((e) => e.kind && e.kind !== "fluid").map((e, i) =>
        h("g", { key: `ev-${i}` },
          h("line", { x1: x(e.hour), y1: PAD.t, x2: x(e.hour), y2: H - PAD.b, stroke: "var(--line)", strokeDasharray: "2 3" }),
          h("text", { x: x(e.hour), y: PAD.t + 8, fontSize: 12, textAnchor: "middle" }, EVENT_ICON[e.kind] || "•"),
        )
      ),
      h("text", { x: PAD.l - 8, y: y(target_ml) + 4, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, `${target_ml} ml`),
      h("text", { x: PAD.l, y: H - 22, fontSize: 9, fill: "var(--muted)" }, "0:00"),
      h("text", { x: W - PAD.r, y: H - 22, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, "24:00"),
      h("text", { x: W - PAD.r, y: y(target_ml) - 4, fontSize: 9, fill: "var(--muted)", textAnchor: "end" }, "ideal pace"),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
