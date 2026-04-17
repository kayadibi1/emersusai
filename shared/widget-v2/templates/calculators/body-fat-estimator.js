import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";
import { StatCard } from "../../primitives/stat-card.js";

const h = React.createElement;

// Navy-method body-fat card — assumes server-side calc feeds the final
// body_fat_pct. Shows inputs + the number + a zone strip (athletic → fit →
// acceptable → obese).

function zoneFor(sex, pct) {
  const zones = sex === "female"
    ? [{ label: "Essential", max: 13.9 }, { label: "Athletic", max: 20.9 }, { label: "Fit", max: 24.9 }, { label: "Acceptable", max: 31.9 }, { label: "Obese", max: 99 }]
    : [{ label: "Essential", max: 5.9 }, { label: "Athletic", max: 13.9 }, { label: "Fit", max: 17.9 }, { label: "Acceptable", max: 24.9 }, { label: "Obese", max: 99 }];
  return zones.find((z) => pct <= z.max)?.label || "Unknown";
}

export function BodyFatEstimator({ title, display_width, summary, follow_up_chips, data }) {
  const { sex, neck_cm, waist_cm, hip_cm, height_cm, body_fat_pct } = data;
  const zone = zoneFor(sex, body_fat_pct);

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-bfe-inputs" },
      h("span", { className: "wv-bfe-capitalize" }, sex),
      h("span", null, `height ${height_cm} cm`),
      h("span", null, `neck ${neck_cm} cm`),
      h("span", null, `waist ${waist_cm} cm`),
      sex === "female" && hip_cm ? h("span", null, `hip ${hip_cm} cm`) : null,
    ),
    h("div", { className: "wv-bfe-stats" },
      h(StatCard, { caption: "Body fat", value: body_fat_pct.toFixed(1), unit: "%" }),
      h("div", { className: "wv-bfe-zone" },
        h("div", { className: "wv-bfe-zone-label" }, "Zone"),
        h("div", { className: "wv-bfe-zone-value" }, zone),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
