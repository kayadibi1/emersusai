// Pure capability-check for the Web Share API with file payloads.
// Extracted from shared/share-modal.js so the logic can be unit-tested
// in plain node with fake navigators, and so the real module can cache
// the result at module-load time instead of recomputing it on every
// React render.

/**
 * Returns true iff the current environment can share a File via the
 * Web Share API's `navigator.share({ files })` flow.
 *
 * Takes the navigator and File constructor as explicit parameters so
 * the function is fully testable without touching real browser globals.
 *
 * Swallows any synchronous error from the File constructor or from
 * `navigator.canShare` — the correct fallback in every case is to hide
 * the native-share button and let the user Download / Copy instead.
 */
export function computeCanShareFiles(nav, FileCtor) {
  if (!nav || typeof nav.canShare !== "function") return false;
  if (typeof FileCtor !== "function") return false;
  try {
    const probe = new FileCtor([""], "test.png", { type: "image/png" });
    return Boolean(nav.canShare({ files: [probe] }));
  } catch {
    return false;
  }
}
