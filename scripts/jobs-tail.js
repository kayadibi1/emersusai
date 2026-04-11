// scripts/jobs-tail.js
// Tail a pg-boss job by id — prints progress log lines as they arrive,
// polls job state, exits with the job's terminal status code.
// Same polling logic as run-as-job.js, but for a job that was enqueued
// elsewhere (e.g., via --detach or the admin UI).
import "dotenv/config";
import pg from "pg";

const POLL_MS = 1000;

const jobId = process.argv[2];
if (!jobId) {
  console.error("Usage: node scripts/jobs-tail.js <jobId>");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
let lastSeq = 0;

while (true) {
  const progress = await pool.query(
    `SELECT seq, level, message FROM job_progress
      WHERE job_id = $1 AND seq > $2 ORDER BY seq ASC`,
    [jobId, lastSeq]
  );
  for (const row of progress.rows) {
    lastSeq = Number(row.seq);
    const prefix = row.level === "error" ? "[err] " : row.level === "warn" ? "[warn] " : "";
    process.stdout.write(prefix + row.message + "\n");
  }

  const state = await pool.query(`SELECT state, output FROM pgboss.job WHERE id = $1`, [jobId]);
  const s = state.rows[0]?.state;
  if (s === "completed") { await pool.end(); process.exit(0); }
  if (s === "failed")    { console.error(`[tail] failed: ${JSON.stringify(state.rows[0]?.output)}`); await pool.end(); process.exit(1); }
  if (s === "cancelled") { await pool.end(); process.exit(130); }
  if (!s)                { console.error(`[tail] no job with id ${jobId}`); await pool.end(); process.exit(2); }

  await new Promise(r => setTimeout(r, POLL_MS));
}
