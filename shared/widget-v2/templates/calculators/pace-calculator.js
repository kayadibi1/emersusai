import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";
import { StatCard } from "../../primitives/stat-card.js";

const h = React.createElement;

// Distance + time → pace/km + speed + training zone. Pre-computed
// server-side; this just surfaces it.

function formatPace(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}
function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function PaceCalculator({ title, display_width, summary, follow_up_chips, data }) {
  const { distance_km, time_sec, pace_sec_per_km, speed_kmh, zone } = data;
  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-pace-inputs" },
      h("span", null, `${distance_km} km`),
      h("span", null, formatTime(time_sec)),
      zone ? h("span", { className: "wv-pace-zone" }, `Zone ${zone.replace("Z", "")}`) : null,
    ),
    h("div", { className: "wv-pace-stats" },
      h(StatCard, { caption: "Pace", value: formatPace(pace_sec_per_km), unit: "" }),
      h(StatCard, { caption: "Speed", value: speed_kmh.toFixed(1), unit: "km/h" }),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
