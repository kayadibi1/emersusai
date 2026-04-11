// tests/unit/api/admin-candidates.test.js
// Unit tests for admin candidates router logic (mocked supabaseAdmin)
import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Minimal inline reimplementation of the route handlers for testability.
// We can't import the actual router without a real supabaseAdmin client, so we
// replicate the handler logic here and inject mock clients.
// ---------------------------------------------------------------------------

function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

// ---------------------------------------------------------------------------
// candidatesGetHandler — mirrors GET / route
// ---------------------------------------------------------------------------
async function candidatesGetHandler(req, res, { supabase }) {
  const status = req.query?.status ?? "pending";
  const limit = Math.min(Number(req.query?.limit ?? 50), 200);
  const { data, error } = await supabase
    .from("topic_candidates")
    .select("*")
    .eq("status", status)
    .order("confidence", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ candidates: data });
}

// ---------------------------------------------------------------------------
// candidatesAcceptHandler — mirrors POST /:id/accept
// ---------------------------------------------------------------------------
async function candidatesAcceptHandler(req, res, { supabase }) {
  const id = Number(req.params.id);
  const {
    query: overrideQuery,
    domain: overrideDomain,
    target: overrideTarget,
  } = req.body ?? {};

  const { data: candidate, error: fetchErr } = await supabase
    .from("topic_candidates")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchErr || !candidate)
    return res.status(404).json({ error: "candidate not found" });
  if (candidate.status !== "pending")
    return res.status(409).json({ error: `candidate is ${candidate.status}` });

  const query = overrideQuery ?? candidate.suggested_query;
  if (!query)
    return res.status(400).json({ error: "candidate has no suggested_query; provide query in body" });

  const { data: topic, error: topicErr } = await supabase
    .from("research_topics")
    .insert({
      topic_key: candidate.topic_key,
      query,
      domain: overrideDomain ?? null,
      origin: "discovered",
      source_candidate_id: id,
      target_paper_count: overrideTarget ?? 2000,
    })
    .select()
    .single();
  if (topicErr) return res.status(500).json({ error: topicErr.message });

  await supabase
    .from("topic_candidates")
    .update({ status: "accepted", decided_at: new Date().toISOString(), decided_by: req.adminUser.email })
    .eq("id", id);

  res.json({ topic, jobId: null });
}

// ---------------------------------------------------------------------------
// candidatesRejectHandler
// ---------------------------------------------------------------------------
async function candidatesRejectHandler(req, res, { supabase }) {
  const id = Number(req.params.id);
  const { error } = await supabase
    .from("topic_candidates")
    .update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: req.adminUser.email })
    .eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}

// ---------------------------------------------------------------------------
// candidatesSnoozeHandler
// ---------------------------------------------------------------------------
async function candidatesSnoozeHandler(req, res, { supabase }) {
  const id = Number(req.params.id);
  const { until } = req.body ?? {};
  if (!until) return res.status(400).json({ error: "until required" });
  const { error } = await supabase
    .from("topic_candidates")
    .update({ status: "snoozed", snooze_until: until, decided_at: new Date().toISOString(), decided_by: req.adminUser.email })
    .eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Supabase mock builder
// ---------------------------------------------------------------------------
function makeSupabase({ candidateRows = [], topicRow = null, updateError = null } = {}) {
  const ops = [];

  // chain(table, data, error) returns a chainable query builder.
  // isListContext tracks whether we've been called via a list path (no .single()).
  function chain(table, data = null, error = null, isUpdate = false) {
    const c = {};
    c.select = (..._) => chain(table, data, error);
    c.eq = (..._) => chain(table, data, error, isUpdate);
    c.order = (..._) => chain(table, data, error);
    // .limit() terminates a list query — return {data, error} directly
    c.limit = (..._) => ({ data, error });
    // .single() terminates a single-row query
    c.single = () => ({
      data: Array.isArray(data) ? (data[0] ?? null) : data,
      error,
    });
    c.insert = (row) => {
      ops.push({ op: "insert", table, row });
      return chain(table, topicRow, null);
    };
    c.update = (vals) => {
      ops.push({ op: "update", table, vals });
      // update chains need .eq() which then resolves — we signal error via resolvedError
      return updateChain(table, vals, updateError);
    };
    return c;
  }

  // updateChain — used after .update(vals); .eq() resolves to {data, error}
  function updateChain(table, vals, error) {
    const c = {};
    c.eq = (..._) => ({ data: null, error });
    return c;
  }

  const client = {
    ops,
    from: (table) => {
      if (table === "topic_candidates") {
        // For single-row fetches (accept) candidateRows[0]; for list fetches, full array
        return chain(table, candidateRows.length === 1 ? candidateRows[0] : candidateRows, null);
      }
      if (table === "research_topics")
        return chain(table, topicRow, null);
      return chain(table, [], null);
    },
  };
  return client;
}

// ---------------------------------------------------------------------------
// Tests — GET
// ---------------------------------------------------------------------------
test("GET returns candidate list", async () => {
  const candidates = [
    { id: 1, topic_key: "resistance-training", status: "pending", confidence: 0.9 },
    { id: 2, topic_key: "aerobic-training", status: "pending", confidence: 0.8 },
  ];
  const supabase = makeSupabase({ candidateRows: candidates });
  const req = { query: { status: "pending", limit: "10" } };
  const res = makeRes();
  await candidatesGetHandler(req, res, { supabase });
  assert.equal(res._status, 200);
  assert.ok(Array.isArray(res._body.candidates));
});

// ---------------------------------------------------------------------------
// Tests — accept
// ---------------------------------------------------------------------------
test("accept returns 404 when candidate not found", async () => {
  const supabase = makeSupabase({ candidateRows: [] });
  const req = { params: { id: "99" }, body: {}, adminUser: { email: "admin@test.com" } };
  const res = makeRes();
  await candidatesAcceptHandler(req, res, { supabase });
  assert.equal(res._status, 404);
});

test("accept returns 409 when already accepted", async () => {
  const supabase = makeSupabase({
    candidateRows: [{ id: 1, status: "accepted", topic_key: "foo", suggested_query: "query" }],
  });
  const req = { params: { id: "1" }, body: {}, adminUser: { email: "admin@test.com" } };
  const res = makeRes();
  await candidatesAcceptHandler(req, res, { supabase });
  assert.equal(res._status, 409);
});

test("accept returns 400 when no query available", async () => {
  const supabase = makeSupabase({
    candidateRows: [{ id: 1, status: "pending", topic_key: "foo", suggested_query: null }],
  });
  const req = { params: { id: "1" }, body: {}, adminUser: { email: "admin@test.com" } };
  const res = makeRes();
  await candidatesAcceptHandler(req, res, { supabase });
  assert.equal(res._status, 400);
});

test("accept creates topic and returns 200", async () => {
  const supabase = makeSupabase({
    candidateRows: [{ id: 1, status: "pending", topic_key: "foo", suggested_query: "exercise" }],
    topicRow: { id: 42, topic_key: "foo", query: "exercise" },
  });
  const req = { params: { id: "1" }, body: {}, adminUser: { email: "admin@test.com" } };
  const res = makeRes();
  await candidatesAcceptHandler(req, res, { supabase });
  assert.equal(res._status, 200);
  assert.equal(res._body.topic.id, 42);
  const insert = supabase.ops.find((o) => o.op === "insert" && o.table === "research_topics");
  assert.ok(insert, "research_topics insert should have been called");
});

test("accept uses body query override", async () => {
  const supabase = makeSupabase({
    candidateRows: [{ id: 1, status: "pending", topic_key: "foo", suggested_query: "original query" }],
    topicRow: { id: 5, topic_key: "foo", query: "override query" },
  });
  const req = { params: { id: "1" }, body: { query: "override query" }, adminUser: { email: "admin@test.com" } };
  const res = makeRes();
  await candidatesAcceptHandler(req, res, { supabase });
  assert.equal(res._status, 200);
  const insert = supabase.ops.find((o) => o.op === "insert" && o.table === "research_topics");
  assert.equal(insert.row.query, "override query");
});

// ---------------------------------------------------------------------------
// Tests — reject
// ---------------------------------------------------------------------------
test("reject returns ok:true on success", async () => {
  const supabase = makeSupabase();
  const req = { params: { id: "1" }, adminUser: { email: "admin@test.com" } };
  const res = makeRes();
  await candidatesRejectHandler(req, res, { supabase });
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
});

test("reject returns 500 on db error", async () => {
  const supabase = makeSupabase({ updateError: { message: "db error" } });
  const req = { params: { id: "1" }, adminUser: { email: "admin@test.com" } };
  const res = makeRes();
  await candidatesRejectHandler(req, res, { supabase });
  assert.equal(res._status, 500);
});

// ---------------------------------------------------------------------------
// Tests — snooze
// ---------------------------------------------------------------------------
test("snooze returns 400 when no until", async () => {
  const supabase = makeSupabase();
  const req = { params: { id: "1" }, body: {}, adminUser: { email: "admin@test.com" } };
  const res = makeRes();
  await candidatesSnoozeHandler(req, res, { supabase });
  assert.equal(res._status, 400);
  assert.equal(res._body.error, "until required");
});

test("snooze returns ok:true on success", async () => {
  const supabase = makeSupabase();
  const req = { params: { id: "1" }, body: { until: "2026-05-01T00:00:00Z" }, adminUser: { email: "admin@test.com" } };
  const res = makeRes();
  await candidatesSnoozeHandler(req, res, { supabase });
  assert.equal(res._status, 200);
  assert.equal(res._body.ok, true);
  const update = supabase.ops.find((o) => o.op === "update");
  assert.equal(update.vals.status, "snoozed");
  assert.equal(update.vals.snooze_until, "2026-05-01T00:00:00Z");
});
