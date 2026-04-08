// Pure widget-fence parsing primitives. No React, no DOM, no browser-only
// imports — kept dependency-free so Node-side tests and the browser-side
// renderer can share the exact same matching logic.

// A "widget fence" is a fenced code block whose info string is `widget` or
// `html`, OR an untagged ``` block whose first non-whitespace character is
// `<` (i.e. the model emitted raw HTML in a bare fence). The `widget` tag is
// what the system prompt tells the model to use, but real models drift to
// `html` a lot of the time, and occasionally emit a bare fence, so accepting
// all three keeps the pipeline robust without changing the model contract.
const WIDGET_INFO_TAGS = /^(widget|html)$/i;

export function isWidgetFenceBody(info, body) {
  if (WIDGET_INFO_TAGS.test(info)) return true;
  // Untagged fence: only treat as a widget if it really looks like HTML.
  if (!info) {
    const firstChar = String(body || "").trim().charAt(0);
    return firstChar === "<";
  }
  return false;
}

// Matches any fenced block: opening ``` + optional info string + optional
// newline (CR/LF, LF, or none — some models inline the body on the same
// line as the opening fence) + body + closing ```. Non-greedy body,
// multiline. We pick the widget-looking ones ourselves via
// isWidgetFenceBody so we never swallow unrelated fences.
export const ANY_FENCE_RE = /```([\w-]*)[ \t]*\r?\n?([\s\S]*?)```/g;

// Walks the markdown for widget code fences and produces an ordered list of
// { type: "text" | "widget", content } segments. Empty text segments are
// dropped so we never render blank prose chunks between back-to-back widgets.
export function parseLLMOutput(markdown) {
  const text = String(markdown || "");
  const segments = [];
  let lastIndex = 0;
  let match;
  const re = new RegExp(ANY_FENCE_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    const [whole, info, body] = match;
    if (!isWidgetFenceBody(info, body)) continue;
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index);
      if (chunk.trim()) segments.push({ type: "text", content: chunk });
    }
    segments.push({ type: "widget", content: body });
    lastIndex = match.index + whole.length;
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex);
    if (tail.trim()) segments.push({ type: "text", content: tail });
  }
  return segments;
}

// During typewriter streaming we strip widget fences from the visible
// substring so the user never sees half-finished "```widget\n<div..." prose.
// Both fully-closed fences AND a trailing unclosed fence are removed.
export function stripWidgetFencesForStreaming(text) {
  const src = String(text || "");
  let out = "";
  let cursor = 0;
  const re = new RegExp(ANY_FENCE_RE.source, "g");
  let match;
  while ((match = re.exec(src)) !== null) {
    const [whole, info, body] = match;
    if (!isWidgetFenceBody(info, body)) continue;
    out += src.slice(cursor, match.index);
    cursor = match.index + whole.length;
  }
  out += src.slice(cursor);
  // Trailing unclosed fence — only strip if the info tag OR the first content
  // char signals a widget. ([\w-]* captures info tag, then body.)
  out = out.replace(
    /```([\w-]*)[ \t]*\n?([\s\S]*)$/,
    (whole, info, body) => (isWidgetFenceBody(info, body) ? "" : whole),
  );
  return out;
}

// Quick check used by callers to decide whether the segment-aware code path is
// needed at all. Pure prose answers stay on the existing rendering path.
export function hasWidgetFences(text) {
  const src = String(text || "");
  const re = new RegExp(ANY_FENCE_RE.source, "g");
  let match;
  while ((match = re.exec(src)) !== null) {
    if (isWidgetFenceBody(match[1], match[2])) return true;
  }
  return false;
}
