import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRememberFact } from '../../../../../api/emersus/pipeline/remember-fact-handler.js';

// Stub fetch that captures the PostgREST request and returns a canned response.
function stubFetch({ status = 201, body = [{ id: 'fake-uuid-123' }] } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  impl.calls = calls;
  return impl;
}

const DEFAULT_CTX = {
  supabaseUserId: '00000000-0000-0000-0000-000000000001',
  threadId: 'thread-x',
  _openaiResponseId: 'resp-y',
};

const DEFAULT_DEPS = {
  supabaseUrl: 'https://supabase.example',
  serviceRoleKey: 'service-role-key',
  // Stub embedText so tests don't hit OpenAI.
  embedText: async (_text) => new Array(1536).fill(0.01),
};

describe('resolveRememberFact', () => {
  test('happy path: writes a confirmed explicit Tier A row for an injury', async () => {
    const fetchImpl = stubFetch();
    const out = await resolveRememberFact({
      args: { category: 'injury', fact: 'torn ACL left knee', note: null },
      ctx: DEFAULT_CTX,
      deps: { ...DEFAULT_DEPS, fetchImpl },
    });
    assert.equal(out.saved, true);
    assert.equal(out.id, 'fake-uuid-123');
    assert.equal(out.echo, "Saved — I'll remember that across future chats.");
    assert.equal(fetchImpl.calls.length, 1);
    const { url, init } = fetchImpl.calls[0];
    assert.equal(url, 'https://supabase.example/rest/v1/user_memories');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer service-role-key');
    assert.equal(init.headers.apikey, 'service-role-key');
    const row = JSON.parse(init.body);
    assert.equal(row.user_id, DEFAULT_CTX.supabaseUserId);
    assert.equal(row.category, 'injury');
    assert.equal(row.tier, 'A');
    assert.equal(row.status, 'confirmed');
    assert.equal(row.source, 'explicit');
    assert.equal(row.fact, 'torn ACL left knee');
    assert.equal(row.confidence, 1.00);
    assert.equal(row.source_thread_id, 'thread-x');
    assert.equal(row.source_turn_ref, 'resp-y');
    assert.equal(row.expires_at, null); // Tier A indefinite
    assert.deepEqual(row.metadata, {}); // no note provided
    assert.ok(Array.isArray(row.fact_embedding), 'fact_embedding populated for RAG visibility');
    assert.equal(row.fact_embedding.length, 1536);
  });

  test('embedText failure is soft — row still saved, fact_embedding null', async () => {
    const fetchImpl = stubFetch();
    const depsWithBrokenEmbed = {
      ...DEFAULT_DEPS,
      fetchImpl,
      embedText: async () => { throw new Error('openai_rate_limit'); },
    };
    const out = await resolveRememberFact({
      args: { category: 'goal', fact: 'cutting for summer', note: null },
      ctx: DEFAULT_CTX,
      deps: depsWithBrokenEmbed,
    });
    assert.equal(out.saved, true, 'save succeeds even if embed fails');
    const row = JSON.parse(fetchImpl.calls[0].init.body);
    assert.equal(row.fact_embedding, null, 'embedding null when embedText throws');
    assert.equal(row.fact, 'cutting for summer');
  });

  test('custom category maps to tier X with indefinite TTL', async () => {
    const fetchImpl = stubFetch();
    await resolveRememberFact({
      args: { category: 'custom', fact: 'prefers evening sessions (restaurant job)', note: null },
      ctx: DEFAULT_CTX,
      deps: { ...DEFAULT_DEPS, fetchImpl },
    });
    const row = JSON.parse(fetchImpl.calls[0].init.body);
    assert.equal(row.tier, 'X');
    assert.equal(row.expires_at, null);
  });

  test('goal category gets 120-day TTL', async () => {
    const fetchImpl = stubFetch();
    const beforeTs = Date.now();
    await resolveRememberFact({
      args: { category: 'goal', fact: 'cutting for summer', note: null },
      ctx: DEFAULT_CTX,
      deps: { ...DEFAULT_DEPS, fetchImpl },
    });
    const row = JSON.parse(fetchImpl.calls[0].init.body);
    assert.equal(row.tier, 'B');
    const expiresTs = new Date(row.expires_at).getTime();
    const delta = expiresTs - beforeTs;
    const oneTwentyDaysMs = 120 * 24 * 3600 * 1000;
    // Allow ±5 seconds of fuzz for clock skew between computed and asserted.
    assert.ok(Math.abs(delta - oneTwentyDaysMs) < 5000, `expires ≠ 120d: delta=${delta}`);
  });

  test('note populates metadata.note', async () => {
    const fetchImpl = stubFetch();
    await resolveRememberFact({
      args: { category: 'dietary_protocol', fact: 'pescatarian', note: 'started Jan 2026' },
      ctx: DEFAULT_CTX,
      deps: { ...DEFAULT_DEPS, fetchImpl },
    });
    const row = JSON.parse(fetchImpl.calls[0].init.body);
    assert.deepEqual(row.metadata, { note: 'started Jan 2026' });
  });

  test('rejects fact >500 chars without calling fetch', async () => {
    const fetchImpl = stubFetch();
    const out = await resolveRememberFact({
      args: { category: 'custom', fact: 'a'.repeat(501), note: null },
      ctx: DEFAULT_CTX,
      deps: { ...DEFAULT_DEPS, fetchImpl },
    });
    assert.equal(out.saved, false);
    assert.match(out.error, /fact_length/);
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('rejects empty fact', async () => {
    const fetchImpl = stubFetch();
    const out = await resolveRememberFact({
      args: { category: 'custom', fact: '', note: null },
      ctx: DEFAULT_CTX,
      deps: { ...DEFAULT_DEPS, fetchImpl },
    });
    assert.equal(out.saved, false);
    assert.match(out.error, /fact_length/);
  });

  test('rejects unknown category', async () => {
    const fetchImpl = stubFetch();
    const out = await resolveRememberFact({
      args: { category: 'astrology_sign', fact: 'leo', note: null },
      ctx: DEFAULT_CTX,
      deps: { ...DEFAULT_DEPS, fetchImpl },
    });
    assert.equal(out.saved, false);
    assert.match(out.error, /unknown_category/);
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('rejects missing supabaseUserId (defensive)', async () => {
    const fetchImpl = stubFetch();
    const out = await resolveRememberFact({
      args: { category: 'injury', fact: 'torn ACL', note: null },
      ctx: { supabaseUserId: '' },
      deps: { ...DEFAULT_DEPS, fetchImpl },
    });
    assert.equal(out.saved, false);
    assert.equal(out.error, 'not_authenticated');
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('rejects missing env (defensive)', async () => {
    const fetchImpl = stubFetch();
    const out = await resolveRememberFact({
      args: { category: 'injury', fact: 'torn ACL', note: null },
      ctx: DEFAULT_CTX,
      deps: { fetchImpl }, // no supabaseUrl/serviceRoleKey
    });
    assert.equal(out.saved, false);
    assert.equal(out.error, 'supabase_env_missing');
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('surfaces HTTP 500 from PostgREST', async () => {
    const fetchImpl = stubFetch({ status: 500, body: { message: 'db down' } });
    const out = await resolveRememberFact({
      args: { category: 'injury', fact: 'torn ACL', note: null },
      ctx: DEFAULT_CTX,
      deps: { ...DEFAULT_DEPS, fetchImpl },
    });
    assert.equal(out.saved, false);
    assert.match(out.error, /insert_failed_500/);
  });

  test('surfaces network error as structured error', async () => {
    const fetchImpl = async () => { throw new Error('ECONNRESET'); };
    const out = await resolveRememberFact({
      args: { category: 'injury', fact: 'torn ACL', note: null },
      ctx: DEFAULT_CTX,
      deps: { ...DEFAULT_DEPS, fetchImpl },
    });
    assert.equal(out.saved, false);
    assert.match(out.error, /insert_network_error.*ECONNRESET/);
  });
});
