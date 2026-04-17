import React from "react";
const h = React.createElement;

// Shared shell: gives every widget a consistent frame (title, optional summary
// ribbon, display-width class). Children = the actual chart + controls.

const WIDTH_CLASS = { narrow: "wv-narrow", medium: "wv-medium", wide: "wv-wide" };

export function CardFrame({ title, summary, display_width = "wide", children }) {
  const className = `wv-card ${WIDTH_CLASS[display_width] || "wv-wide"}`;
  return h(
    "div",
    { className },
    h("div", { className: "wv-card-head" }, h("h4", null, title)),
    children,
    summary ? h("div", { className: "wv-card-summary" }, summary) : null,
  );
}
