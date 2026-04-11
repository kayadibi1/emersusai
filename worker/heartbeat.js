// worker/heartbeat.js
// Writes a row to worker_heartbeats every `intervalMs`. The main loop is a
// simple setInterval — no backoff, no jitter. If a write fails (transient DB
// issue), we log to stderr and keep going; missed beats are handled by the
// watchdog not by the heartbeat itself.

export function startHeartbeat({ sql, workerId, intervalMs = 30_000 }) {
  let jobsProcessed = 0;

  async function beat() {
    try {
      await sql`
        INSERT INTO worker_heartbeats (worker_id, last_beat_at, jobs_processed_since_start)
        VALUES (${workerId}, now(), ${jobsProcessed})
        ON CONFLICT (worker_id) DO UPDATE
          SET last_beat_at = EXCLUDED.last_beat_at,
              jobs_processed_since_start = EXCLUDED.jobs_processed_since_start
      `;
    } catch (err) {
      process.stderr.write(`[heartbeat] write failed: ${err.message}\n`);
    }
  }

  // Immediate beat so the row exists right after startup
  beat();
  const timer = setInterval(beat, intervalMs);

  return {
    timer,
    incrementJobsProcessed: () => { jobsProcessed += 1; },
  };
}

export function stopHeartbeat(handle) {
  if (handle?.timer) clearInterval(handle.timer);
}
