import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";
import { StatCard } from "../../primitives/stat-card.js";

const h = React.createElement;

// Epley: load × (1 + reps/30). Brzycki: load × (36 / (37 - reps)).
// Renderer-computed so model arithmetic drift can't surface mislabeled
// values (2026-04-23 diagnostic flagged several "Brzycki" labels with
// off-by-~5-kg outputs). Brzycki becomes unstable at very high reps so we
// clamp at 36; Epley is numerically stable across the useful range.
function epley(load, reps) { return load * (1 + reps / 30); }
function brzycki(load, reps) { return reps >= 36 ? load * 36 : load * (36 / (37 - reps)); }

export function OneRMEstimator({ title, display_width, summary, follow_up_chips, data }) {
  const { lift, unit, load, reps } = data;
  const epley1rm = Math.round(epley(load, reps));
  const brzycki1rm = Math.round(brzycki(load, reps));
  const avg = Math.round((epley1rm + brzycki1rm) / 2);
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
        h("span", { className: "wv-orm-set" }, `${load} ${unit} × ${reps}`),
      ),
      h(
        "div",
        { className: "wv-orm-stats" },
        h(StatCard, { caption: "Epley", value: epley1rm, unit: unit }),
        h(StatCard, { caption: "Brzycki", value: brzycki1rm, unit: unit }),
        h(StatCard, { caption: "Average", value: avg, unit: unit }),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
