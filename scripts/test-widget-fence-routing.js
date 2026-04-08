import assert from "node:assert/strict";
// Imports from the no-deps parser module, NOT emersus-renderer.js, so this
// test runs in plain Node without an HTTPS-import loader. The renderer
// re-exports the same functions, so we're testing the same code path.
import { hasWidgetFences, parseLLMOutput } from "../shared/widget-fence-parser.js";

// Shape that matches what the server sends for a comparison widget.
const answerText = [
  "For high-intensity intervals, sodium bicarbonate has the stronger case...",
  "",
  "```widget",
  "<div class=\"card\"><h3>Beta-alanine vs sodium bicarbonate</h3>",
  "<p>Bottom line: ...</p></div>",
  "```",
].join("\n");

// hasWidgetFences must be true so the client routes to the blocks path,
// not the legacy dangerouslySetInnerHTML path.
assert.equal(hasWidgetFences(answerText), true);

// parseLLMOutput must cleanly extract one text + one widget segment with
// no stray fence markers.
const segments = parseLLMOutput(answerText);
const widgets = segments.filter((s) => s.type === "widget");
const texts = segments.filter((s) => s.type === "text");
assert.equal(widgets.length, 1);
assert.ok(!widgets[0].content.includes("```"));
for (const t of texts) {
  assert.ok(!t.content.includes("```widget"), `leaked opening fence: ${t.content}`);
  assert.ok(!/(^|\n)\s*```\s*(\n|$)/.test(t.content), `leaked closing fence: ${t.content}`);
}

// Whitespace-collapsed variant (simulates the previous bug in
// buildAssistantBlocks where normalizeText flattened newlines).
// parseLLMOutput must still match the fence and extract the widget.
const collapsed = answerText.replace(/\s+/g, " ");
assert.equal(hasWidgetFences(collapsed), true);
const collapsedSegments = parseLLMOutput(collapsed);
assert.ok(collapsedSegments.some((s) => s.type === "widget"));

// Inline-fence variant (model puts the body on the same line as ```widget).
const inlineFence = "Some prose. ```widget<div>html</div>``` trailing prose";
assert.equal(hasWidgetFences(inlineFence), true);
const inlineSegments = parseLLMOutput(inlineFence);
const inlineWidgets = inlineSegments.filter((s) => s.type === "widget");
assert.equal(inlineWidgets.length, 1);
for (const t of inlineSegments.filter((s) => s.type === "text")) {
  assert.ok(!t.content.includes("```"), `inline-fence leak: ${t.content}`);
}

console.log("widget fence routing: ok");
