// api/admin/jobs.js
// Uses raw pg.Pool for pgboss.job queries (cross-schema; supabase-js can't
// join pgboss.job gracefully).
import express from "express";
import pg from "pg";

const router = express.Router();

// Lazily-created shared pool (one per process lifetime).
let _pool = null;
function getPool() {
  if (!_pool && process.env.DATABASE_URL) {
    _pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// ---------------------------------------------------------------------------
// GET /?state=<state>&limit=50
// Lists pgboss.job rows with a count of associated job_progress rows.
// Supported states: created | retry | active | completed | expired | cancelled | failed
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ error: "DATABASE_URL not configured" });

  const limit = Math.min(Number(req.query.limit ?? 50), 500);
  const state = req.query.state ?? null;

  try {
    const params = [limit];
    const stateClause = state ? `WHERE j.state = $2` : "";
    if (state) params.push(state);

    const { rows } = await pool.query(
      `SELECT
          j.id,
          j.name,
          j.state,
          j.createdon,
          j.startedon,
          j.completedon,
          j.output,
          j.data,
          j.retrylimit,
          j.retrycount,
          COALESCE(p.progress_count, 0) AS progress_count
        FROM pgboss.job j
        LEFT JOIN (
          SELECT job_id, COUNT(*) AS progress_count
          FROM job_progress
          GROUP BY job_id
        ) p ON p.job_id::text = j.id::text
        ${stateClause}
        ORDER BY j.createdon DESC
        LIMIT $1`,
      params
    );
    res.json({ jobs: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /:id/progress?since=<seq>
// Returns job_progress rows with seq > since (for incremental polling).
// ---------------------------------------------------------------------------
router.get("/:id/progress", async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ error: "DATABASE_URL not configured" });

  const jobId = req.params.id;
  const since = Number(req.query.since ?? 0);

  try {
    const { rows } = await pool.query(
      `SELECT seq, job_id, step, message, pct, created_at
         FROM job_progress
        WHERE job_id = $1
          AND seq > $2
        ORDER BY seq ASC`,
      [jobId, since]
    );
    res.json({ progress: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
