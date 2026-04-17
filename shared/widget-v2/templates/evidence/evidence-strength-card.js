import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

// GRADE-style badge card. Claim at top with a big colored level badge; the
// four/five factors that fed into the rating show as a compact table below.

const LEVEL_TOKEN = { strong: "--ev-strong-bg", moderate: "--ev-moderate-bg", limited: "--ev-limited-bg", insufficient: "--ev-insufficient-bg" };
const LEVEL_TEXT = { strong: "--ev-strong-text", moderate: "--ev-moderate-text", limited: "--ev-limited-text", insufficient: "--ev-insufficient-text" };
const RATING_COLOR = { high: "var(--chart-series-1)", moderate: "var(--warning)", low: "var(--danger)" };

export function EvidenceStrengthCard({ title, display_width, summary, follow_up_chips, data }) {
  const { claim, level, factors } = data;
  const bg = `var(${LEVEL_TOKEN[level]})`;
  const fg = `var(${LEVEL_TEXT[level]})`;

  return h(CardFrame, { title, summary, display_width },
    h("div", { className: "wv-esc-hero", style: { background: bg, color: fg } },
      h("div", { className: "wv-esc-level" }, level.toUpperCase()),
      h("div", { className: "wv-esc-claim" }, claim),
    ),
    h("table", { className: "wv-esc-factors" },
      h("tbody", null,
        factors.map((f, i) =>
          h("tr", { key: `f-${i}` },
            h("td", { className: "wv-esc-fname" }, f.name),
            h("td", { className: "wv-esc-frating" },
              h("span", { className: "wv-esc-dot", style: { background: RATING_COLOR[f.rating] } }),
              f.rating,
            ),
            f.note ? h("td", { className: "wv-esc-fnote" }, f.note) : h("td", null),
          )
        ),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
