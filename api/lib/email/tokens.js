// api/lib/email/tokens.js
// Frozen color + typography constants for every email. Values mirror
// Graphite·Jade from shared/design-tokens.css. Inlined everywhere because
// most email clients (including Outlook desktop) don't honor CSS variables
// or @media queries outside narrow cases.

export const T = Object.freeze({
  bg:         "#0a0a0b",
  surface:    "#131315",
  surfaceAlt: "#18181b",
  ink:        "#ededee",
  muted:      "#c0c0c4",
  dim:        "#8a8a8f",
  line:       "rgba(255,255,255,0.10)",
  lineStrong: "rgba(255,255,255,0.16)",
  accent:     "#34d399",
  accentInk:  "#04221a",
  accentLine: "rgba(52,211,153,0.34)",
  danger:     "#f87171",
  warning:    "#fbbf24",
  info:       "#60a5fa",
  stack: Object.freeze({
    sans: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
  }),
});
