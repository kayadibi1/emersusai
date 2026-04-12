// shared/nutrition-charts.js
//
// Pure-function SVG helpers for the nutrition UI. No charting library,
// no build step. Each helper returns a React element or SVG string.
//
// Consumers:
//   - shared/nutrition-today-panel.js   (rings, sparklines)
//   - shared/nutrition-plan-panel.js    (target cards)
//   - shared/nutrition-journal-panel.js (meal totals)
//   - shared/food-detail-drawer.js      (nutrition-facts panel, supplement-facts panel)
//   - app/progress/nutrition-pane.js    (streak banner, micro grid, weekly bars)

import React from "https://esm.sh/react@18.2.0";
const h = React.createElement;

// Design tokens (mirrors workout-tracking spec's palette)
export const TOKENS = {
  bg:        "#08080a",
  ink:       "#e8e8e8",
  primary:   "#78dc14",
  secondary: "#78dc14",
  danger:    "#ff8f9d",
  muted:     "#666",
  gold:      "#FFD700",
  warm:      "#f5b74a",
};

export const MACRO_COLORS = {
  kcal:    TOKENS.ink,
  protein: TOKENS.primary,
  carbs:   TOKENS.secondary,
  fat:     TOKENS.warm,
  fiber:   TOKENS.muted,
};

// ─── Macro progress ring ───────────────────────────────────────────────────
export function MacroRing({ actual, target, label, color = TOKENS.primary, size = 88 }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(actual / target, 1.5) : 0;
  const arc = pct * circ;
  const overflow = pct > 1.1;
  const perfect = pct >= 0.95 && pct <= 1.05;
  const strokeColor = overflow ? TOKENS.danger : perfect ? TOKENS.gold : color;

  return h("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` }, [
    h("circle", {
      key: "bg", cx, cy, r,
      fill: "none", stroke: "rgba(255,255,255,0.08)", strokeWidth: stroke,
    }),
    h("circle", {
      key: "fg", cx, cy, r,
      fill: "none",
      stroke: strokeColor,
      strokeWidth: stroke,
      strokeLinecap: "round",
      strokeDasharray: `${arc} ${circ}`,
      transform: `rotate(-90 ${cx} ${cy})`,
    }),
    h("text", {
      key: "v",
      x: cx, y: cy - 3,
      textAnchor: "middle",
      fill: TOKENS.ink,
      fontSize: 14,
      fontWeight: 600,
      fontFamily: "Inter, sans-serif",
    }, `${Math.round(actual)}`),
    h("text", {
      key: "l",
      x: cx, y: cy + 14,
      textAnchor: "middle",
      fill: TOKENS.muted,
      fontSize: 10,
      fontFamily: "Inter, sans-serif",
    }, label),
  ]);
}

// ─── Horizontal macro bar ──────────────────────────────────────────────────
export function MacroBar({ actual, target, color = TOKENS.primary, width = 200, height = 8 }) {
  const pct = target > 0 ? Math.min(actual / target, 1.2) : 0;
  const fillWidth = pct * width;
  return h("svg", { width, height }, [
    h("rect", { key: "bg", x: 0, y: 0, width, height, rx: 4, fill: "rgba(255,255,255,0.08)" }),
    h("rect", { key: "fg", x: 0, y: 0, width: fillWidth, height, rx: 4, fill: color }),
  ]);
}

// ─── Mini sparkline ───────────────────────────────────────────────────────
export function Sparkline({ values, width = 140, height = 32, color = TOKENS.primary }) {
  if (!values || values.length === 0) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${i * step},${height - ((v - min) / range) * height}`)
    .join(" ");
  return h("svg", { width, height, viewBox: `0 0 ${width} ${height}` }, [
    h("polyline", {
      key: "p",
      fill: "none",
      stroke: color,
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      points,
    }),
  ]);
}

// ─── Nutrition facts panel ─────────────────────────────────────────────────
export function NutritionFactsPanel({ nutrients, servingGrams, width = 320 }) {
  const macros = nutrients.filter(n => n.category === "macro" || n.category === "energy");
  const vitamins = nutrients.filter(n => n.category === "vitamin");
  const minerals = nutrients.filter(n => n.category === "mineral");

  const rows = [];
  let y = 64;
  const rowHeight = 20;

  function addRow(label, value, unit, indent = 0) {
    rows.push(h("g", { key: `${label}-${y}` }, [
      h("text", { x: 14 + indent, y, fill: TOKENS.ink, fontSize: 13, fontFamily: "Inter" }, label),
      h("text", { x: width - 14, y, fill: TOKENS.ink, fontSize: 13, textAnchor: "end", fontFamily: "Inter" },
        `${value} ${unit}`),
      h("line", { x1: 10, y1: y + 4, x2: width - 10, y2: y + 4, stroke: "rgba(255,255,255,0.1)" }),
    ]));
    y += rowHeight;
  }

  for (const m of macros) addRow(m.name, m.amount?.toFixed(1) ?? "—", m.unit);
  if (vitamins.length > 0) {
    rows.push(h("text", {
      key: "vit-h", x: 14, y,
      fill: TOKENS.muted, fontSize: 11, fontFamily: "Inter", fontWeight: 600,
    }, "VITAMINS"));
    y += 18;
    for (const v of vitamins) addRow(v.name, v.amount?.toFixed(1) ?? "—", v.unit);
  }
  if (minerals.length > 0) {
    rows.push(h("text", {
      key: "min-h", x: 14, y,
      fill: TOKENS.muted, fontSize: 11, fontFamily: "Inter", fontWeight: 600,
    }, "MINERALS"));
    y += 18;
    for (const m of minerals) addRow(m.name, m.amount?.toFixed(1) ?? "—", m.unit);
  }

  const height = y + 20;

  return h("svg", { width, height, viewBox: `0 0 ${width} ${height}` }, [
    h("rect", { key: "bg", x: 0, y: 0, width, height, rx: 12, fill: "rgba(15,20,28,0.6)" }),
    h("text", {
      key: "title", x: 14, y: 28,
      fill: TOKENS.ink, fontSize: 18, fontWeight: 700, fontFamily: "Inter",
    }, "Nutrition Facts"),
    h("text", {
      key: "sz", x: 14, y: 48,
      fill: TOKENS.muted, fontSize: 12, fontFamily: "Inter",
    }, `Serving: ${servingGrams} g`),
    ...rows,
  ]);
}

// ─── Supplement facts panel ─────────────────────────────────────────────────
export function SupplementFactsPanel({ nutrients, form, width = 320 }) {
  const rows = [];
  let y = 64;
  const rowHeight = 22;
  for (const n of nutrients) {
    const pctDv = n.dri ? Math.round((n.amount / n.dri) * 100) : null;
    rows.push(h("g", { key: n.slug }, [
      h("text", { x: 14, y, fill: TOKENS.ink, fontSize: 13, fontFamily: "Inter" }, n.name),
      h("text", { x: width - 80, y, fill: TOKENS.ink, fontSize: 13, textAnchor: "end", fontFamily: "Inter" },
        `${n.amount?.toFixed(1) ?? "—"} ${n.unit}`),
      h("text", { x: width - 14, y, fill: TOKENS.muted, fontSize: 12, textAnchor: "end", fontFamily: "Inter" },
        pctDv != null ? `${pctDv}%` : "†"),
      h("line", { x1: 10, y1: y + 4, x2: width - 10, y2: y + 4, stroke: "rgba(255,255,255,0.1)" }),
    ]));
    y += rowHeight;
  }
  const height = y + 24;
  return h("svg", { width, height, viewBox: `0 0 ${width} ${height}` }, [
    h("rect", { key: "bg", x: 0, y: 0, width, height, rx: 12, fill: "rgba(15,20,28,0.6)" }),
    h("text", {
      key: "title", x: 14, y: 28,
      fill: TOKENS.ink, fontSize: 18, fontWeight: 700, fontFamily: "Inter",
    }, "Supplement Facts"),
    h("text", {
      key: "form", x: 14, y: 48,
      fill: TOKENS.muted, fontSize: 12, fontFamily: "Inter",
    }, `Serving: 1 ${form ?? "unit"}`),
    h("text", {
      key: "dv", x: width - 14, y: 48,
      fill: TOKENS.muted, fontSize: 11, textAnchor: "end", fontFamily: "Inter",
    }, "% DV"),
    ...rows,
  ]);
}

// ─── Streak banner ─────────────────────────────────────────────────────────
export function StreakBanner({ current, best }) {
  if (!current || current === 0) return null;
  return h("div", { className: "streak-banner" }, [
    h("div", { key: "cur", className: "current" }, `${current}-day macro streak`),
    h("div", { key: "best", className: "best" }, `Best: ${best} days`),
  ]);
}

// ─── Micronutrient grid card ───────────────────────────────────────────────
export function MicronutrientCard({ nutrient }) {
  const pct = nutrient.pct_dri ?? 0;
  const status =
    pct < 50                      ? "under"  :
    pct >= 50 && pct < 80         ? "low"    :
    pct >= 80 && pct <= 150       ? "ok"     :
    pct > 150 && pct <= 200       ? "high"   :
                                    "excess" ;
  const color =
    status === "under" ? TOKENS.danger :
    status === "low"   ? TOKENS.warm   :
    status === "ok"    ? TOKENS.secondary :
    status === "high"  ? TOKENS.warm   :
                         TOKENS.danger ;

  return h("div", { className: `micro-card status-${status}` }, [
    h("div", { className: "micro-name", key: "n" }, nutrient.name),
    h("div", { className: "micro-amount", key: "a" },
      `${(nutrient.amount ?? 0).toFixed(1)} ${nutrient.unit}`),
    h("div", { className: "micro-bar", key: "b" },
      h(MacroBar, { actual: pct, target: 100, color, width: 140, height: 6 })),
    h("div", { className: "micro-pct", key: "p" }, `${Math.round(pct)}% DRI`),
  ]);
}

// ─── Weekly stacked bar ──────────────────────────────────────────────────
export function WeeklyMacroBars({ days, width = 420, height = 180 }) {
  if (!days || days.length === 0) return null;
  const maxKcal = Math.max(...days.map(d => d.kcal_actual ?? 0), 1);
  const colWidth = (width - 40) / days.length;
  return h("svg", { width, height, viewBox: `0 0 ${width} ${height}` }, [
    ...days.map((d, i) => {
      const x = 20 + i * colWidth;
      const barHeight = ((d.kcal_actual ?? 0) / maxKcal) * (height - 30);
      const y = height - 20 - barHeight;
      return h("g", { key: d.date }, [
        h("rect", {
          x: x + 2, y, width: colWidth - 4, height: barHeight,
          rx: 3, fill: TOKENS.primary,
          opacity: 0.8,
        }),
        h("text", {
          x: x + colWidth / 2, y: height - 6,
          fill: TOKENS.muted, fontSize: 10, textAnchor: "middle", fontFamily: "Inter",
        }, d.date.slice(5)),
      ]);
    }),
  ]);
}
