import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;
const CIRC = 2 * Math.PI * 60;

const PHASE_SHORT = { cut: "CUT", maintenance: "MAINT", bulk: "BULK" };

// Standard fat-share ratios by phase (percent of NON-protein calories going
// to fat; remainder is carbs). Evidence base: ISSN position stands; lower
// fat on cut to preserve carbs for training, higher on bulk for hormonal
// support. Used only when the model omits fat/carbs legs — if the user gives
// a specific split, the model passes it through verbatim.
const PHASE_FAT_SHARE = { cut: 0.30, maintenance: 0.33, bulk: 0.28 };

function roundHalf(n) { return Math.round(n * 2) / 2; }

// Compute carbs + fat legs from kcal_total - protein.kcal using phase-based
// defaults. Called only when the model's payload has null carbs/fat — the
// 2026-04-23 diagnostic showed the model either fabricates specific g values
// or null-pads; renderer-computed defaults remove that decision from the model.
function computeMacroSplit({ kcal_total, phase, protein }) {
  const proteinGrams = Number(protein?.grams) || 0;
  const proteinKcal = Math.round(proteinGrams * 4);
  const remainingKcal = Math.max(0, kcal_total - proteinKcal);
  const fatShare = PHASE_FAT_SHARE[phase] ?? 0.30;
  const fatKcal = Math.round(remainingKcal * fatShare);
  const carbsKcal = remainingKcal - fatKcal;
  const fatGrams = Math.round(fatKcal / 9);
  const carbsGrams = Math.round(carbsKcal / 4);
  return {
    protein: { grams: proteinGrams, target_grams: proteinGrams, kcal: proteinKcal },
    carbs: { grams: carbsGrams, target_grams: carbsGrams, kcal: carbsKcal },
    fat: { grams: fatGrams, target_grams: fatGrams, kcal: fatKcal },
  };
}

function resolveLegs(data) {
  const { kcal_total, phase, protein, carbs, fat } = data;
  const hasAll = protein?.kcal != null && carbs?.kcal != null && fat?.kcal != null;
  if (hasAll) return { protein, carbs, fat };
  return computeMacroSplit({ kcal_total, phase, protein });
}

export function MacroRing({ title, display_width, summary, follow_up_chips, data }) {
  const { kcal_total, tdee_reference } = data;
  const legs = resolveLegs(data);
  const total = (legs.protein.kcal || 0) + (legs.carbs.kcal || 0) + (legs.fat.kcal || 0);
  const segments = total > 0 ? [
    { label: "Protein", grams: legs.protein.grams, kcal: legs.protein.kcal, var: "--protein" },
    { label: "Carbs",   grams: legs.carbs.grams,   kcal: legs.carbs.kcal,   var: "--carbs" },
    { label: "Fat",     grams: legs.fat.grams,     kcal: legs.fat.kcal,     var: "--fat" },
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
