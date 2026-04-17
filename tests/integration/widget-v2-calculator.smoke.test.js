// Integration smoke: drive the pipeline with a mocked OpenAI response that
// returns an emit_calculator_widget tool call. Verify the SSE stream emits
// { type: "tool", name: "emit_calculator_widget", data: <validated> }.

import assert from "node:assert/strict";
import { test } from "node:test";
import { __testables } from "../../api/emersus/pipeline/stream.js";

const { processEvent } = __testables;

test("full widget-v2 event → SSE tool event", () => {
  const state = {
    ctx: { toolResults: {}, _timer: { record() {} } },
    proseBuffer: "",
    toolBuffers: {},
    serverToolCalls: [],
    onTool: null,
    onToolError: null,
  };
  const events = [];
  state.onTool = (n, d) => events.push({ type: "tool", name: n, data: d });
  state.onToolError = (n, errs) => events.push({ type: "tool_error", name: n, errors: errs });

  const payload = {
    title: "Daily macros · cut",
    display_width: "narrow",
    summary: "400 kcal deficit",
    follow_up_chips: ["Apply", "Log today"],
    type: "macro_ring",
    data: {
      kcal_total: 2500, phase: "cut",
      protein: { grams: 180, target_grams: 180, kcal: 720 },
      carbs: { grams: 275, target_grams: 275, kcal: 1100 },
      fat: { grams: 76, target_grams: 76, kcal: 680 },
      tdee_reference: { tdee: 2900, delta_kcal: -400 },
    },
  };
  processEvent({
    type: "response.output_item.done",
    item: { type: "function_call", name: "emit_calculator_widget", arguments: JSON.stringify(payload), call_id: "x" },
  }, state);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "tool");
  assert.equal(events[0].name, "emit_calculator_widget");
  assert.equal(events[0].data.type, "macro_ring");
  assert.deepEqual(events[0].data.data.protein, { grams: 180, target_grams: 180, kcal: 720 });
});

test("invalid payload → tool_error, no tool event", () => {
  const state = {
    ctx: { toolResults: {}, _timer: { record() {} } },
    proseBuffer: "",
    toolBuffers: {},
    serverToolCalls: [],
    onTool: null,
    onToolError: null,
  };
  const events = [];
  state.onTool = (n, d) => events.push({ type: "tool", name: n, data: d });
  state.onToolError = (n, errs) => events.push({ type: "tool_error", name: n, errors: errs });

  processEvent({
    type: "response.output_item.done",
    item: { type: "function_call", name: "emit_calculator_widget", arguments: JSON.stringify({ title: "T" }), call_id: "y" },
  }, state);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "tool_error");
});
