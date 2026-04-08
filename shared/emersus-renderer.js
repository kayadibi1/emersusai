// Emersus inline-widget renderer.
//
// Parses assistant markdown for ```widget``` fences and renders each one as a
// sandboxed iframe with the Emersus design tokens injected. Text segments are
// passed back to the caller via a renderText callback so the existing chat
// bubble / typewriter logic stays in charge of prose rendering.
//
// This module ships as plain ESM and uses React.createElement directly (the
// same style as shared/react-chat-app.js) so it can be imported without a
// build step.

import React, {
  useEffect,
  useMemo,
  useRef,
} from "https://esm.sh/react@18.2.0";

const h = React.createElement;

// ---------------------------------------------------------------------------
// parseLLMOutput
// ---------------------------------------------------------------------------
//
// Walks the markdown for widget code fences and produces an ordered list of
// { type: "text" | "widget", content } segments. Empty text segments are
// dropped so we never render blank prose chunks between back-to-back widgets.
//
// A "widget fence" is a fenced code block whose info string is `widget` or
// `html`, OR an untagged ``` block whose first non-whitespace character is
// `<` (i.e. the model emitted raw HTML in a bare fence). The `widget` tag is
// what the system prompt tells the model to use, but real models drift to
// `html` a lot of the time, and occasionally emit a bare fence, so accepting
// all three keeps the pipeline robust without changing the model contract.
//
// NOTE: we do NOT match plain text fenced as ``` ... ``` — only fences whose
// first content char is `<` — so ordinary code examples in prose are still
// rendered as regular code blocks (handled by renderProseChunks upstream).
const WIDGET_INFO_TAGS = /^(widget|html)$/i;

function isWidgetFenceBody(info, body) {
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
const ANY_FENCE_RE = /```([\w-]*)[ \t]*\r?\n?([\s\S]*?)```/g;

export function parseLLMOutput(markdown) {
  const text = String(markdown || "");
  const segments = [];
  let lastIndex = 0;
  let match;
  ANY_FENCE_RE.lastIndex = 0;
  while ((match = ANY_FENCE_RE.exec(text)) !== null) {
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
// Both fully-closed fences AND a trailing unclosed fence are removed. We
// accept the same tag set as parseLLMOutput.
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

// ---------------------------------------------------------------------------
// EMERSUS_THEME_CSS
// ---------------------------------------------------------------------------
//
// Injected into every widget iframe. Defines the design tokens widget HTML is
// expected to reference and provides baseline element styles so the model can
// emit raw <input>, <button>, <select>, etc. without restating typography.
//
// Default surface is light; the dark variant is gated on prefers-color-scheme.
// We deliberately keep this independent of the parent chat shell so widgets
// remain self-contained when copied or exported.
export const EMERSUS_THEME_CSS = `
  :root {
    color-scheme: light;
    /* --color-* namespace (preferred — matches the Emersus design system) */
    --color-background-primary: #fafaf9;
    --color-background-secondary: #ffffff;
    --color-background-tertiary: #f4f3f0;
    --color-text-primary: #0f0f0e;
    --color-text-secondary: #555248;
    --color-text-tertiary: #8b8778;
    --color-border-primary: rgba(15, 15, 14, 0.22);
    --color-border-secondary: rgba(15, 15, 14, 0.14);
    --color-border-tertiary: rgba(15, 15, 14, 0.10);
    --color-background-success: #e7f4d8;
    --color-text-success: #2f5a13;
    --color-background-warning: #fff3d0;
    --color-text-warning: #6b4a00;
    --color-background-danger: #ffe1d0;
    --color-text-danger: #7a3300;
    --color-background-info: #dfeaf9;
    --color-text-info: #1e3f72;
    --color-border-info: rgba(30, 63, 114, 0.28);
    --border-radius-sm: 4px;
    --border-radius-md: 8px;
    --border-radius-lg: 14px;

    /* --bg-* / --text-* aliases (backward compatible with older widgets) */
    --bg-primary: var(--color-background-primary);
    --bg-secondary: var(--color-background-secondary);
    --bg-tertiary: var(--color-background-tertiary);
    --text-primary: var(--color-text-primary);
    --text-secondary: var(--color-text-secondary);
    --text-tertiary: var(--color-text-tertiary);
    --border-default: var(--color-border-tertiary);
    --border-hover: var(--color-border-primary);
    --radius-md: var(--border-radius-md);
    --radius-lg: var(--border-radius-lg);
    --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

    /* Evidence-strength tokens */
    --ev-strong-bg: #e7f4d8;
    --ev-strong-text: #2f5a13;
    --ev-strong-dot: #6db830;
    --ev-moderate-bg: #fff3d0;
    --ev-moderate-text: #6b4a00;
    --ev-moderate-dot: #d8b46a;
    --ev-limited-bg: #ffe1d0;
    --ev-limited-text: #7a3300;
    --ev-limited-dot: #e07a3a;
    --ev-insufficient-bg: #ececea;
    --ev-insufficient-text: #555248;
    --ev-insufficient-dot: #8b8778;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --color-background-primary: #11110f;
      --color-background-secondary: rgba(255, 255, 255, 0.04);
      --color-background-tertiary: #1f1e1a;
      --color-text-primary: #f4f1e8;
      --color-text-secondary: #aaa59a;
      --color-text-tertiary: #6f6c63;
      --color-border-primary: rgba(255, 255, 255, 0.20);
      --color-border-secondary: rgba(255, 255, 255, 0.12);
      --color-border-tertiary: rgba(255, 255, 255, 0.08);
      --color-background-success: rgba(29, 158, 117, 0.14);
      --color-text-success: #5dcaa5;
      --color-background-warning: rgba(216, 180, 106, 0.14);
      --color-text-warning: #e7c98a;
      --color-background-danger: rgba(224, 122, 58, 0.14);
      --color-text-danger: #f2a877;
      --color-background-info: rgba(133, 183, 235, 0.12);
      --color-text-info: #b5d4f4;
      --color-border-info: rgba(133, 183, 235, 0.32);
      --ev-strong-bg: rgba(159, 251, 0, 0.10);
      --ev-strong-text: #b9f47a;
      --ev-strong-dot: #9ffb00;
      --ev-moderate-bg: rgba(216, 180, 106, 0.12);
      --ev-moderate-text: #e7c98a;
      --ev-moderate-dot: #d8b46a;
      --ev-limited-bg: rgba(224, 122, 58, 0.12);
      --ev-limited-text: #f2a877;
      --ev-limited-dot: #e07a3a;
      --ev-insufficient-bg: rgba(255, 255, 255, 0.05);
      --ev-insufficient-text: #aaa59a;
      --ev-insufficient-dot: #6f6c63;
    }
  }
  * { box-sizing: border-box; min-width: 0; }
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    color: var(--color-text-primary);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    line-height: 1.45;
    overflow-wrap: break-word;
    word-wrap: break-word;
  }
  body {
    padding: 14px;
  }
  h1, h2, h3, h4 {
    margin: 0 0 8px;
    color: var(--color-text-primary);
    font-weight: 500;
    letter-spacing: -0.01em;
  }
  h1 { font-size: 18px; }
  h2 { font-size: 16px; }
  h3 { font-size: 14px; color: var(--color-text-primary); }
  h4 { font-size: 12px; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.06em; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
  p { margin: 0 0 8px; color: var(--color-text-primary); }
  small, .muted { color: var(--color-text-tertiary); font-size: 12px; }
  hr { border: 0; border-top: 0.5px solid var(--color-border-tertiary); margin: 12px 0; }
  a { color: var(--color-text-primary); text-decoration: underline; text-underline-offset: 2px; }
  input[type="text"], input[type="number"], input[type="search"], select, textarea {
    width: 100%;
    padding: 8px 10px;
    border: 0.5px solid var(--color-border-tertiary);
    border-radius: var(--border-radius-md);
    background: var(--color-background-secondary);
    color: var(--color-text-primary);
    font: inherit;
    transition: border-color 120ms ease;
  }
  input[type="text"]:hover, input[type="number"]:hover, select:hover, textarea:hover {
    border-color: var(--color-border-primary);
  }
  input[type="range"] {
    width: 100%;
    accent-color: #1D9E75;
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 14px;
    border: 0.5px solid var(--color-border-tertiary);
    border-radius: var(--border-radius-md);
    background: var(--color-background-secondary);
    color: var(--color-text-primary);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease;
  }
  button:hover {
    border-color: var(--color-border-primary);
    background: var(--color-background-tertiary);
  }
  /* Tables are discouraged but must at least not collapse in narrow iframes. */
  table {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  th, td {
    padding: 8px 10px;
    border-bottom: 0.5px solid var(--color-border-tertiary);
    text-align: left;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  th { color: var(--color-text-secondary); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; }
  canvas { max-width: 100%; }
`;

// ---------------------------------------------------------------------------
// WidgetFrame
// ---------------------------------------------------------------------------
//
// Renders one widget HTML payload as a sandboxed iframe.
//   - sandbox="allow-scripts allow-same-origin": scripts run, but the iframe
//     is still isolated as an iframe document. We tried "allow-scripts" alone
//     but Chromium gives such iframes a 0x0 layout viewport, which collapses
//     all CSS layout and breaks ResizeObserver-based auto-sizing. This matches
//     the existing EvidenceArtifact sandbox, so we are not regressing the
//     baseline security posture.
//   - srcDoc embeds the design tokens stylesheet + the widget HTML + a small
//     bootstrap script that uses ResizeObserver on document.body and
//     postMessages the height back to the parent on every reflow.
//   - Each instance generates a random frameId so multiple widgets on the
//     same page never cross-size each other.
//   - Iframe wrapper has border-radius: 0 to match the sharp-edge chat shell.
export function WidgetFrame({ code }) {
  const iframeRef = useRef(null);
  const frameId = useMemo(
    () => `wf_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`,
    [],
  );

  const srcDoc = useMemo(() => {
    const safeId = JSON.stringify(frameId);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${EMERSUS_THEME_CSS}</style>
</head>
<body>
${code}
<script>
(function () {
  var id = ${safeId};
  // Bridge: widgets can call window.sendPrompt('follow-up question') to send
  // a new chat message to the parent. The parent listens for the
  // 'emersus:sendPrompt' message and feeds it into the composer.
  window.sendPrompt = function (prompt) {
    try {
      parent.postMessage({
        type: "emersus:sendPrompt",
        frameId: id,
        prompt: String(prompt || "")
      }, "*");
    } catch (e) { /* noop */ }
  };
  function send() {
    var h = Math.max(
      document.documentElement.scrollHeight || 0,
      document.body ? document.body.scrollHeight : 0
    );
    parent.postMessage({ frameId: id, height: h }, "*");
  }
  if (typeof ResizeObserver === "function" && document.body) {
    var ro = new ResizeObserver(send);
    ro.observe(document.body);
  }
  window.addEventListener("load", send);
  setTimeout(send, 50);
  setTimeout(send, 250);
  setTimeout(send, 600);
})();
</script>
</body>
</html>`;
  }, [code, frameId]);

  useEffect(() => {
    function onMessage(event) {
      const data = event && event.data;
      if (!data || data.frameId !== frameId) return;
      if (typeof data.height !== "number") return;
      const node = iframeRef.current;
      if (!node) return;
      // Add a small slack so the inner content never grows the body scrollbar.
      node.style.height = `${Math.max(80, data.height + 6)}px`;
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameId]);

  return h("iframe", {
    ref: iframeRef,
    title: "Inline visual",
    sandbox: "allow-scripts allow-same-origin",
    srcDoc,
    scrolling: "no",
    style: {
      width: "100%",
      height: "260px",
      border: "1px solid rgba(255, 255, 255, 0.08)",
      borderRadius: "0",
      background: "transparent",
      display: "block",
    },
  });
}

// ---------------------------------------------------------------------------
// LLMResponse
// ---------------------------------------------------------------------------
//
// Default top-level renderer. Splits the markdown into segments and walks
// them in order. Text segments are passed to the optional `renderText`
// callback so the chat app can keep using its existing prose rendering
// (TextBlock); if no callback is supplied a plain pre-wrap div is used.
export function LLMResponse({ markdown, renderText }) {
  const segments = useMemo(() => parseLLMOutput(markdown), [markdown]);
  return h(
    "div",
    { className: "llm-response" },
    segments.map((segment, index) => {
      if (segment.type === "widget") {
        return h(WidgetFrame, { key: `w-${index}`, code: segment.content });
      }
      if (typeof renderText === "function") {
        return renderText(segment.content, index);
      }
      return h(
        "div",
        {
          key: `t-${index}`,
          style: { whiteSpace: "pre-wrap", color: "var(--text-primary)" },
        },
        segment.content,
      );
    }),
  );
}

export default LLMResponse;
