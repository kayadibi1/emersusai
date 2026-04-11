// Pure helper for climbing session send-type state transitions.
// Used by the climb session modal (app/workout/climb/climb.js) and
// kept framework-free so it can be unit-tested under plain node.

/**
 * Given the current send_type and a new attempt count, return the
 * send_type that should be displayed.
 *
 * Rule: "flash" requires exactly one attempt by definition. If the
 * user increments attempts past 1 while "flash" is selected, promote
 * to "send" so the log is internally consistent.
 *
 * We intentionally do NOT auto-demote "send" back to "flash" when
 * attempts drops to 1 — the user may have logged a deliberate single-
 * attempt send for a route they'd previously projected, and silently
 * flipping the label would mis-record their history.
 *
 * Unknown or falsy send types are returned unchanged. It is not this
 * helper's job to invent state.
 */
export function reconcileSendTypeForAttempts(sendType, attempts) {
  if (sendType === "flash" && attempts > 1) return "send";
  return sendType;
}
