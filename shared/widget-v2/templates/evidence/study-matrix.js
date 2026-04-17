import React from "react";
import { CardFrame } from "../../primitives/card-frame.js";
import { FollowUpChips } from "../../primitives/follow-up-chips.js";

const h = React.createElement;

const DIRECTION_LABEL = { positive: "+ positive", null: "· null", negative: "− negative" };
const DIRECTION_CLASS = { positive: "wv-sm-pos", null: "wv-sm-null", negative: "wv-sm-neg" };
const DESIGN_LABEL = { RCT: "RCT", meta: "Meta", cohort: "Cohort", review: "Review", other: "Other" };

export function StudyMatrix({ title, display_width, summary, follow_up_chips, data }) {
  const { question, studies } = data;
  return h(
    CardFrame,
    { title, summary, display_width },
    h(
      "div",
      { className: "wv-sm-body" },
      h("div", { className: "wv-sm-question" }, question),
      h(
        "table",
        { className: "wv-sm-table" },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            h("th", null, "Study"),
            h("th", null, "Design"),
            h("th", null, "n"),
            h("th", null, "Effect"),
            h("th", null, "Direction"),
          ),
        ),
        h(
          "tbody",
          null,
          studies.map((s, i) =>
            h(
              "tr",
              { key: `st-${i}` },
              h("td", { className: "wv-sm-cit" }, s.citation),
              h("td", null, DESIGN_LABEL[s.design] || s.design),
              h("td", { className: "wv-sm-n" }, s.n ? `${s.n}` : "—"),
              h("td", { className: "wv-sm-eff" }, s.effect_size == null ? "—" : `${s.effect_size}`),
              h("td", { className: `wv-sm-dir ${DIRECTION_CLASS[s.direction]}` }, DIRECTION_LABEL[s.direction] || s.direction),
            ),
          ),
        ),
      ),
    ),
    h(FollowUpChips, { chips: follow_up_chips }),
  );
}
