import React from "react";
const h = React.createElement;

// Follow-up chips render as a horizontal row at the bottom of a widget card.
// widget-v2 widgets render INLINE in the parent chat page (not inside an
// iframe), so the legacy `window.sendPrompt` bridge defined in
// emersus-renderer.js (which only exists inside the widget iframe's document)
// is unreachable here. Use the same CustomEvent bridge MealPlanCard uses:
// shared/react-chat-app.js has a useEffect that listens for
// `emersus:seed-prompt` and calls setQuestion(event.detail.prompt) to seed
// the composer. User still hits send.

export function FollowUpChips({ chips }) {
  if (!Array.isArray(chips) || chips.length === 0) return null;
  const onClick = (text) => () => {
    try {
      if (typeof window !== "undefined" && typeof window.CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("emersus:seed-prompt", { detail: { prompt: text } }));
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
