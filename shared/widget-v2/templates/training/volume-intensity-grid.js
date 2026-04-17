import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// Heatmap: lifts (rows) × weeks (cols). Cell intensity = volume / maxVolume.
// Renders as a CSS grid; each cell's background uses --accent with alpha
// proportional to relative volume so it tracks the palette automatically.

export function VolumeIntensityGrid({ title, display_width, summary, follow_up_chips, data }) {
  const { lifts, weeks, cells } = data;
  const byKey = new Map();
  for (const c of cells) byKey.set(`${c.lift}__${c.week}`, c.volume);
  const maxVol = Math.max(1, ...cells.map((c) => c.volume));

  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-vig-body" },
      h(
        "div",
        { className: "wv-vig-grid", style: { gridTemplateColumns: `minmax(90px, 1fr) repeat(${weeks.length}, 1fr)` } },
        h("div", { className: "wv-vig-corner" }),
        weeks.map((w, i) =>
          h("div", { key: `wh-${i}`, className: "wv-vig-week-head" }, `w${w}`),
        ),
        lifts.flatMap((lift, li) => [
          h("div", { key: `lh-${li}`, className: "wv-vig-lift-head" }, lift),
          ...weeks.map((w, wi) => {
            const v = byKey.get(`${lift}__${w}`) || 0;
            const intensity = v / maxVol;
            return h(
              "div",
              {
                key: `c-${li}-${wi}`,
                className: "wv-vig-cell",
                style: {
                  background: `color-mix(in oklab, var(--accent) ${Math.round(intensity * 85)}%, transparent)`,
                  color: intensity > 0.55 ? "var(--accent-text)" : "var(--muted)",
                },
                title: `${lift} · week ${w} · volume ${v}`,
              },
              v || "",
            );
          }),
        ]),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
