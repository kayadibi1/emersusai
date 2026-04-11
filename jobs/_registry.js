// jobs/_registry.js
// Central place handlers are registered. Added to progressively as jobs
// are implemented in Milestone 6. For now, a no-op so the worker can boot.
export async function registerHandlers({ boss, sql, log }) {
  log.info("registerHandlers: no handlers registered yet");
}
