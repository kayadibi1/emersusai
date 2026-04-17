import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// 1D dose ladder with three zones (sub-therapeutic / therapeutic / over) and
// a marker for the user's current dose. Useful for "am I dosing in range?"
// style questions when full dose-response data isn't available.

export function DoseThresholdBand({ title, display_width, summary, follow_up_chips, data }) {
  const { compound, dose_unit, current_dose, zones, axis_max } = data;
  const W = 600, H = 120, PAD = { t: 30, r: 24, b: 32, l: 24 };
  const plotW = W - PAD.l - PAD.r;
  const x = (d) => PAD.l + (d / axis_max) * plotW;

  const currentInZone =
    current_dose <= zones.sub_max ? "sub" :
    current_dose < zones.over_min ? "therapeutic" :
    "over";
  const zoneColor = currentInZone === "therapeutic" ? "var(--accent)" : "var(--warning)";

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-dtb-head" },
      h("span", { className: "wv-dtb-compound" }, compound),
      h("span", { className: "wv-dtb-current" }, `current: ${current_dose} ${dose_unit}`),
    ),
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-dtb-svg", preserveAspectRatio: "xMinYMid meet" },
      // zone bands
      h("rect", { x: x(0), y: 48, width: x(zones.sub_max) - x(0), height: 24, fill: "rgba(128,128,128,0.15)" }),
      h("rect", { x: x(zones.therapeutic_min), y: 48, width: x(zones.therapeutic_max) - x(zones.therapeutic_min), height: 24, fill: "var(--accent-soft)" }),
      h("rect", { x: x(zones.over_min), y: 48, width: x(axis_max) - x(zones.over_min), height: 24, fill: "rgba(251,191,36,0.18)" }),
      // zone labels
      h("text", { x: (x(0) + x(zones.sub_max)) / 2, y: 40, fontSize: 9, fill: "var(--muted)", textAnchor: "middle", letterSpacing: "0.08em" }, "SUB"),
      h("text", { x: (x(zones.therapeutic_min) + x(zones.therapeutic_max)) / 2, y: 40, fontSize: 9, fill: "var(--accent)", textAnchor: "middle", letterSpacing: "0.08em", fontWeight: 600 }, "THERAPEUTIC"),
      h("text", { x: (x(zones.over_min) + x(axis_max)) / 2, y: 40, fontSize: 9, fill: "var(--warning)", textAnchor: "middle", letterSpacing: "0.08em" }, "OVER"),
      // current marker
      h("line", { x1: x(current_dose), y1: 42, x2: x(current_dose), y2: 78, stroke: zoneColor, strokeWidth: 3 }),
      h("circle", { cx: x(current_dose), cy: 42, r: 4, fill: zoneColor }),
      // axis
      h("line", { x1: PAD.l, y1: 80, x2: W - PAD.r, y2: 80, stroke: "var(--line)" }),
      h("text", { x: PAD.l, y: H - 10, fontSize: 10, fill: "var(--muted)" }, `0 ${dose_unit}`),
      h("text", { x: W - PAD.r, y: H - 10, fontSize: 10, fill: "var(--muted)", textAnchor: "end" }, `${axis_max} ${dose_unit}`),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
