import React from "react";
const h = React.createElement;

// Follow-up chips render as a horizontal row at the bottom of a widget card.
// Each chip, when clicked, calls window.sendPrompt so the chat app can feed
// the text into the composer (existing behavior; see emersus-renderer.js
// `window.sendPrompt` host bridge).

export function FollowUpChips({ chips }) {
  if (!Array.isArray(chips) || chips.length === 0) return null;
  const onClick = (text) => () => {
    try {
      if (typeof window !== "undefined" && typeof window.sendPrompt === "function") {
        window.sendPrompt(text);
      }
    } catch { /* noop */ }
  };
  return h(
    "div",
    { className: "wv-chips", role: "group", "aria-label": "Follow-up suggestions" },
    chips.slice(0, 4).map((text, i) =>
      h(
        "button",
        {
          key: `chip-${i}`,
          type: "button",
          className: "wv-chip",
          onClick: onClick(text),
        },
        text,
      ),
    ),
  );
}
