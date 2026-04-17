import assert from "node:assert/strict";
import { test } from "node:test";

// React components in this codebase are plain React.createElement calls
// (esm.sh + no build step). We test by calling the component as a pure
// function and inspecting the returned element tree.
import React from "react";
import { FollowUpChips } from "../../../../../shared/widget-v2/primitives/follow-up-chips.js";

test("returns null when chips empty", () => {
  const el = FollowUpChips({ chips: [] });
  assert.equal(el, null);
});

test("renders one chip per string", () => {
  const el = FollowUpChips({ chips: ["A", "B"] });
  assert.ok(el);
  assert.equal(el.props.children.length, 2);
});

test("chip onClick dispatches emersus:seed-prompt CustomEvent with chip text", () => {
  const events = [];
  const stubWindow = {
    CustomEvent: function (name, opts) { this.type = name; this.detail = opts?.detail; },
    dispatchEvent: (evt) => { events.push({ type: evt.type, prompt: evt.detail?.prompt }); },
  };
  global.window = stubWindow;
  const el = FollowUpChips({ chips: ["hello"] });
  const chip = el.props.children[0];
  chip.props.onClick();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "emersus:seed-prompt");
  assert.equal(events[0].prompt, "hello");
  delete global.window;
});
