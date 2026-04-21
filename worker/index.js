// worker/index.js
// pm2 entry for emersus-worker. Boots pg-boss, clears stale heartbeats,
// starts the heartbeat loop, registers all job handlers from jobs/_registry.js,
// and handles graceful shutdown on SIGINT/SIGTERM.
import "dotenv/config";
import PgBoss from "pg-boss";
import pg from "pg";
import { startHeartbeat, stopHeartbeat } from "./heartbeat.js";
import { createLogger } from "./logger.js";
// Registry is imported lazily after boss.start() so handlers can reference
// a started boss via a shared module-level variable in _registry.js.

const WORKER_ID = process.env.WORKER_ID ?? `emersus-worker-${process.pid}`;
const log = createLogger(WORKER_ID);

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log.error("DATABASE_URL not set — cannot start worker");
    process.exit(1);
  }

  const boss = new PgBoss(databaseUrl);
  boss.on("error", err => log.error("pg-boss error", { err: err.message }));
  await boss.start();
  log.info("pg-boss started");

  // Direct pg pool for heartbeat + progress writes (bypasses pg-boss).
  // Pool size = 8 so 4 concurrent embed-batch handlers can each hold a
  // client for the SELECT…FOR UPDATE SKIP LOCKED + OpenAI round-trip + UPDATE
  // transaction (~30–60s wall), leaving headroom for heartbeat + progress.
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const sql = async (strings, ...vals) => {
    // Simple tagged template -> parameterized query
    let text = strings[0];
    for (let i = 0; i < vals.length; i++) text += `$${i + 1}` + strings[i + 1];
    return pool.query(text, vals);
  };

  // Ensure job_progress FK to pgboss.job exists (idempotent — safe on re-start).
  // The schema migration couldn't set this up because pgboss.job doesn't exist
  // until the first boss.start() call creates the pgboss schema.
  //
  // NOTE: pg-boss v10 uses a PARTITIONED table for pgboss.job with composite PK
  // (name, id). Postgres forbids FK references to a non-unique column in a
  // partitioned table, so the FK on job_id alone cannot be created. We skip it
  // and log a warning — the FK is a nicety for cascade deletes, not a blocker.
  try {
    const { rows: pgbossTables } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'pgboss' ORDER BY table_name`
    );
    const jobTable = pgbossTables.find(r => r.table_name === "job");
    if (!jobTable) {
      log.warn("job_progress FK skipped — pgboss.job table not found");
    } else {
      // Check if pgboss.job has a standalone unique constraint on id (older pg-boss versions)
      const { rows: constraints } = await pool.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'pgboss.job'::regclass
          AND contype IN ('p','u')
          AND array_length(conkey, 1) = 1
      `);
      if (constraints.length > 0) {
        await sql`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'job_progress_job_id_fk'
            ) THEN
              ALTER TABLE public.job_progress
                ADD CONSTRAINT job_progress_job_id_fk
                FOREIGN KEY (job_id) REFERENCES pgboss.job(id) ON DELETE CASCADE;
            END IF;
          END
          $$;
        `;
        log.info("job_progress FK verified");
      } else {
        // Orphan rows (job_progress entries pointing at deleted pgboss.job ids)
        // accumulate instead of cascading. The scheduled cleanup-job-progress
        // handler (Milestone 6, Task 6.10) sweeps rows older than 30 days as a
        // blunt but sufficient remedy. Don't try to ALTER pgboss.job — that's
        // pg-boss's schema, not ours.
        log.warn("job_progress FK skipped — pgboss.job uses composite PK (partitioned table); FK on id alone not possible; orphans cleaned up by cleanup-job-progress job");
      }
    }
  } catch (err) {
    log.warn("job_progress FK could not be applied — continuing", { err: err.message });
  }

  // Clear stale heartbeats from a prior worker instance
  await sql`
    DELETE FROM worker_heartbeats
    WHERE last_beat_at < now() - interval '10 minutes'
       OR worker_id = ${WORKER_ID}
  `;

  const hb = startHeartbeat({ sql, workerId: WORKER_ID, intervalMs: 30_000 });
  log.info("heartbeat started");

  // Register job handlers
  const { registerHandlers } = await import("../jobs/_registry.js");
  await registerHandlers({ boss, sql, pool, log, incrementJobsProcessed: hb.incrementJobsProcessed });
  log.info("handlers registered");

  // Re-entrant guard: rapid Ctrl+C or overlapping signals would otherwise
  // call boss.stop() and pool.end() concurrently. First call wins; subsequent
  // signals are silently ignored.
  let shuttingDown = false;
  const shutdown = async (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`received ${sig}, shutting down`);
    stopHeartbeat(hb);
    await boss.stop({ graceful: true, wait: true });
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  log.info("worker ready");
}

main().catch(err => {
  log.error("fatal", { err: err.message, stack: err.stack });
  process.exit(1);
});
