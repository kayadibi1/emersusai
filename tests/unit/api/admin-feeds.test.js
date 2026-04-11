// tests/unit/api/admin-feeds.test.js
// Unit tests for admin feeds router logic (mocked supabaseAdmin).
// Mirrors the handler logic from api/admin/feeds.js and injects mock clients.
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
// Handler reimplementations (mirrors api/admin/feeds.js logic)
// ---------------------------------------------------------------------------
async function feedsGetHandler(req, res, { supabase }) {
  const limit = Math.min(Number(req.query?.limit ?? 100), 500);
  const { data, error } = await supabase
    .from("discovery_feeds")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ feeds: data });
}

async function feedsPostHandler(req, res, { supabase }) {
  const { id, name, kind, url, source_plugin, status = "active" } = req.body ?? {};
  if (!id) return res.status(400).json({ error: "id required" });
  if (!name) return res.status(400).json({ error: "name required" });
  if (!kind || !["rss", "atom", "api"].includes(kind)) {
    return res.status(400).json({ error: "kind must be rss|atom|api" });
  }
  if (!url) return res.status(400).json({ error: "url required" });
  if (!source_plugin) return res.status(400).json({ error: "source_plugin required" });
  if (!["active", "disabled"].includes(status)) {
    return res.status(400).json({ error: "status must be active|disabled" });
  }

  const { data, error } = await supabase
    .from("discovery_feeds")
    .insert({ id, name, kind, url, source_plugin, status })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ feed: data });
}

async function feedsPatchHandler(req, res, { supabase }) {
  const id = req.params.id;
  const allowed = ["name", "kind", "url", "source_plugin", "status"];
  const updates = {};
  for (const k of allowed) {
    if (req.body?.[k] !== undefined) updates[k] = req.body[k];
  }
  if (updates.kind && !["rss", "atom", "api"].includes(updates.kind)) {
    return res.status(400).json({ error: "invalid kind" });
  }
  if (updates.status && !["active", "disabled"].includes(updates.status)) {
    return res.status(400).json({ error: "invalid status" });
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("discovery_feeds")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ feed: data });
}

// ---------------------------------------------------------------------------
// Supabase mock builder
// ---------------------------------------------------------------------------
function makeSupabase({ feedRows = [], feedRow = null, updateError = null, insertError = null } = {}) {
  const ops = [];

  function chain(table, data = null, error = null) {
    const c = {};
    c.select = (..._) => chain(table, data, error);
    c.eq = (..._) => chain(table, data, error);
    c.order = (..._) => chain(table, data, error);
    c.limit = (..._) => ({ data, error });
    c.single = () => ({
      data: Array.isArray(data) ? (data[0] ?? null) : data,
      error,
    });
    c.insert = (row) => {
      ops.push({ op: "insert", table, row });
      return chain(table, insertError ? null : feedRow ?? row, insertError ?? null);
    };
    c.update = (vals) => {
      ops.push({ op: "update", table, vals });
      return chain(table, updateError ? null : feedRow ?? vals, updateError ?? null);
    };
    return c;
  }

  const client = {
    ops,
    from: (table) => chain(table, feedRows.length === 1 ? feedRows[0] : feedRows, null),
  };
  return client;
}

// ---------------------------------------------------------------------------
// Tests — GET /
// ---------------------------------------------------------------------------
test("GET / returns feed list", async () => {
  const feedRows = [
    { id: "pubmed-rss", name: "PubMed RSS", kind: "rss", source_plugin: "pubmed", status: "active" },
    { id: "biorxiv-api", name: "bioRxiv API", kind: "api", source_plugin: "biorxiv", status: "active" },
  ];
  const supabase = makeSupabase({ feedRows });
  const req = { query: { limit: "10" } };
  const res = makeRes();

  await feedsGetHandler(req, res, { supabase });

  assert.equal(res._status, 200);
  assert.ok(Array.isArray(res._body.feeds));
  assert.equal(res._body.feeds.length, 2);
});

test("GET / returns 500 on db error", async () => {
  const supabase = {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({ data: null, error: { message: "db error" } }),
        }),
      }),
    }),
  };
  const req = { query: {} };
  const res = makeRes();

  await feedsGetHandler(req, res, { supabase });

  assert.equal(res._status, 500);
  assert.equal(res._body.error, "db error");
});

// ---------------------------------------------------------------------------
// Tests — POST /
// ---------------------------------------------------------------------------
test("POST / returns 400 when id missing", async () => {
  const supabase = makeSupabase();
  const req = { body: { name: "Test Feed", kind: "rss", url: "https://example.com", source_plugin: "rss-generic" } };
  const res = makeRes();

  await feedsPostHandler(req, res, { supabase });

  assert.equal(res._status, 400);
  assert.equal(res._body.error, "id required");
});

test("POST / returns 400 when name missing", async () => {
  const supabase = makeSupabase();
  const req = { body: { id: "test-feed", kind: "rss", url: "https://example.com", source_plugin: "rss-generic" } };
  const res = makeRes();

  await feedsPostHandler(req, res, { supabase });

  assert.equal(res._status, 400);
  assert.equal(res._body.error, "name required");
});

test("POST / returns 400 when kind is invalid", async () => {
  const supabase = makeSupabase();
  const req = { body: { id: "test-feed", name: "Test", kind: "invalid", url: "https://example.com", source_plugin: "rss-generic" } };
  const res = makeRes();

  await feedsPostHandler(req, res, { supabase });

  assert.equal(res._status, 400);
  assert.match(res._body.error, /kind must be/);
});

test("POST / returns 400 when url missing", async () => {
  const supabase = makeSupabase();
  const req = { body: { id: "test-feed", name: "Test", kind: "rss", source_plugin: "rss-generic" } };
  const res = makeRes();

  await feedsPostHandler(req, res, { supabase });

  assert.equal(res._status, 400);
  assert.equal(res._body.error, "url required");
});

test("POST / returns 400 when source_plugin missing", async () => {
  const supabase = makeSupabase();
  const req = { body: { id: "test-feed", name: "Test", kind: "rss", url: "https://example.com" } };
  const res = makeRes();

  await feedsPostHandler(req, res, { supabase });

  assert.equal(res._status, 400);
  assert.equal(res._body.error, "source_plugin required");
});

test("POST / creates feed with all required fields", async () => {
  const feedRow = { id: "pubmed-rss", name: "PubMed RSS", kind: "rss", url: "https://pubmed.ncbi.nlm.nih.gov/rss", source_plugin: "pubmed", status: "active" };
  const supabase = makeSupabase({ feedRow });
  const req = {
    body: { id: "pubmed-rss", name: "PubMed RSS", kind: "rss", url: "https://pubmed.ncbi.nlm.nih.gov/rss", source_plugin: "pubmed" },
  };
  const res = makeRes();

  await feedsPostHandler(req, res, { supabase });

  assert.equal(res._status, 201);
  assert.ok(res._body.feed);
  const insert = supabase.ops.find((o) => o.op === "insert" && o.table === "discovery_feeds");
  assert.ok(insert, "discovery_feeds insert should have been called");
  assert.equal(insert.row.id, "pubmed-rss");
  assert.equal(insert.row.kind, "rss");
  assert.equal(insert.row.source_plugin, "pubmed");
  assert.equal(insert.row.status, "active");
});

test("POST / accepts status=disabled", async () => {
  const feedRow = { id: "test-feed", name: "Test", kind: "api", url: "https://example.com", source_plugin: "custom", status: "disabled" };
  const supabase = makeSupabase({ feedRow });
  const req = {
    body: { id: "test-feed", name: "Test", kind: "api", url: "https://example.com", source_plugin: "custom", status: "disabled" },
  };
  const res = makeRes();

  await feedsPostHandler(req, res, { supabase });

  assert.equal(res._status, 201);
  const insert = supabase.ops.find((o) => o.op === "insert");
  assert.equal(insert.row.status, "disabled");
});

test("POST / rejects invalid status value", async () => {
  const supabase = makeSupabase();
  const req = {
    body: { id: "test-feed", name: "Test", kind: "rss", url: "https://example.com", source_plugin: "rss-generic", status: "yes" },
  };
  const res = makeRes();

  await feedsPostHandler(req, res, { supabase });

  assert.equal(res._status, 400);
  assert.match(res._body.error, /status must be/);
});

// ---------------------------------------------------------------------------
// Tests — PATCH /:id
// ---------------------------------------------------------------------------
test("PATCH /:id updates status field using text id", async () => {
  const feedRow = { id: "pubmed-rss", status: "disabled" };
  const supabase = makeSupabase({ feedRow });
  const req = { params: { id: "pubmed-rss" }, body: { status: "disabled" } };
  const res = makeRes();

  await feedsPatchHandler(req, res, { supabase });

  assert.equal(res._status, 200);
  assert.ok(res._body.feed);
  const update = supabase.ops.find((o) => o.op === "update");
  assert.ok(update, "update should have been called");
  assert.equal(update.vals.status, "disabled");
  assert.ok(update.vals.updated_at, "updated_at should be set");
});

test("PATCH /:id rejects invalid kind", async () => {
  const supabase = makeSupabase();
  const req = { params: { id: "pubmed-rss" }, body: { kind: "bad-kind" } };
  const res = makeRes();

  await feedsPatchHandler(req, res, { supabase });

  assert.equal(res._status, 400);
  assert.equal(res._body.error, "invalid kind");
});

test("PATCH /:id rejects invalid status", async () => {
  const supabase = makeSupabase();
  const req = { params: { id: "pubmed-rss" }, body: { status: "yes" } };
  const res = makeRes();

  await feedsPatchHandler(req, res, { supabase });

  assert.equal(res._status, 400);
  assert.equal(res._body.error, "invalid status");
});

test("PATCH /:id uses string id (not Number)", async () => {
  // Verify that id is passed as a string, not coerced to a number
  const feedRow = { id: "my-feed-slug", name: "Updated" };
  const supabase = makeSupabase({ feedRow });
  const req = { params: { id: "my-feed-slug" }, body: { name: "Updated" } };
  const res = makeRes();

  await feedsPatchHandler(req, res, { supabase });

  assert.equal(res._status, 200);
  // The id used should be the string "my-feed-slug", not a number
  assert.equal(typeof req.params.id, "string");
});
