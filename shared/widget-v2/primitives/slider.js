import React from "react";
const h = React.createElement;

// Slider primitive. Controlled input — parent owns the value and provides
// onChange(number). Renders the label + current value at the top, range
// input below. Styling lives in tokens.css and is palette-token driven.

export function Slider({ label, value, onChange, min, max, step = 1, unit = "" }) {
  return h(
    "div",
    { className: "wv-slider" },
    h(
      "div",
      { className: "wv-slider-row" },
      h("span", { className: "wv-slider-label" }, label),
      h(
        "span",
        { className: "wv-slider-value" },
        `${value}`,
        unit ? h("span", { className: "wv-slider-unit" }, ` ${unit}`) : null,
      ),
    ),
    h("input", {
      type: "range",
      min,
      max,
      step,
      value,
      onChange: (e) => onChange(Number(e.target.value)),
      "aria-label": `${label}${unit ? ` in ${unit}` : ""}`,
    }),
  );
}
