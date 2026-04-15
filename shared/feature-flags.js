// shared/feature-flags.js — feature flag resolver for the redesign.
//
// Flags can be overridden in three places, in precedence order:
//   1. URL query string (highest):         /chat/?chat_v2=1 or ?chat_v2=0
//   2. localStorage.emersus-flags (saved): '{"chat_v2": true}'
//   3. Per-flag default (lowest):          false, unless overridden via readFlag({ defaults })
//
// Pure functions (validateFlag, readFlag, parseUrlFlagOverride) are unit-tested.
// Browser-facing wrappers (getSavedFlags, getUrlFlag, setFlag) are thin; they
// are not unit-tested but are trivial.

export const KNOWN_FLAGS = [
  'chat_v2',
  'train_v2',
  'nutrition_v2',
  'progress_v2',
  'profile_v2',
  'auth_v2',
  'public_v2',
  'conversational_onboarding',
  'chat_model_selector',
  'progress_benchmarks',
  'progress_training_load',
  'nutrition_quick_log',
  'integrations_waitlist',
];

/**
 * Default ON/OFF baseline per flag. Any flag not in this map defaults to
 * false. Phase 2 Task 13 flips chat_v2 to ON by default — users without an
 * explicit ?chat_v2=0 override or stored false now see the new chat chrome.
 */
export const DEFAULT_FLAGS = Object.freeze({
  chat_v2: true,
});

const STORAGE_KEY = 'emersus-flags';

/**
 * @param {unknown} flag
 * @returns {boolean}
 */
export function isKnownFlag(flag) {
  return typeof flag === 'string' && KNOWN_FLAGS.includes(flag);
}

/**
 * Parse a URL query-string value into a boolean override or null if invalid.
 * Accepts "1", "true" (→ true) or "0", "false" (→ false). Everything else → null.
 * @param {string | null | undefined} raw
 * @returns {boolean | null}
 */
export function parseUrlFlagOverride(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}

/**
 * Resolve the effective boolean value of a flag.
 * @param {string} flag
 * @param {{
 *   saved?: boolean | null,
 *   url?: boolean | null,
 *   defaults?: Record<string, boolean>
 * }} ctx
 * @returns {boolean}
 */
export function readFlag(flag, ctx = {}) {
  if (!isKnownFlag(flag)) return false;
  const { saved = null, url = null, defaults = {} } = ctx;
  if (typeof url === 'boolean') return url;
  if (typeof saved === 'boolean') return saved;
  return defaults[flag] === true;
}

// --- Browser-facing thin wrappers (not unit-tested) ---

/**
 * Read saved flags from localStorage. DOM effect.
 * @returns {Record<string, boolean>}
 */
export function getSavedFlags() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

/**
 * Read a URL flag override for a given flag. DOM effect.
 * @param {string} flag
 * @returns {boolean | null}
 */
export function getUrlFlag(flag) {
  try {
    const params = new URLSearchParams(window.location.search);
    return parseUrlFlagOverride(params.get(flag));
  } catch (_) {
    return null;
  }
}

/**
 * Persist a flag override to localStorage. DOM effect.
 * @param {string} flag
 * @param {boolean} value
 */
export function setFlag(flag, value) {
  if (!isKnownFlag(flag)) return;
  const flags = getSavedFlags();
  flags[flag] = !!value;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(flags)); } catch (_) {}
}

/**
 * Bootstrap helper: resolve a flag using real localStorage + URL. DOM effect.
 * Caller-supplied defaults override the global DEFAULT_FLAGS baseline.
 * @param {string} flag
 * @param {{ defaults?: Record<string, boolean> }} ctx
 * @returns {boolean}
 */
export function resolveFlag(flag, ctx = {}) {
  const saved = getSavedFlags()[flag];
  const url = getUrlFlag(flag);
  return readFlag(flag, {
    saved: typeof saved === 'boolean' ? saved : null,
    url,
    defaults: { ...DEFAULT_FLAGS, ...(ctx.defaults || {}) },
  });
}
