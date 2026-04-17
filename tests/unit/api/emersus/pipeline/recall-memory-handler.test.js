import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecallMemory } from '../../../../../api/emersus/pipeline/recall-memory-handler.js';

function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) {
      return {
        ok: false, status: 404,
        json: async () => ({}), text: async () => 'no route',
      };
    }
    return {
      ok: route.ok !== false,
      status: route.status ?? 200,
      json: async () => route.body,
      text: async () => JSON.stringify(route.body),
    };
  };
  impl.calls = calls;
  return impl;
}

const CTX = { supabaseUserId: '00000000-0000-0000-0000-000000000001' };
const DEPS_BASE = {
  supabaseUrl: 'https://supabase.example',
  serviceRoleKey: 'service-role-key',
  embedText: async () => new Array(1536).fill(0.01),
};

describe('resolveRecallMemory', () => {
  test('query + categories: embeds, RPC called with both filters', async () => {
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/recall_memory': {
        body: [{
          id: 'r1', category: 'personal_record', tier: 'C',
          fact: 'bench 1RM 102.5 kg', metadata: {}, status: 'confirmed',
          created_at: '2026-03-15T00:00:00Z', last_mentioned_at: '2026-03-15T00:00:00Z',
          resolved_at: null, similarity: 0.79,
        }],
      },
    });
    const out = await resolveRecallMemory({
      args: { query: 'bench PR history', categories: ['personal_record'], limit: 6 },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.equal(out.memories.length, 1);
    assert.equal(out.memories[0].fact, 'bench 1RM 102.5 kg');
    assert.equal(out.memories[0].similarity, 0.79);
    const body = JSON.parse(fetchImpl.calls[0].init.body);
    assert.equal(body.p_user_id, CTX.supabaseUserId);
    assert.equal(body.p_embedding.length, 1536);
    assert.deepEqual(body.p_categories, ['personal_record']);
    assert.equal(body.p_limit, 6);
  });

  test('query only: embeds, categories null in RPC call', async () => {
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/recall_memory': { body: [] },
    });
    await resolveRecallMemory({
      args: { query: 'knee history', categories: null, limit: null },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    const body = JSON.parse(fetchImpl.calls[0].init.body);
    assert.ok(Array.isArray(body.p_embedding));
    assert.equal(body.p_categories, null);
    assert.equal(body.p_limit, 6); // default
  });

  test('categories only: no embed, null embedding param', async () => {
    let embedCalls = 0;
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/recall_memory': { body: [] },
    });
    await resolveRecallMemory({
      args: { query: null, categories: ['injury', 'medication'], limit: 10 },
      ctx: CTX,
      deps: {
        ...DEPS_BASE, fetchImpl,
        embedText: async () => { embedCalls++; return new Array(1536).fill(0); },
      },
    });
    assert.equal(embedCalls, 0);
    const body = JSON.parse(fetchImpl.calls[0].init.body);
    assert.equal(body.p_embedding, null);
    assert.deepEqual(body.p_categories, ['injury', 'medication']);
    assert.equal(body.p_limit, 10);
  });

  test('both null: short-circuits to empty without any fetch', async () => {
    const fetchImpl = stubFetch({});
    const out = await resolveRecallMemory({
      args: { query: null, categories: null, limit: null },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.deepEqual(out, { memories: [] });
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('empty string query + empty-array categories treated as null', async () => {
    const fetchImpl = stubFetch({});
    const out = await resolveRecallMemory({
      args: { query: '   ', categories: [], limit: 6 },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.deepEqual(out, { memories: [] });
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('limit clamped to [1, 20]', async () => {
    const fetchImpl = stubFetch({ '/rest/v1/rpc/recall_memory': { body: [] } });
    await resolveRecallMemory({
      args: { query: null, categories: ['injury'], limit: 999 },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.equal(JSON.parse(fetchImpl.calls[0].init.body).p_limit, 20);

    fetchImpl.calls.length = 0;
    await resolveRecallMemory({
      args: { query: null, categories: ['injury'], limit: 0 },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.equal(JSON.parse(fetchImpl.calls[0].init.body).p_limit, 1);
  });

  test('missing supabaseUserId: empty, no fetch', async () => {
    const fetchImpl = stubFetch({});
    const out = await resolveRecallMemory({
      args: { query: 'anything', categories: null, limit: null },
      ctx: { supabaseUserId: '' },
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.deepEqual(out, { memories: [] });
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('RPC 500: memories=[] + structured error', async () => {
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/recall_memory': { ok: false, status: 500, body: { message: 'down' } },
    });
    const out = await resolveRecallMemory({
      args: { query: null, categories: ['injury'], limit: null },
      ctx: CTX,
      deps: { ...DEPS_BASE, fetchImpl },
    });
    assert.deepEqual(out.memories, []);
    assert.match(out.error, /recall_memory_rpc_failed_500/);
  });

  test('embed failure (query path): empty + error, no RPC call', async () => {
    const fetchImpl = stubFetch({ '/rest/v1/rpc/recall_memory': { body: [] } });
    const out = await resolveRecallMemory({
      args: { query: 'knee?', categories: null, limit: null },
      ctx: CTX,
      deps: {
        ...DEPS_BASE, fetchImpl,
        embedText: async () => { throw new Error('rate_limit'); },
      },
    });
    assert.deepEqual(out.memories, []);
    assert.match(out.error, /embed_failed/);
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('missing env: empty + error, no fetch', async () => {
    const fetchImpl = stubFetch({});
    const out = await resolveRecallMemory({
      args: { query: null, categories: ['injury'], limit: null },
      ctx: CTX,
      deps: { fetchImpl }, // no url/key
    });
    assert.deepEqual(out.memories, []);
    assert.equal(out.error, 'supabase_env_missing');
    assert.equal(fetchImpl.calls.length, 0);
  });
});
