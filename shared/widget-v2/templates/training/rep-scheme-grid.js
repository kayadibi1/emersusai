import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Table of rep/intensity schemes tagged with focus badges. Lets users scan
// "what does 3×5 @ 85% vs 4×8 @ 75% actually train?" at a glance.

const FOCUS_LABEL = { STR: "Strength", HYP: "Hypertrophy", END: "Endurance", POW: "Power" };
const FOCUS_COLOR = { STR: "var(--chart-series-4)", HYP: "var(--chart-series-1)", END: "var(--chart-series-2)", POW: "var(--chart-series-3)" };

export function RepSchemeGrid({ title, display_width, summary, follow_up_chips, data }) {
  const { schemes } = data;
  return h(CardFrame, { title, summary, display_width },
    h("table", { className: "wv-rsg-table" },
      h("thead", null,
        h("tr", null,
          h("th", null, "Reps"),
          h("th", null, "% 1RM"),
          h("th", null, "Focus"),
          h("th", null, "Notes"),
        ),
      ),
      h("tbody", null,
        schemes.map((s, i) =>
          h("tr", { key: `s-${i}` },
            h("td", { className: "wv-rsg-reps" }, s.reps_low === s.reps_high ? `${s.reps_low}` : `${s.reps_low}–${s.reps_high}`),
            h("td", { className: "wv-rsg-pct" }, s.pct_low === s.pct_high ? `${s.pct_low}%` : `${s.pct_low}–${s.pct_high}%`),
            h("td", null, h("span", { className: "wv-rsg-badge", style: { background: FOCUS_COLOR[s.focus], color: "#0a0a0b" } }, FOCUS_LABEL[s.focus] || s.focus)),
            h("td", { className: "wv-rsg-notes" }, s.label),
          )
        ),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
