import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Spec puts macro_ring in F3 (nutrition). F6 calculator's macro_ring variant
// already ships with the same shape but includes a phase + tdee comparison.
// This is the simpler nutrition-family version: three progress bars under
// the ring showing grams-of-target per macro.

export function MacroRingNutrition({ title, display_width, summary, follow_up_chips, data }) {
  const { kcal_total, protein, carbs, fat } = data;
  const total = protein.kcal + carbs.kcal + fat.kcal;
  const CIRC = 2 * Math.PI * 52;
  const segs = [
    { label: "P", grams: protein.grams, kcal: protein.kcal, cssVar: "--protein" },
    { label: "C", grams: carbs.grams, kcal: carbs.kcal, cssVar: "--carbs" },
    { label: "F", grams: fat.grams, kcal: fat.kcal, cssVar: "--fat" },
  ];
  let offset = 0;
  const arcs = segs.map((s) => {
    const frac = total > 0 ? s.kcal / total : 0;
    const dash = frac * CIRC;
    const start = -offset;
    offset += dash;
    return { ...s, dashStr: `${dash} ${CIRC - dash}`, dashOffset: start };
  });

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-mrn-body" },
      h("svg", { viewBox: "0 0 140 140", width: 140, height: 140, className: "wv-mrn-svg" },
        h("circle", { cx: 70, cy: 70, r: 52, fill: "none", stroke: "rgba(128,128,128,0.1)", strokeWidth: 14 }),
        ...arcs.map((a, i) => h("circle", {
          key: `arc-${i}`, cx: 70, cy: 70, r: 52, fill: "none",
          stroke: `var(${a.cssVar})`, strokeWidth: 14,
          strokeDasharray: a.dashStr, strokeDashoffset: a.dashOffset,
          transform: "rotate(-90 70 70)",
        })),
        h("text", { x: 70, y: 70, textAnchor: "middle", fontSize: 22, fontWeight: 700, fill: "var(--ink)" }, kcal_total),
        h("text", { x: 70, y: 86, textAnchor: "middle", fontSize: 9, fill: "var(--muted)", letterSpacing: "0.12em" }, "KCAL"),
      ),
      h("div", { className: "wv-mrn-bars" },
        segs.map((s, i) => {
          const tgt = [protein.target_grams, carbs.target_grams, fat.target_grams][i] || s.grams;
          const pct = tgt > 0 ? Math.min(100, (s.grams / tgt) * 100) : 0;
          return h("div", { key: `br-${i}`, className: "wv-mrn-bar" },
            h("div", { className: "wv-mrn-bar-row" },
              h("span", { className: "wv-mrn-bar-label" }, ["Protein", "Carbs", "Fat"][i]),
              h("span", { className: "wv-mrn-bar-val" }, `${s.grams}g / ${tgt || "?"}g`),
            ),
            h("div", { className: "wv-mrn-bar-track" },
              h("div", { className: "wv-mrn-bar-fill", style: { width: `${pct}%`, background: `var(${s.cssVar})` } }),
            ),
          );
        }),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
