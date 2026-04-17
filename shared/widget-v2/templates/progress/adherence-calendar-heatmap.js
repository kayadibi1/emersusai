import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// GitHub-style calendar heatmap. Each cell = one day, alpha = session
// intensity. 14 columns (weeks), 7 rows (days). Shows streak / consistency.

export function AdherenceCalendarHeatmap({ title, display_width, summary, follow_up_chips, data }) {
  const { cells } = data;
  // bucket by week + day-of-week (0=Mon..6=Sun)
  const sorted = cells.slice().sort((a, b) => a.date.localeCompare(b.date));
  const byKey = new Map();
  for (const c of sorted) byKey.set(c.date, c);

  const startDate = new Date(sorted[0].date);
  const endDate = new Date(sorted[sorted.length - 1].date);
  const weeks = Math.ceil((endDate - startDate) / (7 * 86400000)) + 1;
  const SIZE = 14, GAP = 2;
  const W = weeks * (SIZE + GAP) + 40;
  const H = 7 * (SIZE + GAP) + 20;

  const dateAt = (weekIdx, dayIdx) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + weekIdx * 7 + dayIdx);
    return d.toISOString().slice(0, 10);
  };

  return h(CardFrame, { title, summary, display_width },
    h("svg", { viewBox: `0 0 ${W} ${H}`, className: "wv-ach-svg", preserveAspectRatio: "xMinYMid meet" },
      Array.from({ length: weeks }, (_, wi) =>
        Array.from({ length: 7 }, (_, di) => {
          const date = dateAt(wi, di);
          const cell = byKey.get(date);
          const intensity = cell?.intensity || 0;
          return h("rect", {
            key: `c-${wi}-${di}`,
            x: 30 + wi * (SIZE + GAP),
            y: di * (SIZE + GAP),
            width: SIZE, height: SIZE, rx: 2,
            fill: intensity > 0
              ? `color-mix(in oklab, var(--accent) ${Math.round(intensity * 90)}%, transparent)`
              : "var(--surface)",
            stroke: "var(--line)",
          });
        })
      ),
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) =>
        h("text", { key: `d-${i}`, x: 0, y: i * (SIZE + GAP) + 10, fontSize: 9, fill: "var(--muted)" }, d)
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
