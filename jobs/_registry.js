// jobs/_registry.js
// Central place handlers are registered. Added to progressively as jobs
// are implemented in Milestone 6. For now, a no-op so the worker can boot.
//
// NOTE: the caller (worker/index.js) passes { boss, sql, log,
// incrementJobsProcessed }. Handlers added in Milestone 6 should call
// incrementJobsProcessed() after each successful job so the heartbeat row
// tracks throughput. Destructured here as a reminder for future contributors.
export async function registerHandlers({ boss, sql, log, incrementJobsProcessed }) {
  log.info("registerHandlers: no handlers registered yet");
}
