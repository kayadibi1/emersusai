// shared/nutrition/fuel-gauge.js — Phase 4 time-aware fuel gauge.
//
// Pure layout helpers + a thin SVG component. Designed so layout math is
// testable without a DOM.

import React from "react";

const h = React.createElement;

// Eating-window default — 7 AM → 10 PM. Future: pull from profile preferences.
export const DEFAULT_EATING_WINDOW = { start: 7, end: 22 };

export function timeFractionInWindow(now = new Date(), eatingWindow = DEFAULT_EATING_WINDOW) {
  const hours = now.getHours() + now.getMinutes() / 60;
  const span = Math.max(0.5, eatingWindow.end - eatingWindow.start);
  return Math.max(0, Math.min(1, (hours - eatingWindow.start) / span));
}

export function mealDotsLayout(meals, axisWidth, eatingWindow = DEFAULT_EATING_WINDOW) {
  const list = Array.isArray(meals) ? meals : [];
  const dots = [];
  for (const m of list) {
    const stamp = m.eaten_at || m.planned_at;
    if (!stamp) continue;
    const d = new Date(stamp);
    if (Number.isNaN(d.getTime())) continue;
    const hours = d.getHours() + d.getMinutes() / 60;
    const x = ((hours - eatingWindow.start) / Math.max(0.5, eatingWindow.end - eatingWindow.start)) * axisWidth;
    if (x < 0 || x > axisWidth) continue;
    const kcal = Number(m.kcal) || 0;
    const size = Math.min(28, Math.max(6, 6 + kcal / 50));
    dots.push({ x, size, kcal, label: m.name || m.type || "", planned: !m.eaten_at });
  }
  return dots;
}

function MacroMiniGauge({ label, value, target, paceZone }) {
  const pct = Math.max(0, Math.min(1, target ? value / target : 0));
  return h("div", { className: "fg-macro-row" },
    h("div", { className: "fg-macro-head" },
      h("span", { className: "fg-macro-label" }, label),
      h("span", { className: "fg-macro-value" }, `${Math.round(value)} / ${Math.round(target || 0)}`),
    ),
    h("div", { className: "fg-macro-bar" },
      paceZone
        ? h("div", { className: "fg-macro-pace", style: { left: `${paceZone.start * 100}%`, width: `${(paceZone.end - paceZone.start) * 100}%` } })
        : null,
      h("div", { className: "fg-macro-fill", style: { width: `${pct * 100}%` } }),
    ),
  );
}

export function FuelGauge({ data }) {
  const target = data?.target || {};
  const consumed = data?.consumed || {};
  const planned = data?.planned || {};
  const meals = data?.meals || [];
  const paceZone = { start: data?.pace_zone_start || 0, end: data?.pace_zone_end || 0 };
  const eatingWindow = DEFAULT_EATING_WINDOW;

  const projected = (consumed.kcal || 0) + (planned.kcal || 0);
  const targetKcal = target.kcal || 0;
  const onTrack = targetKcal && Math.abs(projected - targetKcal) <= targetKcal * 0.10;
  const status = !targetKcal
    ? "TARGET NOT SET"
    : onTrack ? "● ON TRACK" : projected > targetKcal ? "● OVER TARGET" : "● UNDER TARGET";
  const delta = targetKcal ? Math.round(projected - targetKcal) : 0;

  const axisWidth = 720;
  const dots = mealDotsLayout(meals, axisWidth, eatingWindow);
  const nowFrac = timeFractionInWindow();

  // Hour ticks
  const hourSpan = eatingWindow.end - eatingWindow.start;
  const ticks = [eatingWindow.start, eatingWindow.start + hourSpan/4, eatingWindow.start + hourSpan/2, eatingWindow.start + 3*hourSpan/4, eatingWindow.end];

  return h("section", { className: "fg-card" },
    h("header", { className: "fg-card-head" },
      h("div", { className: "fg-kcal" },
        h("span", { className: "fg-kcal-num" }, Math.round(consumed.kcal || 0)),
        h("span", { className: "fg-kcal-of" }, ` / ${Math.round(targetKcal)} kcal`),
      ),
      delta !== 0
        ? h("span", { className: `fg-delta ${delta > 0 ? "fg-delta-over" : "fg-delta-under"}` },
            `${delta > 0 ? "+" : ""}${delta} ${delta > 0 ? "AHEAD" : "BEHIND"} OF PACE`)
        : null,
      h("span", { className: "fg-status" }, status),
    ),
    h("div", { className: "fg-timeline-wrap" },
      h("svg", {
        className: "fg-timeline",
        viewBox: `0 0 ${axisWidth} 80`,
        preserveAspectRatio: "none",
        role: "img",
        "aria-label": "Fuel gauge timeline",
      },
        // Pace zone band (diagonal-hatched)
        h("defs", null,
          h("pattern", { id: "fg-hatch", width: "8", height: "8", patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
            h("rect", { width: "8", height: "8", fill: "transparent" }),
            h("line", { x1: "0", y1: "0", x2: "0", y2: "8", stroke: "var(--accent)", "stroke-width": "1", "stroke-opacity": "0.35" }),
          ),
        ),
        h("rect", {
          x: paceZone.start * axisWidth,
          y: 40,
          width: Math.max(0, (paceZone.end - paceZone.start) * axisWidth),
          height: 12,
          fill: "url(#fg-hatch)",
        }),
        // Base bar
        h("rect", { x: 0, y: 44, width: axisWidth, height: 4, fill: "var(--line)", rx: 2 }),
        // Filled bar (consumed)
        h("rect", { x: 0, y: 44, width: targetKcal ? Math.min(axisWidth, ((consumed.kcal || 0) / targetKcal) * axisWidth) : 0, height: 4, fill: "var(--accent)", rx: 2 }),
        // Meal dots
        dots.map((d, i) => h("circle", {
          key: `d-${i}`,
          cx: d.x,
          cy: 24,
          r: d.size / 2,
          fill: d.planned ? "transparent" : "var(--accent)",
          stroke: "var(--accent)",
          "stroke-width": d.planned ? 1.5 : 0,
          "stroke-dasharray": d.planned ? "3 3" : null,
        })),
        // Now marker
        h("line", { x1: nowFrac * axisWidth, y1: 12, x2: nowFrac * axisWidth, y2: 60, stroke: "var(--ink)", "stroke-width": 1.5, "stroke-dasharray": "4 3" }),
        h("text", { x: nowFrac * axisWidth + 4, y: 18, fill: "var(--ink)", "font-family": "JetBrains Mono", "font-size": 9, "letter-spacing": "0.16em" }, "NOW"),
      ),
      h("div", { className: "fg-axis" },
        ticks.map((t) => {
          const hour = Math.floor(t);
          const ampm = hour >= 12 ? "PM" : "AM";
          const display = hour > 12 ? hour - 12 : hour;
          return h("span", { key: t }, `${display} ${ampm}`);
        }),
      ),
    ),
    h("div", { className: "fg-macros" },
      h(MacroMiniGauge, { label: "Protein", value: consumed.protein_g || 0, target: target.protein_g, paceZone }),
      h(MacroMiniGauge, { label: "Carbs",   value: consumed.carbs_g   || 0, target: target.carbs_g,   paceZone }),
      h(MacroMiniGauge, { label: "Fat",     value: consumed.fat_g     || 0, target: target.fat_g,     paceZone }),
    ),
    data?.why_insight ? h("p", { className: "fg-why" }, data.why_insight) : null,
  );
}

export default FuelGauge;
