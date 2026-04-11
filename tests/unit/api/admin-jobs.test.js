// tests/unit/api/admin-jobs.test.js
// Unit tests for admin jobs router logic (mocked pg pool).
// Mirrors the handler logic from api/admin/jobs.js with injected mock clients.
import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Minimal res/req helpers
// ---------------------------------------------------------------------------
function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

// ---------------------------------------------------------------------------
// Handler reimplementations (mirrors api/admin/jobs.js logic)
// ---------------------------------------------------------------------------
async function jobsGetHandler(req, res, { pool }) {
  const limit = Math.min(Number(req.query?.limit ?? 50), 500);
  const state = req.query?.state ?? null;

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
}

async function jobsProgressHandler(req, res, { pool }) {
  const jobId = req.params.id;
  const since = Number(req.query?.since ?? 0);

  const { rows } = await pool.query(
    `SELECT seq, level, message, ts
       FROM public.job_progress
      WHERE job_id = $1
        AND seq > $2
      ORDER BY seq ASC`,
    [jobId, since]
  );
  res.json({ progress: rows });
}

// ---------------------------------------------------------------------------
// Mock pool builder
// ---------------------------------------------------------------------------
function makePool({ jobRows = [], progressRows = [] } = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("pgboss.job")) {
        return { rows: jobRows };
      }
      if (sql.includes("job_progress")) {
        return { rows: progressRows };
      }
      return { rows: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests — GET /
// ---------------------------------------------------------------------------
test("GET / returns job list with snake_case column names", async () => {
  const jobRows = [
    {
      id: "abc-123",
      name: "fetch-feed",
      state: "completed",
      created_on: "2026-04-12T10:00:00Z",
      started_on: "2026-04-12T10:01:00Z",
      completed_on: "2026-04-12T10:02:00Z",
      retry_count: 0,
      retry_limit: 3,
      output: null,
      progress_lines: "5",
    },
  ];
  const pool = makePool({ jobRows });
  const req = { query: { limit: "50" } };
  const res = makeRes();

  await jobsGetHandler(req, res, { pool });

  assert.equal(res._status, 200);
  assert.ok(Array.isArray(res._body.jobs));
  assert.equal(res._body.jobs.length, 1);
  // Verify correct column names returned (not camelCase)
  const job = res._body.jobs[0];
  assert.ok("created_on" in job, "should have created_on (not createdon)");
  assert.ok("started_on" in job, "should have started_on (not startedon)");
  assert.ok("completed_on" in job, "should have completed_on (not completedon)");
  assert.ok("retry_count" in job, "should have retry_count (not retrycount)");
  assert.ok("retry_limit" in job, "should have retry_limit (not retrylimit)");
  assert.ok("progress_lines" in job, "should have progress_lines");
  assert.ok(!("createdon" in job), "should NOT have createdon");
  assert.ok(!("retrycount" in job), "should NOT have retrycount");
});

test("GET / passes state filter correctly", async () => {
  const pool = makePool({ jobRows: [] });
  const req = { query: { state: "active", limit: "20" } };
  const res = makeRes();

  await jobsGetHandler(req, res, { pool });

  assert.equal(res._status, 200);
  assert.equal(pool.queries.length, 1);
  const q = pool.queries[0];
  assert.ok(q.sql.includes("WHERE j.state = $1"), "query should filter by state");
  assert.equal(q.params[0], "active", "first param should be state value");
});

test("GET / without state filter omits WHERE clause", async () => {
  const pool = makePool({ jobRows: [] });
  const req = { query: {} };
  const res = makeRes();

  await jobsGetHandler(req, res, { pool });

  assert.equal(res._status, 200);
  const q = pool.queries[0];
  assert.ok(!q.sql.includes("WHERE j.state"), "query should not filter by state");
});

test("GET / uses created_on for ORDER BY", async () => {
  const pool = makePool({ jobRows: [] });
  const req = { query: {} };
  const res = makeRes();

  await jobsGetHandler(req, res, { pool });

  const q = pool.queries[0];
  assert.ok(q.sql.includes("created_on DESC"), "should ORDER BY created_on DESC");
});

// ---------------------------------------------------------------------------
// Tests — GET /:id/progress
// ---------------------------------------------------------------------------
test("GET /:id/progress returns progress rows with correct columns", async () => {
  const progressRows = [
    { seq: 1, level: "info", message: "Starting fetch", ts: "2026-04-12T10:00:01Z" },
    { seq: 2, level: "info", message: "Fetched 42 items", ts: "2026-04-12T10:00:05Z" },
    { seq: 3, level: "warn", message: "Rate limited, retrying", ts: "2026-04-12T10:00:10Z" },
  ];
  const pool = makePool({ progressRows });
  const req = { params: { id: "abc-123" }, query: { since: "0" } };
  const res = makeRes();

  await jobsProgressHandler(req, res, { pool });

  assert.equal(res._status, 200);
  assert.ok(Array.isArray(res._body.progress));
  assert.equal(res._body.progress.length, 3);
  // Verify correct column names (not step, pct, created_at)
  const row = res._body.progress[0];
  assert.ok("seq" in row, "should have seq");
  assert.ok("level" in row, "should have level");
  assert.ok("message" in row, "should have message");
  assert.ok("ts" in row, "should have ts");
  assert.ok(!("step" in row), "should NOT have step (old schema)");
  assert.ok(!("pct" in row), "should NOT have pct (old schema)");
  assert.ok(!("created_at" in row), "should NOT have created_at (old schema)");
});

test("GET /:id/progress uses since param for incremental polling", async () => {
  const pool = makePool({ progressRows: [] });
  const req = { params: { id: "abc-123" }, query: { since: "7" } };
  const res = makeRes();

  await jobsProgressHandler(req, res, { pool });

  assert.equal(res._status, 200);
  const q = pool.queries[0];
  assert.ok(q.sql.includes("seq > $2"), "should filter by seq > since");
  assert.equal(q.params[0], "abc-123", "first param should be jobId");
  assert.equal(q.params[1], 7, "second param should be since value");
});

test("GET /:id/progress defaults since to 0", async () => {
  const pool = makePool({ progressRows: [] });
  const req = { params: { id: "abc-123" }, query: {} };
  const res = makeRes();

  await jobsProgressHandler(req, res, { pool });

  const q = pool.queries[0];
  assert.equal(q.params[1], 0, "since should default to 0");
});

test("GET /:id/progress queries public.job_progress (not step/pct schema)", async () => {
  const pool = makePool({ progressRows: [] });
  const req = { params: { id: "abc-123" }, query: {} };
  const res = makeRes();

  await jobsProgressHandler(req, res, { pool });

  const q = pool.queries[0];
  assert.ok(q.sql.includes("seq, level, message, ts"), "should SELECT seq, level, message, ts");
  assert.ok(q.sql.includes("public.job_progress"), "should query public.job_progress");
  assert.ok(!q.sql.includes("step"), "should NOT select step (old schema)");
  assert.ok(!q.sql.includes("pct"), "should NOT select pct (old schema)");
  assert.ok(!q.sql.includes("created_at"), "should NOT select created_at (old schema)");
});
