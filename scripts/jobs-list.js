// scripts/jobs-list.js
// Print the last 20 pg-boss jobs with their state and a count of
// progress log lines. Useful for operator visibility from the shell.
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

const { rows } = await pool.query(`
  SELECT
    j.id,
    j.name,
    j.state,
    j.created_on,
    j.completed_on,
    (SELECT COUNT(*) FROM job_progress p WHERE p.job_id = j.id) AS progress_lines
  FROM pgboss.job j
  ORDER BY j.created_on DESC
  LIMIT 20
`);

for (const r of rows) {
  const ts = (r.completed_on ?? r.created_on).toISOString().slice(0, 19).replace("T", " ");
  console.log(`${ts}  ${r.state.padEnd(10)}  ${r.name.padEnd(28)}  progress=${r.progress_lines}  id=${r.id}`);
}

await pool.end();
