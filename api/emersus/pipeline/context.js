/**
 * Pipeline context: ShortCircuit for early exits, createContext factory,
 * TimeTracker for stage instrumentation.
 */

export class ShortCircuit extends Error {
  /** @param {object} response — the full response payload to send to the client */
  constructor(response) {
    super("ShortCircuit");
    this.response = response;
  }
}

export function createContext(raw) {
  return {
    // ── Input (populated by sanitize, immutable after) ──
    question:       raw.question       ?? "",
    userId:         raw.userId         ?? "",
    stableUserId:   "",
    supabaseUserId: "",
    threadId:       raw.threadId       ?? "",
    threadState:    raw.threadState    ?? {},
    recentMessages: raw.recentMessages ?? [],
    requestMeta:    raw.requestMeta    ?? {},
    profile:        raw.profile        ?? {},
    workoutPlan:    null,
    includeDebug:   raw.includeDebug   === true,

    // ── Populated by stages ──
    plan:           null,
    evidence:       null,

    // ── Output (populated by synthesize + stream) ──
    prose:          "",
    toolResults:    {},
    sources:        [],
    confidence:     null,
    tokenUsage:     { input_tokens: 0, output_tokens: 0, total_tokens: 0, cached_tokens: 0 },
    debug:          {},

    // ── Internals ──
    _timer:         new TimeTracker(),
    _openaiResponseId: null,
    _synthesisModel: null,
    _abortController: new AbortController(),
  };
}

export class TimeTracker {
  #timings = {};

  record(name, ms) {
    if (typeof ms === "number" && Number.isFinite(ms)) {
      this.#timings[name] = Math.max(0, Math.round(ms));
    }
  }

  all() {
    return { ...this.#timings };
  }
}
