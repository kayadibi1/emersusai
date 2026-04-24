// shared/theme-switcher-widget.js — floating palette switcher for pages that
// don't have a dedicated nav slot for it (static legal/contact pages).
//
// Used on /privacy, /terms, /contact, /consumer-health-data, /demo —
// pages that load site.css + static.css but NOT chrome.css, which is
// where .palette-switch / .palette-swatch styles used to live. Before
// the inline style injection below, the switcher rendered as two 16×6
// unstyled default buttons (failed WCAG 2.5.5 tap-target) and looked
// like a bug. Self-contained styles avoid the cross-sheet dependency.

import { bindSwitcher } from "/shared/theme.js";

let mounted = false;
let stylesInjected = false;

const STYLE_ID = "emersus-theme-switcher-styles";
const CSS = `
  .palette-switch {
    position: fixed; top: 16px; right: 16px; z-index: 100;
    background: var(--switch-bg, var(--surface, rgba(20,20,24,0.68)));
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid var(--line-strong, rgba(255,255,255,0.12));
    border-radius: 12px;
    padding: 8px;
    display: flex; gap: 8px; align-items: center;
    box-shadow: 0 8px 24px -12px rgba(0,0,0,0.4);
  }
  .palette-switch .palette-swatch {
    width: 44px; height: 44px;
    border-radius: 10px;
    background: var(--sw-bg);
    border: 1px solid rgba(128,128,128,0.25);
    cursor: pointer; position: relative;
    outline: 2px solid transparent;
    outline-offset: 2px;
    transition: transform .15s;
    padding: 0;
  }
  .palette-switch .palette-swatch:hover { transform: scale(1.06); }
  .palette-switch .palette-swatch.active { outline-color: var(--accent, #34d399); }
  .palette-switch .palette-swatch::after {
    content: ""; position: absolute;
    bottom: 6px; right: 6px;
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--sw-accent);
    box-shadow: 0 0 4px var(--sw-accent);
  }
  @media (max-width: 520px) {
    .palette-switch { top: auto; bottom: 16px; right: 16px; }
  }
`;

function injectStyles() {
  if (stylesInjected || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  stylesInjected = true;
}

export function mountFloatingSwitcher() {
  if (mounted) return;
  mounted = true;
  injectStyles();
  const wrap = document.createElement("div");
  wrap.className = "palette-switch";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Theme");
  wrap.innerHTML = `
    <button type="button" class="palette-swatch" data-theme-swatch="mint"  aria-label="Graphite · Jade (dark)" style="--sw-bg: linear-gradient(135deg, #1a1d23 0%, #2a2f38 100%); --sw-accent: #34d399;"></button>
    <button type="button" class="palette-swatch" data-theme-swatch="paper" aria-label="Paper · Royal (light)" style="--sw-bg: linear-gradient(135deg, #fafaf7 0%, #ecebe5 100%); --sw-accent: #3b82f6;"></button>
  `;
  document.body.appendChild(wrap);
  bindSwitcher(wrap);
}
