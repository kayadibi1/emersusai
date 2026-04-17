import assert from "node:assert/strict";
import { test } from "node:test";

// Indirect test: simulate a processEvent run with an output_item.done carrying
// emit_calculator_widget args, verify the onTool handler is called with
// a widget-v2-flavored payload (family derived from tool name).

// We import processEvent if exported, otherwise this test stays shape-driven.

test("stream forwards emit_calculator_widget as widget-v2", async () => {
  const { __testables } = await import("../../../../../api/emersus/pipeline/stream.js");
  if (!__testables?.processEvent) {
    // processEvent is not exported. Task 13 exposes __testables; if missing,
    // this test is a reminder to expose them.
    assert.fail("expected __testables.processEvent export");
  }
  const { processEvent } = __testables;

  const state = {
    ctx: { toolResults: {} },
    proseBuffer: "",
    toolBuffers: {},
    serverToolCalls: [],
    onTool: null,
    onToolError: null,
  };
  const calls = [];
  state.onTool = (name, data) => calls.push({ name, data });

  const validPayload = {
    title: "T", display_width: "narrow", summary: null, follow_up_chips: [],
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
    item: { type: "function_call", name: "emit_calculator_widget", arguments: JSON.stringify(validPayload), call_id: "c1" },
  }, state);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "emit_calculator_widget");
  assert.equal(calls[0].data.type, "macro_ring");
});
