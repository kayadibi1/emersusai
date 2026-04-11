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
    const args = [limit];
    let where = "";
    if (state) {
      args.unshift(state);
      where = "WHERE j.state = $1";
    }
    const { rows } = await pool.query(
      `SELECT
          j.id,
          j.name,
          j.state,
          j.created_on,
          j.started_on,
          j.completed_on,
          j.retry_count,
          j.retry_limit,
          j.output,
          (SELECT COUNT(*) FROM public.job_progress p WHERE p.job_id = j.id) AS progress_lines
        FROM pgboss.job j
        ${where}
        ORDER BY j.created_on DESC
        LIMIT $${args.length}`,
      args
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
      `SELECT seq, level, message, ts
         FROM public.job_progress
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
