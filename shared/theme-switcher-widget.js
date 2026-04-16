// shared/theme-switcher-widget.js — floating palette switcher for pages that
// don't have a dedicated nav slot for it (static legal/contact pages).
//
// Injects a `.palette-switch` widget pinned to the top-right corner via the
// styles already in chrome.css. Calls bindSwitcher() so clicks toggle the
// theme + persist to localStorage. Idempotent — calling twice is a no-op.

import { bindSwitcher } from "/shared/theme.js";

let mounted = false;

export function mountFloatingSwitcher() {
  if (mounted) return;
  mounted = true;
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
