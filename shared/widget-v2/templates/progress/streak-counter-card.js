import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Current streak / best streak stat pair + a 14-dot proof strip.
// Display_width: narrow. Good as a morning motivator card.

export function StreakCounterCard({ title, display_width, summary, follow_up_chips, data }) {
  const { current, best, last_14 } = data;
  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-scc-body" },
      h("div", { className: "wv-scc-stats" },
        h("div", { className: "wv-scc-stat" },
          h("div", { className: "wv-scc-label" }, "current"),
          h("div", { className: "wv-scc-value" }, current, h("span", { className: "wv-scc-unit" }, " days")),
        ),
        h("div", { className: "wv-scc-stat wv-scc-stat-muted" },
          h("div", { className: "wv-scc-label" }, "best"),
          h("div", { className: "wv-scc-value" }, best, h("span", { className: "wv-scc-unit" }, " days")),
        ),
      ),
      h("div", { className: "wv-scc-strip" },
        last_14.map((on, i) =>
          h("i", { key: `d-${i}`, className: `wv-scc-dot ${on ? "on" : ""}` })
        ),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
