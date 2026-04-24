import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";
import { StatCard } from "../../primitives/stat-card.js";

const h = React.createElement;

function formatPace(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}
function formatTime(sec) {
  const hh = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return hh > 0 ? `${hh}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// Pace and speed are arithmetic, renderer-computed.
export function PaceCalculator({ title, display_width, summary, follow_up_chips, data }) {
  const { distance_km, time_sec, zone } = data;
  const pace = distance_km > 0 ? time_sec / distance_km : 0;
  const speed = time_sec > 0 ? distance_km / (time_sec / 3600) : 0;
  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-pace-inputs" },
      h("span", null, `${distance_km} km`),
      h("span", null, formatTime(time_sec)),
      zone ? h("span", { className: "wv-pace-zone" }, `Zone ${zone.replace("Z", "")}`) : null,
    ),
    h("div", { className: "wv-pace-stats" },
      h(StatCard, { caption: "Pace", value: formatPace(pace), unit: "" }),
      h(StatCard, { caption: "Speed", value: speed.toFixed(1), unit: "km/h" }),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
