// Decides whether a request should use `previous_response_id` chaining
// instead of sending the full `messages` array. Input: the thread's
// persisted messages + the current feature-flag state. Output: a decision
// object consumed by synthesize.js buildRequestBody.

const EXPIRY_WINDOW_MS = 25 * 24 * 60 * 60 * 1000; // 25 days; OpenAI retains 30

export function resolveChainingContext({ flagEnabled, messages, now = Date.now() }) {
  if (!flagEnabled) {
    return { shouldChain: false, reason: "flag_disabled" };
  }

  const list = Array.isArray(messages) ? messages : [];
  let newest = null;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m.role !== "assistant") continue;
    if (!m.openaiResponseId) continue;
    newest = m;
    break;
  }

  if (!newest) {
    return { shouldChain: false, reason: "no_prior_response_id" };
  }

  const createdAt = typeof newest.createdAt === "string"
    ? new Date(newest.createdAt).getTime()
    : Number(newest.createdAt || 0);

  if (!Number.isFinite(createdAt) || now - createdAt > EXPIRY_WINDOW_MS) {
    return { shouldChain: false, reason: "expired", previousResponseId: newest.openaiResponseId };
  }

  return { shouldChain: true, reason: "ok", previousResponseId: newest.openaiResponseId };
}
