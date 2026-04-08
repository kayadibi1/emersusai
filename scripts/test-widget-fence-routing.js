import assert from "node:assert/strict";
// Imports from the no-deps parser module, NOT emersus-renderer.js, so this
// test runs in plain Node without an HTTPS-import loader. The renderer
// re-exports the same functions, so we're testing the same code path.
import { hasWidgetFences, parseLLMOutput } from "../shared/widget-fence-parser.js";
import { normalizeSynthesisPayload } from "../api/emersus/workflow.js";

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

// Server-side regression: a real model output captured from production
// where the answer used CRLF line endings, the opening fence was inline
// ("```widget <div...") with no newline, and max_output_tokens cut off the
// closing ``` mid-tag. Before the autoWrapBareHtml CRLF fix, normalize
// returned the entire HTML body as plain text because the \n{2,} regex
// could not match \r\n\r\n paragraph breaks, so the auto-wrap step never
// fired and the client rendered raw HTML escaped into the chat.
const crlfTruncated =
  "Ashwagandha has the better evidence for reducing stress physiology.\r\n" +
  "\r\n" +
  '```widget <div style="background:var(--color-background-primary);padding:12px;">\r\n' +
  "<div>row 1</div>\r\n" +
  "<div>row 2</div>\r\n" +
  '<div style="padding-bottom:6px;">Typical study dose</div';
const normalized = normalizeSynthesisPayload(crlfTruncated);
assert.equal(typeof normalized.answer_text, "string");
assert.equal(
  hasWidgetFences(normalized.answer_text),
  true,
  "CRLF + truncated answer must end up with a complete widget fence after normalize",
);
const normalizedSegments = parseLLMOutput(normalized.answer_text);
const normalizedWidgets = normalizedSegments.filter((s) => s.type === "widget");
assert.equal(
  normalizedWidgets.length,
  1,
  "expected exactly one widget segment after normalize",
);
for (const t of normalizedSegments.filter((s) => s.type === "text")) {
  assert.ok(
    !t.content.includes("```widget"),
    `normalize leaked opening fence into prose: ${t.content}`,
  );
}

console.log("widget fence routing: ok");
