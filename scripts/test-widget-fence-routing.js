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

// Client-side regression: buildAssistantBlocks used to slice answer_text to
// 4000 chars before handing it to TextBlock. Real comparison-widget answers
// are 4–7k chars (prose + a styled HTML widget), so the slice was lopping
// the closing ``` off the fence — hasWidgetFences then returned false on the
// rendering side and the raw "```widget <div...>" markup was rendered as
// literal prose. We mirror buildAssistantBlocks's text construction here so
// the test guards the rendering pipeline, not just the parser.
function buildAssistantBlocksText(answerText) {
  return String(answerText || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 32000);
}

const longProse =
  "Ashwagandha has the stronger case for stress markers and recovery/training tolerance. " +
  "The better human data are chronic, not acute: a 2026 RCT in team-sport athletes used " +
  "600 mg/day during pre-season and found improvements in physiological stress biomarkers, " +
  "perceived recovery, strength, and aerobic capacity. Rhodiola is more of a short-term " +
  "fatigue and performance herb, with thinner training-adaptation evidence.";
// Realistic widget body — many nested divs with inline styles, like the model
// actually emits. Padded to push the total above 4000 chars on purpose.
const longWidgetBody =
  '<div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);padding:16px;">' +
  '<div style="font-size:14px;font-weight:500;margin-bottom:4px;">Ashwagandha vs rhodiola</div>' +
  '<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:14px;">Best fit by outcome.</div>' +
  Array.from({ length: 6 })
    .map(
      (_, i) =>
        '<div style="display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;align-items:center;padding:10px 0;border-bottom:0.5px solid var(--color-border-tertiary);font-size:12px;">' +
        `<div>Outcome row ${i + 1} with a moderately long descriptive label</div>` +
        '<div><span style="background:var(--ev-strong-bg);color:var(--ev-strong-text);padding:3px 8px;border-radius:var(--border-radius-md);">Strong</span></div>' +
        '<div><span style="background:var(--ev-limited-bg);color:var(--ev-limited-text);padding:3px 8px;border-radius:var(--border-radius-md);">Limited</span></div>' +
        "</div>",
    )
    .join("") +
  "</div>";
const realisticAnswer = `${longProse}\n\n\`\`\`widget\n${longWidgetBody}\n\`\`\``;
assert.ok(
  realisticAnswer.length > 4000,
  `expected the realistic answer to exceed the old 4000-char cap, got ${realisticAnswer.length}`,
);
assert.equal(
  hasWidgetFences(realisticAnswer),
  true,
  "raw realistic answer must contain widget fences",
);
const builtText = buildAssistantBlocksText(realisticAnswer);
assert.equal(
  hasWidgetFences(builtText),
  true,
  "buildAssistantBlocks output must preserve the widget fence (no 4000-char truncation)",
);
const builtSegments = parseLLMOutput(builtText);
assert.equal(
  builtSegments.filter((s) => s.type === "widget").length,
  1,
  "buildAssistantBlocks output must yield exactly one widget segment",
);
// And the old 4000-char slice would still fail — proving the regression
// targets the right thing.
const oldSliced = realisticAnswer.slice(0, 4000);
assert.equal(
  hasWidgetFences(oldSliced),
  false,
  "sanity: the old 4000-char slice would have dropped the closing fence",
);

console.log("widget fence routing: ok");
