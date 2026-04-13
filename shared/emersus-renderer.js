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
} from "react";
import MealPlanWidget from "./meal-plan-widget.js";
import NutritionLogConfirmWidget from "./nutrition-log-confirm-widget.js";

const h = React.createElement;

// ---------------------------------------------------------------------------
// parseLLMOutput
// ---------------------------------------------------------------------------
//
// The pure parsing primitives live in widget-fence-parser.js so Node-side
// tests can import them without pulling in the React/ESM URL imports above.
// Re-export them here so existing browser-side imports of this module keep
// working unchanged.
export {
  parseLLMOutput,
  stripWidgetFencesForStreaming,
  hasWidgetFences,
} from "./widget-fence-parser.js";

// ---------------------------------------------------------------------------
// EMERSUS_THEME_CSS
// ---------------------------------------------------------------------------
//
// Injected into every widget iframe. Defines the design tokens widget HTML is
// expected to reference and provides baseline element styles so the model can
// emit raw <input>, <button>, <select>, etc. without restating typography.
//
// The theme is dark-only and tracks the host site palette in shared/site.css
// (#08080a base, #78dc14 green accent, Georgia display + JetBrains Mono code).
// We previously shipped a warm-beige light default that turned every widget
// wrapper into a stark cream card on the dark chat surface â€” visually
// alien to the rest of the app. The token names below are unchanged so any
// older widgets the model emits keep working; only the values are remapped.
export const EMERSUS_THEME_CSS = `
  @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap");
  :root {
    color-scheme: dark;
    /* --color-* namespace (preferred â€” matches the Emersus design system). */
    --color-background-primary: #08080a;
    --color-background-secondary: rgba(255,255,255,0.06);
    --color-background-tertiary: rgba(255,255,255,0.10);
    --color-text-primary: #e8e8e8;
    --color-text-secondary: #888;
    --color-text-tertiary: #555;
    --color-border-primary: rgba(255,255,255,0.08);
    --color-border-secondary: rgba(255,255,255,0.06);
    --color-border-tertiary: rgba(255,255,255,0.06);
    --color-background-success: rgba(120,220,20,0.10);
    --color-text-success: #78dc14;
    --color-background-warning: rgba(255, 196, 102, 0.12);
    --color-text-warning: #ffd57a;
    --color-background-danger: rgba(255, 143, 157, 0.12);
    --color-text-danger: #ff8f9d;
    --color-background-info: rgba(109, 159, 255, 0.12);
    --color-text-info: #b5d4f4;
    --color-border-info: rgba(109, 159, 255, 0.32);
    --border-radius-sm: 6px;
    --border-radius-md: 8px;
    --border-radius-lg: 10px;

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
    --font-sans: system-ui, -apple-system, sans-serif;
    --font-display: Georgia, "Times New Roman", serif;

    /* Site accent tokens â€” exposed so widgets can pick up the green
       accent that defines the rest of the Emersus surface. */
    --accent-primary: #78dc14;
    --accent-secondary: #78dc14;

    /* Evidence-strength tokens */
    --ev-strong-bg: rgba(120,220,20,0.10);
    --ev-strong-text: #78dc14;
    --ev-strong-dot: #78dc14;
    --ev-moderate-bg: rgba(255, 196, 102, 0.12);
    --ev-moderate-text: #ffd57a;
    --ev-moderate-dot: #ffc466;
    --ev-limited-bg: rgba(255, 143, 157, 0.12);
    --ev-limited-text: #ff8f9d;
    --ev-limited-dot: #ff8f9d;
    --ev-insufficient-bg: rgba(255, 255, 255, 0.05);
    --ev-insufficient-text: #a7adb4;
    --ev-insufficient-dot: #6f7480;
  }
  * { box-sizing: border-box; min-width: 0; }
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    color: var(--color-text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 1.5;
    letter-spacing: -0.005em;
    overflow-wrap: break-word;
    word-wrap: break-word;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  body {
    padding: 0;
  }
  /* Minimal card treatment for the model's wrapper card. */
  [style*="--color-background-primary"],
  [style*="background:var(--color-background-primary)"],
  [style*="background: var(--color-background-primary)"] {
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
  }
  h1, h2, h3, h4 {
    margin: 0 0 10px;
    color: var(--color-text-primary);
    font-family: var(--font-display);
    font-weight: 500;
    letter-spacing: -0.02em;
  }
  h1 { font-size: 18px; }
  h2 { font-size: 16px; }
  h3 { font-size: 14px; color: var(--color-text-primary); }
  h4 {
    font-size: 11px;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-weight: 500;
  }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
  p { margin: 0 0 8px; color: var(--color-text-primary); }
  small, .muted { color: var(--color-text-tertiary); font-size: 12px; }
  hr { border: 0; border-top: 1px solid var(--color-border-tertiary); margin: 14px 0; }
  a {
    color: var(--accent-primary);
    text-decoration: none;
    border-bottom: 1px solid rgba(120, 220, 20, 0.35);
    transition: color 140ms ease, border-color 140ms ease;
  }
  a:hover { color: var(--accent-secondary); border-bottom-color: rgba(120, 220, 20, 0.5); }
  input[type="text"], input[type="number"], input[type="search"], select, textarea {
    width: 100%;
    padding: 9px 12px;
    border: 1px solid var(--color-border-secondary);
    border-radius: var(--border-radius-md);
    background: rgba(255, 255, 255, 0.03);
    color: var(--color-text-primary);
    font: inherit;
    transition: border-color 140ms ease, background 140ms ease;
  }
  input[type="text"]:hover, input[type="number"]:hover, select:hover, textarea:hover {
    border-color: var(--color-border-primary);
    background: rgba(255, 255, 255, 0.05);
  }
  input[type="text"]:focus, input[type="number"]:focus, select:focus, textarea:focus {
    outline: none;
    border-color: var(--accent-primary);
    background: rgba(120, 220, 20, 0.06);
  }
  input[type="range"] {
    width: 100%;
    accent-color: var(--accent-secondary);
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 16px;
    border: 1px solid var(--color-border-secondary);
    border-radius: var(--border-radius-md);
    background: rgba(255, 255, 255, 0.04);
    color: var(--color-text-primary);
    font: inherit;
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    cursor: pointer;
    transition: border-color 140ms ease, background 140ms ease, color 140ms ease, transform 140ms ease;
  }
  button:hover {
    border-color: rgba(120, 220, 20, 0.45);
    background: rgba(120, 220, 20, 0.08);
    color: var(--accent-secondary);
    transform: translateY(-1px);
  }
  button:active { transform: translateY(0); }
  /* Tables are discouraged but must at least not collapse in narrow iframes. */
  table {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  th, td {
    padding: 9px 12px;
    border-bottom: 1px solid var(--color-border-tertiary);
    text-align: left;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  th {
    color: var(--color-text-secondary);
    font-family: var(--font-display);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-weight: 500;
  }
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
// Accepts either:
//   { code: "<html>..." }               â€” legacy fence-parsed widget body
//   { html: "<html>...", title: "..." }  â€” SSE tool result (emit_widget)
// Both paths produce the same sandboxed iframe. `code` takes precedence for
// backwards compatibility; if absent, `html` is used instead.
export function WidgetFrame({ code, html, title }) {
  const widgetBody = code || html || "";
  const iframeRef = useRef(null);
  const frameId = useMemo(
    () => `wf_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`,
    [],
  );
  const parentOrigin = useMemo(() => {
    if (typeof window === "undefined") {
      return "*";
    }
    const origin = window.location && window.location.origin;
    return origin && origin !== "null" ? origin : "*";
  }, []);

  const srcDoc = useMemo(() => {
    const safeId = JSON.stringify(frameId);
    const safeParentOrigin = JSON.stringify(parentOrigin);
    // Chart.js is loaded in the <head> as a classic (synchronous) script so
    // it is guaranteed to be defined on window before any body-level <script>
    // the widget HTML contains runs. The system prompt tells the model that
    // `Chart` is pre-loaded; without this line that claim is a lie and any
    // widget that emits `new Chart(canvas, ...)` without its own <script src>
    // throws a silent ReferenceError inside the sandbox and leaves a blank
    // canvas. The browser HTTP-caches the CDN fetch across all iframes on
    // the page, so the 70 KB payload is paid once per session.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: blob:; connect-src 'none'">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js" crossorigin="anonymous"></script>
  <script>
    // Pre-set Chart.js global defaults so every chart the model emits inherits
    // the dark Emersus surface palette without each widget having to remember.
    // This runs synchronously after Chart.js loads but before any body-level
    // <script> the model writes, so new Chart(...) calls pick these up.
    if (typeof Chart !== "undefined") {
      Chart.defaults.color = "rgba(255, 255, 255, 0.65)";
      Chart.defaults.borderColor = "rgba(255, 255, 255, 0.08)";
      Chart.defaults.font.family = 'system-ui, -apple-system, sans-serif';
      Chart.defaults.font.size = 11;
      if (Chart.defaults.scale && Chart.defaults.scale.grid) {
        Chart.defaults.scale.grid.color = "rgba(255, 255, 255, 0.06)";
      }
      if (Chart.defaults.plugins && Chart.defaults.plugins.legend) {
        Chart.defaults.plugins.legend.labels = Chart.defaults.plugins.legend.labels || {};
        Chart.defaults.plugins.legend.labels.color = "rgba(255, 255, 255, 0.75)";
      }
    }
  </script>
  <style>${EMERSUS_THEME_CSS}</style>
</head>
<body>
${widgetBody}
<script>
(function () {
  var id = ${safeId};
  // Bridge: widgets can call window.sendPrompt('follow-up question') to send
  // a new chat message to the parent. The parent listens for the
  // 'emersus:sendPrompt' message and feeds it into the composer.
  // The parent page injects its real origin here. about:srcdoc documents
  // can report location.origin as the literal string "null", which is not
  // a valid targetOrigin and breaks resize/sendPrompt messages.
  var _origin = ${safeParentOrigin};
  window.sendPrompt = function (prompt) {
    try {
      parent.postMessage({
        type: "emersus:sendPrompt",
        frameId: id,
        prompt: String(prompt || "").slice(0, 2000)
      }, _origin);
    } catch (e) { /* noop */ }
  };
  function send() {
    var h = Math.max(
      document.documentElement.scrollHeight || 0,
      document.body ? document.body.scrollHeight : 0
    );
    parent.postMessage({ frameId: id, height: h }, _origin);
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
  }, [widgetBody, frameId, parentOrigin]);

  useEffect(() => {
    function onMessage(event) {
      const node = iframeRef.current;
      if (!node || event.source !== node.contentWindow) return;
      // about:srcdoc iframes may report an opaque "null" origin even when
      // sandboxed with allow-same-origin, so allow either the host origin
      // or the opaque-origin case from this exact iframe only.
      if (event.origin && event.origin !== "null" && event.origin !== window.location.origin) {
        return;
      }
      const data = event && event.data;
      if (!data || data.frameId !== frameId) return;
      if (typeof data.height !== "number") return;
      // Cap height to prevent DoS via absurdly large values
      const clampedHeight = Math.min(Math.max(80, data.height + 6), 5000);
      node.style.height = `${clampedHeight}px`;
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameId]);

  return h("iframe", {
    ref: iframeRef,
    title: title || "Inline visual",
    sandbox: "allow-scripts allow-same-origin",
    srcDoc,
    scrolling: "no",
    style: {
      width: "100%",
      height: "260px",
      border: "none",
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
      if (segment.type === "meal-plan") {
        try {
          const plan = JSON.parse(segment.content);
          return h(MealPlanWidget, { key: `mp-${index}`, plan });
        } catch (err) {
          console.error("[emersus-renderer] failed to parse meal-plan fence:", err);
          return h(
            "div",
            { key: `mp-err-${index}`, style: { whiteSpace: "pre-wrap", color: "var(--text-primary)" } },
            "\u26a0 meal plan could not be parsed",
          );
        }
      }
      if (segment.type === "nutrition-log-confirm") {
        try {
          const payload = JSON.parse(segment.content);
          return h(NutritionLogConfirmWidget, { key: `nlc-${index}`, payload });
        } catch (err) {
          console.error("[emersus-renderer] failed to parse nutrition-log-confirm fence:", err);
          return h(
            "div",
            {
              key: `nlc-err-${index}`,
              style: { whiteSpace: "pre-wrap", color: "var(--text-primary)" },
            },
            "\u26a0 log preview could not be parsed",
          );
        }
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
