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

test("chip onClick calls window.sendPrompt with chip text", () => {
  let sent = null;
  global.window = { sendPrompt: (s) => { sent = s; } };
  const el = FollowUpChips({ chips: ["hello"] });
  const chip = el.props.children[0];
  chip.props.onClick();
  assert.equal(sent, "hello");
  delete global.window;
});
