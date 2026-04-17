import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Lookup table: rows are target reps (1-15), columns are RPE (6/7/8/9/10).
// Cell = %1RM. Color intensity = closeness to 1RM.

export function RpeToPercentRM({ title, display_width, summary, follow_up_chips, data }) {
  const { rows } = data;
  const maxPct = Math.max(...rows.flatMap((r) => r.pcts_by_rpe));
  return h(CardFrame, { title, summary, display_width },
    h("table", { className: "wv-r2p-table" },
      h("thead", null,
        h("tr", null,
          h("th", null, "Reps"),
          ...[6, 7, 8, 9, 10].map((rpe) => h("th", { key: `h-${rpe}` }, `RPE ${rpe}`)),
        ),
      ),
      h("tbody", null,
        rows.map((r, i) =>
          h("tr", { key: `r-${i}` },
            h("td", { className: "wv-r2p-reps" }, r.reps),
            ...r.pcts_by_rpe.map((pct, j) => {
              const intensity = pct / maxPct;
              return h("td", {
                key: `c-${i}-${j}`,
                className: "wv-r2p-cell",
                style: {
                  background: `color-mix(in oklab, var(--accent) ${Math.round(intensity * 55)}%, transparent)`,
                  color: intensity > 0.7 ? "var(--accent-text)" : "var(--ink)",
                },
              }, `${pct}%`);
            }),
          )
        ),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
