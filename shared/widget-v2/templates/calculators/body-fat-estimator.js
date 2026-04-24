import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";
import { StatCard } from "../../primitives/stat-card.js";

const h = React.createElement;

// US Navy method body-fat % — log10 regression on anthropometric
// measurements, validated in DoD population studies. Renderer-computed so
// model arithmetic can't drift; model provides only the measurements.
function navyBodyFat({ sex, neck_cm, waist_cm, hip_cm, height_cm }) {
  if (sex === "female") {
    if (!hip_cm) return null;
    return 495 / (1.29579 - 0.35004 * Math.log10(waist_cm + hip_cm - neck_cm) + 0.22100 * Math.log10(height_cm)) - 450;
  }
  return 495 / (1.0324 - 0.19077 * Math.log10(waist_cm - neck_cm) + 0.15456 * Math.log10(height_cm)) - 450;
}

function zoneFor(sex, pct) {
  const zones = sex === "female"
    ? [{ label: "Essential", max: 13.9 }, { label: "Athletic", max: 20.9 }, { label: "Fit", max: 24.9 }, { label: "Acceptable", max: 31.9 }, { label: "Obese", max: 99 }]
    : [{ label: "Essential", max: 5.9 }, { label: "Athletic", max: 13.9 }, { label: "Fit", max: 17.9 }, { label: "Acceptable", max: 24.9 }, { label: "Obese", max: 99 }];
  return zones.find((z) => pct <= z.max)?.label || "Unknown";
}

export function BodyFatEstimator({ title, display_width, summary, follow_up_chips, data }) {
  const { sex, neck_cm, waist_cm, hip_cm, height_cm } = data;
  const pct = navyBodyFat({ sex, neck_cm, waist_cm, hip_cm, height_cm });
  const displayPct = pct != null && Number.isFinite(pct) ? Math.max(2, Math.min(60, pct)) : null;
  const zone = displayPct != null ? zoneFor(sex, displayPct) : "—";

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-bfe-inputs" },
      h("span", { className: "wv-bfe-capitalize" }, sex),
      h("span", null, `height ${height_cm} cm`),
      h("span", null, `neck ${neck_cm} cm`),
      h("span", null, `waist ${waist_cm} cm`),
      sex === "female" && hip_cm ? h("span", null, `hip ${hip_cm} cm`) : null,
    ),
    h("div", { className: "wv-bfe-stats" },
      h(StatCard, { caption: "Body fat", value: displayPct != null ? displayPct.toFixed(1) : "—", unit: "%" }),
      h("div", { className: "wv-bfe-zone" },
        h("div", { className: "wv-bfe-zone-label" }, "Zone"),
        h("div", { className: "wv-bfe-zone-value" }, zone),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
