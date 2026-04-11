// scripts/lib/run-as-job.js
// Shared CLI helper: enqueue a pg-boss job, tail its progress log,
// exit with the job's terminal status code.
//
// Usage from a wrapper:
//   import { runAsJob } from "./lib/run-as-job.js";
//   await runAsJob("embed-batch", { limit: 500 });
//
// Exit codes: 0 on completed, 1 on failed, 130 on cancelled/SIGINT.
//
// Ctrl+C handling: cancels the job SERVER-side via boss.cancel(), then exits.
// Never leaves orphan server-side work just because the local process died.
import "dotenv/config";
import PgBoss from "pg-boss";
import pg from "pg";

const POLL_MS = 1000;

/**
 * @param {string} jobName
 * @param {object} payload
 * @param {object} [options]
 * @param {boolean} [options.detach] If true, enqueue, print jobId, exit.
 */
export async function runAsJob(jobName, payload, options = {}) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not set");
    process.exit(2);
  }

  const boss = new PgBoss(databaseUrl);
  boss.on("error", err => console.error(`[run-as-job] pg-boss error: ${err.message}`));
  await boss.start();

  // pg-boss v10 requires the queue exist before send()
  await boss.createQueue(jobName).catch(() => {});

  const jobId = await boss.send(jobName, payload, { retryLimit: 0 });
  console.error(`[run-as-job] enqueued ${jobName} as ${jobId}`);

  if (options.detach) {
    process.stdout.write(jobId + "\n");
    await boss.stop({ graceful: true });
    process.exit(0);
  }

  // Direct pg pool for progress + state polling
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

  // Cancel on SIGINT: cancel the job on the server, stop pg-boss, exit.
  let shuttingDown = false;
  const handleSigint = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error("\n[run-as-job] cancelling job on server...");
    try { await boss.cancel(jobName, jobId); } catch (e) { /* ignore */ }
    try { await pool.end(); } catch (e) { /* ignore */ }
    try { await boss.stop({ graceful: true }); } catch (e) { /* ignore */ }
    process.exit(130);
  };
  process.on("SIGINT", handleSigint);

  let lastSeq = 0;
  while (true) {
    // Fetch any new progress rows
    const progress = await pool.query(
      `SELECT seq, level, message, ts FROM job_progress
        WHERE job_id = $1 AND seq > $2
        ORDER BY seq ASC`,
      [jobId, lastSeq]
    );
    for (const row of progress.rows) {
      lastSeq = Number(row.seq);
      const prefix = row.level === "error" ? "[err] " : row.level === "warn" ? "[warn] " : "";
      process.stdout.write(prefix + row.message + "\n");
    }

    // Check job state
    const stateResult = await pool.query(
      `SELECT state, output FROM pgboss.job WHERE id = $1`,
      [jobId]
    );
    const state = stateResult.rows[0]?.state;

    if (state === "completed") {
      await pool.end();
      await boss.stop({ graceful: true });
      process.exit(0);
    }
    if (state === "failed") {
      const output = stateResult.rows[0]?.output;
      console.error(`[run-as-job] job failed: ${output?.message ?? JSON.stringify(output)}`);
      await pool.end();
      await boss.stop({ graceful: true });
      process.exit(1);
    }
    if (state === "cancelled") {
      await pool.end();
      await boss.stop({ graceful: true });
      process.exit(130);
    }

    await new Promise(r => setTimeout(r, POLL_MS));
  }
}
