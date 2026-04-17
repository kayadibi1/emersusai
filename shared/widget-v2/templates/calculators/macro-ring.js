import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;
const CIRC = 2 * Math.PI * 60;                  // donut circumference at r=60

// "MAINTENANCE" overflows the 120px inner ring. Abbreviate for in-ring display.
const PHASE_SHORT = { cut: "CUT", maintenance: "MAINT", bulk: "BULK" };

// Macro ring donut for a daily macro split. Pure SVG. Interactive hover
// highlights a segment (local state only, no server round-trip).

export function MacroRing({ title, display_width, summary, follow_up_chips, data }) {
  const { kcal_total, protein, carbs, fat, tdee_reference } = data;
  const total = (protein.kcal || 0) + (carbs.kcal || 0) + (fat.kcal || 0);
  const segments = total > 0 ? [
    { label: "Protein", grams: protein.grams, kcal: protein.kcal, var: "--protein" },
    { label: "Carbs",   grams: carbs.grams,   kcal: carbs.kcal,   var: "--carbs" },
    { label: "Fat",     grams: fat.grams,     kcal: fat.kcal,     var: "--fat" },
  ] : [];

  let offset = 0;
  const arcs = segments.map((seg) => {
    const frac = seg.kcal / total;
    const dash = frac * CIRC;
    const dashStr = `${dash} ${CIRC - dash}`;
    const startOffset = -offset;
    offset += dash;
    return h("circle", {
      key: seg.label,
      cx: 80, cy: 80, r: 60, fill: "none",
      stroke: `var(${seg.var})`,
      strokeWidth: 18,
      strokeDasharray: dashStr,
      strokeDashoffset: startOffset,
      transform: "rotate(-90 80 80)",
    });
  });

  const legendRows = segments.map((seg) =>
    h(
      "div",
      { key: seg.label, className: "wv-mring-row" },
      h("span", { className: "wv-mring-dot", style: { background: `var(${seg.var})` } }),
      h("span", { className: "wv-mring-label" }, seg.label),
      h("span", { className: "wv-mring-grams" }, `${seg.grams}g`),
      h("span", { className: "wv-mring-kcal" }, `${seg.kcal} kcal`),
    ),
  );

  const tdeeFoot = tdee_reference
    ? h(
        "div",
        { className: "wv-mring-foot" },
        `vs TDEE ${tdee_reference.tdee} · `,
        h(
          "b",
          { style: { color: tdee_reference.delta_kcal < 0 ? "var(--chart-series-3)" : "var(--chart-series-2)" } },
          `${tdee_reference.delta_kcal > 0 ? "+" : ""}${tdee_reference.delta_kcal} kcal`,
        ),
      )
    : null;

  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-mring-body" },
      h(
        "svg",
        { viewBox: "0 0 160 160", width: 150, height: 150, className: "wv-mring-svg" },
        h("circle", { cx: 80, cy: 80, r: 60, fill: "none", stroke: "rgba(26,24,19,0.06)", strokeWidth: 18 }),
        ...arcs,
        h("text", { x: 80, y: 76, textAnchor: "middle", fontSize: 28, fontWeight: 700, fill: "var(--ink)" }, `${kcal_total}`),
        h("text", { x: 80, y: 96, textAnchor: "middle", fontSize: 9, fill: "var(--muted)", letterSpacing: "0.1em" }, `KCAL · ${PHASE_SHORT[data.phase] || (data.phase || "").toUpperCase()}`),
      ),
      h("div", { className: "wv-mring-legend" }, ...legendRows),
    ),
    tdeeFoot,
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
