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
  useState,
} from "react";
import MealPlanWidget from "./meal-plan-widget.js";
import NutritionLogConfirmWidget from "./nutrition-log-confirm-widget.js";

const h = React.createElement;
const MAX_WIDGET_FRAME_HEIGHT = 1400;

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
// Tracks the app's Graphite·Jade (dark) + Paper·Royal (light) palettes — both
// token sets are emitted, scoped on :root[data-theme=...]. The iframe <html>
// element gets the current theme attribute, so widgets follow the parent
// palette. On palette switch, WidgetFrame re-renders the srcDoc so Chart.js
// defaults pick up the new CSS vars too. Token names are unchanged so older
// widgets (#color-background-primary etc.) keep working; only the values are
// remapped per-palette.
export const EMERSUS_THEME_CSS = `
  @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap");
  :root {
    /* Static tokens (shared across palettes). Palette-specific tokens live
       in the :root[data-theme=...] blocks below. */
    --border-radius-sm: 6px;
    --border-radius-md: 8px;
    --border-radius-lg: 10px;
    --radius-md: var(--border-radius-md);
    --radius-lg: var(--border-radius-lg);
    --font-sans: 'Space Grotesk', system-ui, -apple-system, sans-serif;
    --font-display: 'Space Grotesk', system-ui, -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, monospace;

    /* --bg-* / --text-* aliases (backward compatible with older widgets) */
    --bg-primary: var(--color-background-primary);
    --bg-secondary: var(--color-background-secondary);
    --bg-tertiary: var(--color-background-tertiary);
    --text-primary: var(--color-text-primary);
    --text-secondary: var(--color-text-secondary);
    --text-tertiary: var(--color-text-tertiary);
    --border-default: var(--color-border-tertiary);
    --border-hover: var(--color-border-primary);
  }

  /* ---------- GRAPHITE · JADE (dark, default) ---------- */
  :root[data-theme="mint"] {
    color-scheme: dark;
    --color-background-primary: #0a0a0b;
    --color-background-secondary: rgba(255,255,255,0.06);
    --color-background-tertiary: rgba(255,255,255,0.10);
    --color-surface-faint: rgba(255,255,255,0.025);
    --color-text-primary: #ededee;
    --color-text-secondary: #8a8a8f;
    --color-text-tertiary: #55555a;
    --color-border-primary: rgba(255,255,255,0.10);
    --color-border-secondary: rgba(255,255,255,0.06);
    --color-border-tertiary: rgba(255,255,255,0.06);
    --accent-primary: #34d399;
    --accent-secondary: #34d399;
    --accent-soft: rgba(52,211,153,0.10);
    --accent-line: rgba(52,211,153,0.34);
    --color-background-success: rgba(52,211,153,0.12);
    --color-text-success: #34d399;
    --color-background-warning: rgba(251,191,36,0.14);
    --color-text-warning: #fbbf24;
    --color-background-danger: rgba(248,113,113,0.12);
    --color-text-danger: #f87171;
    --color-background-info: rgba(96,165,250,0.12);
    --color-text-info: #60a5fa;
    --color-border-info: rgba(96,165,250,0.32);
    --ev-strong-bg: rgba(52,211,153,0.12);
    --ev-strong-text: #34d399;
    --ev-strong-dot: #34d399;
    --ev-moderate-bg: rgba(251,191,36,0.14);
    --ev-moderate-text: #fbbf24;
    --ev-moderate-dot: #fbbf24;
    --ev-limited-bg: rgba(248,113,113,0.12);
    --ev-limited-text: #f87171;
    --ev-limited-dot: #f87171;
    --ev-insufficient-bg: rgba(255,255,255,0.05);
    --ev-insufficient-text: #a7adb4;
    --ev-insufficient-dot: #6f7480;
    /* interactive / chart palette */
    --input-bg: rgba(255,255,255,0.03);
    --input-bg-hover: rgba(255,255,255,0.05);
    --input-bg-focus: rgba(52,211,153,0.06);
    --button-bg: rgba(255,255,255,0.04);
    --chart-axis: rgba(255,255,255,0.65);
    --chart-grid: rgba(255,255,255,0.06);
    --chart-border: rgba(255,255,255,0.08);
    --card-inset: rgba(255,255,255,0.04);
    /* categorical chart-data palette — tuned for perceptual distinction on
       the dark Graphite surface. Rotate through these for multi-series data,
       never the semantic success/warning/danger/info tokens (those share
       hues with the accent on one palette or the other). */
    --chart-series-1: #34d399;
    --chart-series-2: #60a5fa;
    --chart-series-3: #fbbf24;
    --chart-series-4: #f87171;
    --chart-series-5: #c084fc;
  }

  /* ---------- PAPER · ROYAL (light) ---------- */
  :root[data-theme="paper"] {
    color-scheme: light;
    --color-background-primary: #f4efe5;
    --color-background-secondary: rgba(26,24,19,0.06);
    --color-background-tertiary: rgba(26,24,19,0.10);
    --color-surface-faint: rgba(26,24,19,0.025);
    --color-text-primary: #1a1813;
    --color-text-secondary: #5e564a;
    --color-text-tertiary: #8f8676;
    --color-border-primary: rgba(26,24,19,0.18);
    --color-border-secondary: rgba(26,24,19,0.10);
    --color-border-tertiary: rgba(26,24,19,0.10);
    --accent-primary: #3b82f6;
    --accent-secondary: #3b82f6;
    --accent-soft: rgba(59,130,246,0.10);
    --accent-line: rgba(59,130,246,0.36);
    --color-background-success: rgba(74,124,15,0.12);
    --color-text-success: #4a7c0f;
    --color-background-warning: rgba(199,138,10,0.14);
    --color-text-warning: #c78a0a;
    --color-background-danger: rgba(197,48,48,0.12);
    --color-text-danger: #c53030;
    --color-background-info: rgba(37,99,235,0.12);
    --color-text-info: #2563eb;
    --color-border-info: rgba(37,99,235,0.32);
    --ev-strong-bg: rgba(74,124,15,0.14);
    --ev-strong-text: #4a7c0f;
    --ev-strong-dot: #4a7c0f;
    --ev-moderate-bg: rgba(199,138,10,0.14);
    --ev-moderate-text: #c78a0a;
    --ev-moderate-dot: #c78a0a;
    --ev-limited-bg: rgba(197,48,48,0.12);
    --ev-limited-text: #c53030;
    --ev-limited-dot: #c53030;
    --ev-insufficient-bg: rgba(26,24,19,0.05);
    --ev-insufficient-text: #8f8676;
    --ev-insufficient-dot: #8f8676;
    /* interactive / chart palette */
    --input-bg: rgba(26,24,19,0.025);
    --input-bg-hover: rgba(26,24,19,0.05);
    --input-bg-focus: rgba(59,130,246,0.06);
    --button-bg: rgba(26,24,19,0.04);
    --chart-axis: #5e564a;
    --chart-grid: rgba(26,24,19,0.10);
    --chart-border: rgba(26,24,19,0.18);
    --card-inset: rgba(26,24,19,0.04);
    /* categorical chart-data palette — deeper saturated hues so multi-series
       data reads on the cream surface without washing out. */
    --chart-series-1: #3b82f6;
    --chart-series-2: #16a34a;
    --chart-series-3: #d97706;
    --chart-series-4: #dc2626;
    --chart-series-5: #9333ea;
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
    max-width: 100vw;
    overflow-x: hidden;
  }
  body {
    padding: 0;
  }
  /* Minimal card treatment for the model's wrapper card. */
  [style*="--color-background-primary"],
  [style*="background:var(--color-background-primary)"],
  [style*="background: var(--color-background-primary)"] {
    box-shadow: 0 1px 0 var(--card-inset) inset;
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
    border-bottom: 1px solid var(--accent-line);
    transition: color 140ms ease, border-color 140ms ease;
  }
  a:hover { color: var(--accent-secondary); border-bottom-color: var(--accent-primary); }
  input[type="text"], input[type="number"], input[type="search"], select, textarea {
    width: 100%;
    padding: 9px 12px;
    border: 1px solid var(--color-border-secondary);
    border-radius: var(--border-radius-md);
    background: var(--input-bg);
    color: var(--color-text-primary);
    font: inherit;
    transition: border-color 140ms ease, background 140ms ease;
  }
  input[type="text"]:hover, input[type="number"]:hover, select:hover, textarea:hover {
    border-color: var(--color-border-primary);
    background: var(--input-bg-hover);
  }
  input[type="text"]:focus, input[type="number"]:focus, select:focus, textarea:focus {
    outline: none;
    border-color: var(--accent-primary);
    background: var(--input-bg-focus);
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
    background: var(--button-bg);
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
    border-color: var(--accent-line);
    background: var(--accent-soft);
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
function readCurrentTheme() {
  if (typeof document === "undefined") return "mint";
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "paper" ? "paper" : "mint";
}

// Historical widget HTML (cached in old threads, or generated by a not-yet-
// redeployed backend) hardcoded the legacy off-white/dark-surface palette
// that the old system prompt instructed. Those literals stay fixed under
// Paper·Royal → white text on cream = unreadable. This pass rewrites the
// documented legacy color patterns to palette-aware CSS vars so old widgets
// still render correctly. Targets inline `style="color: <legacy>"` attribute
// values only — JS string literals like `"#f9f9fd"` have an intervening
// quote so the `prop\s*:\s*<value>` regex misses them and we don't mangle
// Chart.js configs. Safe because nothing legitimate uses this exact palette.
function remapLegacyWidgetColors(html) {
  if (!html || typeof html !== "string") return html;
  return html
    // off-white text → palette ink
    .replace(/color\s*:\s*#f9f9fd\b/gi, "color: var(--color-text-primary)")
    .replace(/color\s*:\s*#e8e8e8\b/gi, "color: var(--color-text-primary)")
    // dark surface → palette bg
    .replace(/background(-color)?\s*:\s*#0c0e11\b/gi, "background$1: var(--color-background-primary)")
    .replace(/background(-color)?\s*:\s*#08080a\b/gi, "background$1: var(--color-background-primary)")
    // chart axis/grid defaults (only caught if a widget overrode them inline)
    .replace(/color\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.(?:55|65|75)\s*\)/gi, "color: var(--chart-axis)")
    .replace(/color\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.(?:06|08|10)\s*\)/gi, "color: var(--chart-grid)")
    // legacy accent hex (pre-redesign green + pre-redesign royal)
    .replace(/color\s*:\s*#(78dc14|9ffb00|6d9fff)\b/gi, "color: var(--accent-primary)")
    .replace(/background(-color)?\s*:\s*#(78dc14|9ffb00|6d9fff)\b/gi, "background$1: var(--accent-primary)");
}

export function WidgetFrame({ code, html, title }) {
  const widgetBody = remapLegacyWidgetColors(code || html || "");
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

  // Follow the host palette. Re-rendering srcDoc reloads the iframe with the
  // new data-theme attr, and Chart.js defaults re-read the updated CSS vars
  // so freshly drawn charts match too.
  const [theme, setTheme] = useState(readCurrentTheme);
  useEffect(() => {
    function onThemeChange(e) {
      const next = e && e.detail && e.detail.theme;
      if (next === "mint" || next === "paper") setTheme(next);
    }
    document.addEventListener("emersus:themechange", onThemeChange);
    return () => document.removeEventListener("emersus:themechange", onThemeChange);
  }, []);

  const srcDoc = useMemo(() => {
    const safeId = JSON.stringify(frameId);
    const safeParentOrigin = JSON.stringify(parentOrigin);
    const safeTheme = theme === "paper" ? "paper" : "mint";
    // Chart.js is loaded in the <head> as a classic (synchronous) script so
    // it is guaranteed to be defined on window before any body-level <script>
    // the widget HTML contains runs. The system prompt tells the model that
    // `Chart` is pre-loaded; without this line that claim is a lie and any
    // widget that emits `new Chart(canvas, ...)` without its own <script src>
    // throws a silent ReferenceError inside the sandbox and leaves a blank
    // canvas. The browser HTTP-caches the CDN fetch across all iframes on
    // the page, so the 70 KB payload is paid once per session.
    return `<!DOCTYPE html>
<html lang="en" data-theme="${safeTheme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: blob:; connect-src 'none'">
  <style>${EMERSUS_THEME_CSS}</style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js" crossorigin="anonymous"></script>
  <script>
    // Pre-set Chart.js global defaults so every chart the model emits inherits
    // the current Emersus palette without each widget having to remember. The
    // values are read from the CSS custom properties we just injected, so
    // Graphite·Jade (dark) and Paper·Royal (light) both work without per-palette
    // JS. Re-read happens on every iframe load — WidgetFrame re-renders srcDoc
    // when the host theme flips, so new Chart(...) calls after a flip pick up
    // the updated vars. Existing Chart instances stay in the old palette (the
    // widget would need to redraw to pick up new defaults, which is rare).
    var _rs = getComputedStyle(document.documentElement);
    var _get = function (name, fallback) {
      var v = (_rs.getPropertyValue(name) || '').trim();
      return v || fallback;
    };
    var _axis = _get('--chart-axis', 'rgba(255,255,255,0.65)');
    var _grid = _get('--chart-grid', 'rgba(255,255,255,0.06)');
    var _border = _get('--chart-border', 'rgba(255,255,255,0.08)');
    // Resolved categorical chart palette — exposed as a window array because
    // Chart.js (and any widget JS) can't resolve CSS vars in config strings.
    // Widgets use window.EMERSUS_CHART_SERIES[0..4] to pull palette-correct
    // hex values that still track the host theme (re-resolves on iframe
    // reload after a theme flip).
    window.EMERSUS_CHART_SERIES = [
      _get('--chart-series-1', '#34d399'),
      _get('--chart-series-2', '#60a5fa'),
      _get('--chart-series-3', '#fbbf24'),
      _get('--chart-series-4', '#f87171'),
      _get('--chart-series-5', '#c084fc'),
    ];
    if (typeof Chart !== "undefined") {
      Chart.defaults.color = _axis;
      Chart.defaults.borderColor = _border;
      Chart.defaults.font.family = "'Space Grotesk', system-ui, -apple-system, sans-serif";
      Chart.defaults.font.size = 11;
      if (Chart.defaults.scale && Chart.defaults.scale.grid) {
        Chart.defaults.scale.grid.color = _grid;
      }
      if (Chart.defaults.plugins && Chart.defaults.plugins.legend) {
        Chart.defaults.plugins.legend.labels = Chart.defaults.plugins.legend.labels || {};
        Chart.defaults.plugins.legend.labels.color = _axis;
      }
    }
  </script>
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
  }, [widgetBody, frameId, parentOrigin, theme]);

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
      // Safety fuse: a widget that uses viewport-height CSS can feed the
      // auto-resizer back into itself and keep ratcheting upward. Clamp the
      // surface to a large but finite height and allow internal scrolling.
      const requestedHeight = Math.max(80, data.height + 6);
      const clampedHeight = Math.min(requestedHeight, MAX_WIDGET_FRAME_HEIGHT);
      node.style.height = `${clampedHeight}px`;
      node.setAttribute("scrolling", requestedHeight > MAX_WIDGET_FRAME_HEIGHT ? "auto" : "no");
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
      maxWidth: "100%",
      height: "260px",
      maxHeight: `${MAX_WIDGET_FRAME_HEIGHT}px`,
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
