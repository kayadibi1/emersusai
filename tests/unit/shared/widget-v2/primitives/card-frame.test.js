import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { CardFrame } from "../../../../../shared/widget-v2/primitives/card-frame.js";
import { StatCard } from "../../../../../shared/widget-v2/primitives/stat-card.js";

test("CardFrame wraps children with title + optional summary", () => {
  const el = CardFrame({ title: "T", summary: "S", children: "body" });
  const json = JSON.stringify(el);
  assert.match(json, /"T"/);
  assert.match(json, /"S"/);
  assert.match(json, /"body"/);
});

test("CardFrame hides summary when null", () => {
  const el = CardFrame({ title: "T", summary: null, children: "body" });
  const json = JSON.stringify(el);
  assert.match(json, /"T"/);
  assert.doesNotMatch(json, /summary/);
});

test("CardFrame honors display_width → class", () => {
  const el = CardFrame({ title: "T", summary: null, display_width: "narrow", children: "x" });
  assert.match(el.props.className, /wv-narrow/);
});

test("StatCard renders caption + big value + unit", () => {
  const el = StatCard({ caption: "TDEE", value: 2500, unit: "kcal" });
  const json = JSON.stringify(el);
  assert.match(json, /TDEE/);
  assert.match(json, /2500/);
  assert.match(json, /kcal/);
});
