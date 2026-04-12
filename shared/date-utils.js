// shared/date-utils.js
//
// Local-date helpers. All functions return YYYY-MM-DD strings derived from
// the browser's (or Node's) *local* clock — NOT UTC. The old pattern
// `new Date().toISOString().slice(0, 10)` silently returns the UTC date,
// which diverges from the user's calendar date for anyone west of UTC
// (e.g. 7pm ET = next day in UTC).

/**
 * YYYY-MM-DD string from a local Date (defaults to now).
 */
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * YYYY-MM-DD string offset by `days` from today (negative = past).
 * Uses setDate() so month/year rollovers and DST are handled correctly.
 */
export function localDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}
