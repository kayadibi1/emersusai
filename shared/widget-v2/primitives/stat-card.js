import React from "react";
const h = React.createElement;

export function StatCard({ caption, value, unit }) {
  return h(
    "div",
    { className: "wv-stat" },
    h("div", { className: "wv-stat-caption" }, caption),
    h(
      "div",
      { className: "wv-stat-value" },
      `${value}`,
      unit ? h("span", { className: "wv-stat-unit" }, ` ${unit}`) : null,
    ),
  );
}
