// api/emersus/pipeline/extract-memory-circuit.js
//
// In-process circuit breaker for the Phase 5 auto-extractor.
// Spec §13 alert: 4xx/5xx write-path failures > 30% over a 5-minute rolling
// window → auto-disable the extractor for 30 minutes.
//
// Pure module state; lives in a single emersus-api process. Each process
// carries its own circuit. Sufficient for the single-VPS deployment; when
// scaling horizontally, move to a shared store (Redis / Postgres).
//
// Time injected for testability: every public fn takes `now` (Date.now()
// when omitted in production).

export const CIRCUIT_WINDOW_MS   = 5 * 60 * 1000;    // 5 minutes
export const CIRCUIT_COOLDOWN_MS = 30 * 60 * 1000;   // 30 minutes
export const CIRCUIT_MIN_SAMPLES = 5;
export const CIRCUIT_ERROR_RATE  = 0.30;

// { ts: number, err: boolean }[]
let samples = [];
let openedAt = null;
let openReason = null;
let onOpenFiredFor = null; // timestamp of the last open event we fired for

function pruneOldSamples(now) {
  const cutoff = now - CIRCUIT_WINDOW_MS;
  if (samples.length && samples[0].ts < cutoff) {
    samples = samples.filter((s) => s.ts >= cutoff);
  }
}

function evaluate(now, { onOpen } = {}) {
  // If we were open, check if the cooldown has elapsed.
  if (openedAt != null) {
    if (now - openedAt >= CIRCUIT_COOLDOWN_MS) {
      openedAt = null;
      openReason = null;
      samples = [];
      onOpenFiredFor = null;
    }
    return;
  }

  pruneOldSamples(now);

  if (samples.length < CIRCUIT_MIN_SAMPLES) return;

  const errorCount = samples.reduce((n, s) => n + (s.err ? 1 : 0), 0);
  const rate = errorCount / samples.length;

  if (rate >= CIRCUIT_ERROR_RATE) {
    openedAt = now;
    openReason = "error_rate_exceeded";
    if (onOpen && onOpenFiredFor !== openedAt) {
      onOpenFiredFor = openedAt;
      try {
        onOpen({
          reason: openReason,
          opened_at: openedAt,
          error_rate: rate,
          samples: samples.length,
        });
      } catch { /* never let alert callback crash the extractor */ }
    }
  }
}

export function recordSuccess(now = Date.now(), opts) {
  samples.push({ ts: now, err: false });
  evaluate(now, opts);
}

export function recordError(now = Date.now(), opts) {
  samples.push({ ts: now, err: true });
  evaluate(now, opts);
}

export function getCircuitStatus(now = Date.now()) {
  // Auto-close if cooldown elapsed.
  if (openedAt != null && now - openedAt >= CIRCUIT_COOLDOWN_MS) {
    openedAt = null;
    openReason = null;
    samples = [];
    onOpenFiredFor = null;
  }

  if (openedAt != null) {
    return {
      open: true,
      opened_at: openedAt,
      reason: openReason,
      cooldown_ends_at: openedAt + CIRCUIT_COOLDOWN_MS,
      error_rate: 0, // not meaningful while open
      samples: 0,
      error_count: 0,
    };
  }

  pruneOldSamples(now);
  const errorCount = samples.reduce((n, s) => n + (s.err ? 1 : 0), 0);
  return {
    open: false,
    opened_at: null,
    reason: null,
    cooldown_ends_at: null,
    error_rate: samples.length ? errorCount / samples.length : 0,
    samples: samples.length,
    error_count: errorCount,
  };
}

/** Reset for tests. Do not call in production. */
export function _resetCircuit() {
  samples = [];
  openedAt = null;
  openReason = null;
  onOpenFiredFor = null;
}
