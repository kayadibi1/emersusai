// shared/chat/url-state.js — pure URL ↔ Train state helpers.
//
// Used by /app/train (and reusable for any tabbed SPA). Pure functions only —
// callers pass the search string; no `window` access here.

export const MODALITIES = ["lift", "cardio", "swim", "climb"];
export const TABS = ["active", "history"];

const DEFAULTS = { modality: "lift", tab: "active", sessionId: "" };

function pickEnum(value, allowed) {
  return allowed.includes(value) ? value : null;
}

/**
 * Parse a URL search string into Train state.
 * @param {string} search — e.g. "?modality=cardio&tab=history&session=abc-123"
 * @returns {{ modality: string, tab: string, sessionId: string }}
 */
export function parseTrainUrl(search) {
  const out = { ...DEFAULTS };
  if (typeof search !== "string" || !search) return out;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const modality = pickEnum(params.get("modality"), MODALITIES);
  const tab = pickEnum(params.get("tab"), TABS);
  const session = params.get("session");
  if (modality) out.modality = modality;
  if (tab) out.tab = tab;
  if (session) out.sessionId = String(session);
  return out;
}

/**
 * Build a search string from Train state. Inverse of parseTrainUrl.
 * Defaults are omitted to keep URLs short.
 */
export function buildTrainUrl(state) {
  const params = new URLSearchParams();
  if (state.modality && state.modality !== DEFAULTS.modality) params.set("modality", state.modality);
  if (state.tab && state.tab !== DEFAULTS.tab) params.set("tab", state.tab);
  if (state.sessionId) params.set("session", state.sessionId);
  const query = params.toString();
  return query ? `?${query}` : "";
}
