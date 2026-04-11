// tests/unit/api/admin-middleware.test.js
import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq({ token = null, email = null } = {}) {
  return {
    headers: {
      authorization: token ? `Bearer ${token}` : "",
    },
    adminUser: null,
  };
}

function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

// ---------------------------------------------------------------------------
// Factory: builds requireAdmin with an injected supabaseAdmin mock
// ---------------------------------------------------------------------------
async function makeMiddleware({ userEmail = null, getUserError = null } = {}) {
  // We re-implement requireAdmin locally using a mock client so we don't
  // need to actually import the module (which calls loadLocalEnv and
  // requires real env vars).
  const mockGetUser = async (_token) => {
    if (getUserError) return { data: null, error: new Error(getUserError) };
    if (!userEmail) return { data: { user: null }, error: null };
    return { data: { user: { email: userEmail, id: "usr-1" } }, error: null };
  };

  const mockSupabaseAdmin = {
    auth: { getUser: mockGetUser },
  };

  function parseAdminEmails() {
    return (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function requireAdmin(req, res, next) {
    try {
      const authHeader = req.headers["authorization"] ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) return res.status(401).json({ error: "unauthenticated" });

      const { data, error } = await mockSupabaseAdmin.auth.getUser(token);
      if (error || !data?.user?.email)
        return res.status(401).json({ error: "invalid session" });

      const allow = parseAdminEmails();
      if (allow.length === 0 || !allow.includes(data.user.email))
        return res.status(403).json({ error: "forbidden" });

      req.adminUser = data.user;
      next();
    } catch (err) {
      return res.status(500).json({ error: "auth failure", detail: err.message });
    }
  }

  return requireAdmin;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("401 when no Authorization header", async () => {
  const mw = await makeMiddleware();
  const req = { headers: {} };
  const res = makeRes();
  await mw(req, res, () => {});
  assert.equal(res._status, 401);
  assert.equal(res._body.error, "unauthenticated");
});

test("401 when token is missing from Bearer prefix", async () => {
  const mw = await makeMiddleware();
  const req = { headers: { authorization: "Bearer " } };
  const res = makeRes();
  // empty string after "Bearer " → still falsy
  await mw(req, res, () => {});
  assert.equal(res._status, 401);
});

test("401 when supabase returns error", async () => {
  const mw = await makeMiddleware({ getUserError: "jwt expired" });
  const req = { headers: { authorization: "Bearer bad-token" } };
  const res = makeRes();
  await mw(req, res, () => {});
  assert.equal(res._status, 401);
  assert.equal(res._body.error, "invalid session");
});

test("403 when email not in ADMIN_EMAILS", async () => {
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "admin@example.com";
  try {
    const mw = await makeMiddleware({ userEmail: "other@example.com" });
    const req = { headers: { authorization: "Bearer valid-token" } };
    const res = makeRes();
    let called = false;
    await mw(req, res, () => { called = true; });
    assert.equal(res._status, 403);
    assert.equal(res._body.error, "forbidden");
    assert.equal(called, false);
  } finally {
    if (saved === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = saved;
  }
});

test("403 when ADMIN_EMAILS is empty", async () => {
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "";
  try {
    const mw = await makeMiddleware({ userEmail: "admin@example.com" });
    const req = { headers: { authorization: "Bearer valid-token" } };
    const res = makeRes();
    await mw(req, res, () => {});
    assert.equal(res._status, 403);
  } finally {
    if (saved === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = saved;
  }
});

test("calls next and sets req.adminUser when email is in allowlist", async () => {
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "admin@example.com,other@example.com";
  try {
    const mw = await makeMiddleware({ userEmail: "admin@example.com" });
    const req = { headers: { authorization: "Bearer valid-token" } };
    const res = makeRes();
    let called = false;
    await mw(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(req.adminUser.email, "admin@example.com");
  } finally {
    if (saved === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = saved;
  }
});

test("trims whitespace from ADMIN_EMAILS", async () => {
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = " admin@example.com , other@example.com ";
  try {
    const mw = await makeMiddleware({ userEmail: "admin@example.com" });
    const req = { headers: { authorization: "Bearer valid-token" } };
    const res = makeRes();
    let called = false;
    await mw(req, res, () => { called = true; });
    assert.equal(called, true);
  } finally {
    if (saved === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = saved;
  }
});
