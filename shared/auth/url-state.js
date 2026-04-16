// shared/auth/url-state.js — pure URL ↔ Auth panel state.
//
// Panels: login | signup | forgot. Default = login. Pure, testable —
// no DOM access here.

export const PANELS = ["login", "signup", "forgot"];

export function parseAuthUrl(search) {
  const out = { panel: "login" };
  if (typeof search !== "string" || !search) return out;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const panel = params.get("panel");
  if (panel && PANELS.includes(panel)) out.panel = panel;
  return out;
}

export function buildAuthUrl(state) {
  const params = new URLSearchParams();
  if (state.panel && state.panel !== "login") params.set("panel", state.panel);
  const query = params.toString();
  return query ? `?${query}` : "";
}
