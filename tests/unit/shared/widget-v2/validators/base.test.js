import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBase } from "../../../../../shared/widget-v2/validators/index.js";

test("rejects missing title", () => {
  const r = validateBase({ display_width: "narrow", type: "x", data: {}, summary: null, follow_up_chips: [] });
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /title/);
});

test("rejects invalid display_width", () => {
  const r = validateBase({ title: "T", display_width: "huge", type: "x", data: {}, summary: null, follow_up_chips: [] });
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /display_width/);
});

test("rejects follow_up_chips over 4", () => {
  const r = validateBase({
    title: "T", display_width: "narrow", type: "x", data: {}, summary: null,
    follow_up_chips: ["a", "b", "c", "d", "e"],
  });
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /follow_up_chips.*max/);
});

test("accepts a valid base payload", () => {
  const r = validateBase({
    title: "Macros", display_width: "narrow", type: "macro_ring",
    data: { kcal_total: 2500 }, summary: null, follow_up_chips: ["Apply"],
  });
  assert.equal(r.valid, true);
  assert.equal(r.errors.length, 0);
});
