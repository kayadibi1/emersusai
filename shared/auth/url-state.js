// shared/auth/url-state.js — pure URL ↔ Auth panel state.
//
// Panels: login | request | forgot | invite. Default = login. invite requires
// a token query param. Pure, testable — no DOM access here.

export const PANELS = ["login", "request", "forgot", "invite"];

export function parseAuthUrl(search) {
  const out = { panel: "login", token: "" };
  if (typeof search !== "string" || !search) return out;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const panel = params.get("panel");
  if (panel && PANELS.includes(panel)) out.panel = panel;
  const token = params.get("token");
  if (token) out.token = String(token);
  // If we got a token but no explicit panel, infer invite.
  if (out.token && out.panel === "login") out.panel = "invite";
  return out;
}

export function buildAuthUrl(state) {
  const params = new URLSearchParams();
  if (state.panel && state.panel !== "login") params.set("panel", state.panel);
  if (state.token) params.set("token", state.token);
  const query = params.toString();
  return query ? `?${query}` : "";
}
