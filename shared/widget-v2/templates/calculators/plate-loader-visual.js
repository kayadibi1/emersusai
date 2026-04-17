import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Stylized plate stack per side — thin vertical bars stacked from bar to tip,
// colored by size. Target load printed above the bar.

const PLATE_COLOR = {
  25: "#dc2626", 20: "#2563eb", 15: "#eab308", 10: "#16a34a", 5: "#a3a3a3",
  2.5: "#e9a8a4", 1.25: "#fed7aa", "2.5": "#e9a8a4", "1.25": "#fed7aa",
};

export function PlateLoaderVisual({ title, display_width, summary, follow_up_chips, data }) {
  const { target_kg, bar_kg, plates_per_side } = data;
  const sorted = plates_per_side.slice().sort((a, b) => b.kg - a.kg);
  const perSide = (target_kg - bar_kg) / 2;
  const W = 520, H = 200, CY = 100;
  const BAR_Y = CY - 4;
  const COLLAR_X = 260;

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-pl-target" },
      h("b", null, `${target_kg} kg`), ` · bar ${bar_kg} kg · per side ${perSide} kg`,
    ),
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-pl-svg", preserveAspectRatio: "xMidYMid meet" },
      // bar sleeve
      h("rect", { x: 40, y: BAR_Y, width: 440, height: 8, fill: "var(--muted)", rx: 2 }),
      // collar
      h("rect", { x: COLLAR_X - 4, y: BAR_Y - 6, width: 6, height: 20, fill: "var(--dim)" }),
      // plates — loaded from collar outward on the right side (mirrored left)
      (() => {
        let xR = COLLAR_X + 6;
        const plateEls = [];
        for (const p of sorted) {
          for (let c = 0; c < p.count; c++) {
            const pHeight = Math.min(180, 50 + p.kg * 5);
            const pWidth = 12 + p.kg * 0.3;
            plateEls.push(h("rect", { key: `pR-${p.kg}-${c}`, x: xR, y: CY - pHeight / 2, width: pWidth, height: pHeight, fill: PLATE_COLOR[p.kg] || "var(--accent)", stroke: "#0a0a0b", strokeWidth: 0.5, rx: 2 }));
            plateEls.push(h("text", { key: `lR-${p.kg}-${c}`, x: xR + pWidth / 2, y: CY + 3, fontSize: 9, fill: "#0a0a0b", textAnchor: "middle", fontWeight: 700 }, `${p.kg}`));
            xR += pWidth + 2;
          }
        }
        return plateEls;
      })(),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
