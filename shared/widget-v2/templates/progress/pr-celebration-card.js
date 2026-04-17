import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Hero number with context: "Bench 1RM 120 kg · previous 115 kg · +4.3% in 6 wk".
// Use after a recent PR is logged. display_width: medium or narrow.

export function PrCelebrationCard({ title, display_width, summary, follow_up_chips, data }) {
  const { lift, value, unit, previous, context } = data;
  const delta = previous != null ? value - previous : null;
  const deltaPct = previous != null && previous > 0 ? ((value - previous) / previous) * 100 : null;

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-pcc-body" },
      h("div", { className: "wv-pcc-lift" }, lift),
      h("div", { className: "wv-pcc-number" },
        h("span", { className: "wv-pcc-value" }, value),
        h("span", { className: "wv-pcc-unit" }, unit),
      ),
      delta != null ? h("div", { className: "wv-pcc-delta" },
        h("span", null, `prev ${previous} ${unit}`),
        h("span", { className: "wv-pcc-delta-val" }, ` · +${delta.toFixed(1)} ${unit}`),
        deltaPct != null ? h("span", { className: "wv-pcc-delta-pct" }, ` (+${deltaPct.toFixed(1)}%)`) : null,
      ) : null,
      h("div", { className: "wv-pcc-context" }, context),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
