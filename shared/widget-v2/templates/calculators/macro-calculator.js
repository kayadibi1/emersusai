import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Protein-anchored macro split card. Shows the inputs (kcal target,
// protein g/kg, fat %), then the computed grams per macro alongside a
// mini donut by kcal share. Read-only display — real interactivity
// lands when Slider primitive is wired up.

export function MacroCalculator({ title, display_width, summary, follow_up_chips, data }) {
  const { kcal_total, protein_g_per_kg, fat_pct, body_weight_kg, protein_g, fat_g, carbs_g } = data;
  const pKcal = protein_g * 4, fKcal = fat_g * 9, cKcal = carbs_g * 4;
  const total = pKcal + fKcal + cKcal || 1;
  const CIRC = 2 * Math.PI * 40;
  const segs = [
    { g: protein_g, k: pKcal, name: "Protein", cssVar: "--protein" },
    { g: carbs_g, k: cKcal, name: "Carbs", cssVar: "--carbs" },
    { g: fat_g, k: fKcal, name: "Fat", cssVar: "--fat" },
  ];
  let offset = 0;
  const arcs = segs.map((s) => {
    const frac = s.k / total;
    const dash = frac * CIRC;
    const start = -offset;
    offset += dash;
    return { ...s, dashStr: `${dash} ${CIRC - dash}`, dashOffset: start };
  });

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-mc-body" },
      h("div", { className: "wv-mc-inputs" },
        h("span", null, `${kcal_total} kcal`),
        h("span", null, `${protein_g_per_kg} g/kg protein`),
        h("span", null, `${Math.round(fat_pct * 100)}% fat kcal`),
        h("span", null, `${body_weight_kg} kg BW`),
      ),
      h("div", { className: "wv-mc-grid" },
        h("svg", { viewBox: "0 0 100 100", width: 100, height: 100, className: "wv-mc-ring" },
          h("circle", { cx: 50, cy: 50, r: 40, fill: "none", stroke: "rgba(128,128,128,0.12)", strokeWidth: 12 }),
          ...arcs.map((a, i) => h("circle", {
            key: `a-${i}`, cx: 50, cy: 50, r: 40, fill: "none",
            stroke: `var(${a.cssVar})`, strokeWidth: 12,
            strokeDasharray: a.dashStr, strokeDashoffset: a.dashOffset,
            transform: "rotate(-90 50 50)",
          })),
          h("text", { x: 50, y: 50, textAnchor: "middle", fontSize: 14, fontWeight: 700, fill: "var(--ink)" }, kcal_total),
          h("text", { x: 50, y: 64, textAnchor: "middle", fontSize: 7, fill: "var(--muted)" }, "kcal"),
        ),
        h("ul", { className: "wv-mc-legend" },
          segs.map((s, i) =>
            h("li", { key: `lg-${i}` },
              h("i", { style: { background: `var(${s.cssVar})` } }),
              h("span", { className: "wv-mc-leg-name" }, s.name),
              h("span", { className: "wv-mc-leg-val" }, `${s.g}g`),
              h("span", { className: "wv-mc-leg-kcal" }, ` · ${s.k} kcal`),
            )
          ),
        ),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
