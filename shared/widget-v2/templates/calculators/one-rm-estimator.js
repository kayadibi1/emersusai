import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";
import { StatCard } from "../../primitives/stat-card.js";

const h = React.createElement;

// Shows a user's working set and the two common 1RM estimates side-by-side.
// Epley is the classic; Brzycki tends to read lower at high reps. Showing
// both gives the user a plausible range, not a false-precision single number.

export function OneRMEstimator({ title, display_width, summary, follow_up_chips, data }) {
  const { lift, unit, load, reps, epley_1rm, brzycki_1rm } = data;
  const avg = Math.round((epley_1rm + brzycki_1rm) / 2);
  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-orm-body" },
      h(
        "div",
        { className: "wv-orm-input" },
        h("span", { className: "wv-orm-lift" }, lift),
        h("span", { className: "wv-orm-set" }, `${load} ${unit} \u00d7 ${reps}`),
      ),
      h(
        "div",
        { className: "wv-orm-stats" },
        h(StatCard, { caption: "Epley", value: Math.round(epley_1rm), unit: unit }),
        h(StatCard, { caption: "Brzycki", value: Math.round(brzycki_1rm), unit: unit }),
        h(StatCard, { caption: "Average", value: avg, unit: unit }),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
