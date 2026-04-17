import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { Slider } from "../../../../../shared/widget-v2/primitives/slider.js";

test("renders label, current value, unit, and <input type=range>", () => {
  const el = Slider({ label: "Dose", value: 5, onChange: () => {}, min: 1, max: 25, unit: "g/day" });
  assert.ok(el);
  // The returned root div has 2 children: label row + <input type=range>.
  const labelRow = el.props.children[0];
  assert.match(JSON.stringify(labelRow), /Dose/);
  assert.match(JSON.stringify(labelRow), /5/);
  assert.match(JSON.stringify(labelRow), /g\/day/);
  const input = el.props.children[1];
  assert.equal(input.type, "input");
  assert.equal(input.props.type, "range");
  assert.equal(input.props.min, 1);
  assert.equal(input.props.max, 25);
});

test("onChange passes parsed number", () => {
  let got = null;
  const el = Slider({ label: "X", value: 10, onChange: (v) => { got = v; }, min: 0, max: 100 });
  const input = el.props.children[1];
  input.props.onChange({ target: { value: "42" } });
  assert.equal(got, 42);
  assert.equal(typeof got, "number");
});
