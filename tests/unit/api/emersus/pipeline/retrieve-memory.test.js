import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { retrieveMemory } from '../../../../../api/emersus/pipeline/retrieve-memory.js';

// Fake PostgREST fetch. Keyed by path; each route returns {ok, status, body}.
function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ message: 'no route' }),
        text: async () => 'no route',
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

const CTX_BASE = {
  supabaseUserId: '00000000-0000-0000-0000-000000000001',
  question: 'Can I squat with a torn ACL?',
};

const DEPS_BASE = {
  supabaseUrl: 'https://supabase.example',
  serviceRoleKey: 'service-role-key',
  embedText: async () => new Array(1536).fill(0.01),
};

describe('retrieveMemory', () => {
  test('empty user: ctx.crossThreadMemory stays null', async () => {
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/retrieve_memory_always_inject': { body: [] },
      '/rest/v1/rpc/retrieve_memory_rag':           { body: [] },
    });
    const ctx = { ...CTX_BASE };
    await retrieveMemory(ctx, { ...DEPS_BASE, fetchImpl });
    assert.equal(ctx.crossThreadMemory, null);
  });

  test('Tier A + active Tier D → persistent + active_now groups', async () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/retrieve_memory_always_inject': {
        body: [
          { id: 'a1', category: 'injury',            tier: 'A', fact: 'torn ACL left knee', metadata: {}, confirmed_at: '2026-01-12T00:00:00Z', expires_at: null },
          { id: 'a2', category: 'medication',        tier: 'A', fact: 'levothyroxine 75mcg', metadata: {}, confirmed_at: '2025-09-01T00:00:00Z', expires_at: null },
          { id: 'd1', category: 'travel_constraint', tier: 'D', fact: 'hotel gym only this week', metadata: {}, confirmed_at: '2026-04-14T00:00:00Z', expires_at: future },
        ],
      },
      '/rest/v1/rpc/retrieve_memory_rag':      { body: [] },
      '/rest/v1/rpc/refresh_memory_mentions':  { body: 3 },
    });
    const ctx = { ...CTX_BASE };
    await retrieveMemory(ctx, { ...DEPS_BASE, fetchImpl });

    assert.ok(ctx.crossThreadMemory);
    assert.equal(ctx.crossThreadMemory.persistent.length, 2);
    assert.equal(ctx.crossThreadMemory.active_now.length, 1);
    assert.equal(ctx.crossThreadMemory.relevant_to_this_question.length, 0);
    assert.equal(ctx.crossThreadMemory.persistent[0].category, 'injury');
    assert.equal(ctx.crossThreadMemory.active_now[0].fact, 'hotel gym only this week');
  });

  test('RAG: only similarity ≥ 0.35 retained', async () => {
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/retrieve_memory_always_inject': { body: [] },
      '/rest/v1/rpc/retrieve_memory_rag': {
        body: [
          { id: 'b1', category: 'personal_record',     tier: 'C', fact: 'bench 1RM 102.5 kg', metadata: {}, last_mentioned_at: '2026-03-15T00:00:00Z', similarity: 0.82 },
          { id: 'b2', category: 'goal',                tier: 'B', fact: 'cutting for summer',   metadata: {}, last_mentioned_at: '2026-04-01T00:00:00Z', similarity: 0.41 },
          { id: 'b3', category: 'exercise_preference', tier: 'E', fact: 'hates burpees',        metadata: {}, last_mentioned_at: '2026-02-10T00:00:00Z', similarity: 0.12 },
        ],
      },
      '/rest/v1/rpc/refresh_memory_mentions':  { body: 2 },
    });
    const ctx = { ...CTX_BASE };
    await retrieveMemory(ctx, { ...DEPS_BASE, fetchImpl });

    assert.equal(ctx.crossThreadMemory.relevant_to_this_question.length, 2);
    const keptIds = ctx.crossThreadMemory.relevant_to_this_question.map(r => r.id ?? r.fact).sort();
    // We map to an output shape that may or may not include id; assert via facts
    const facts = ctx.crossThreadMemory.relevant_to_this_question.map(r => r.fact).sort();
    assert.deepEqual(facts, ['bench 1RM 102.5 kg', 'cutting for summer']);
  });

  test('refresh called with union of all retrieved ids', async () => {
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/retrieve_memory_always_inject': {
        body: [
          { id: 'a1', category: 'injury', tier: 'A', fact: 'torn ACL', metadata: {}, confirmed_at: '2026-01-01T00:00:00Z', expires_at: null },
        ],
      },
      '/rest/v1/rpc/retrieve_memory_rag': {
        body: [
          { id: 'r1', category: 'goal', tier: 'B', fact: 'cutting', metadata: {}, last_mentioned_at: '2026-04-01T00:00:00Z', similarity: 0.80 },
        ],
      },
      '/rest/v1/rpc/refresh_memory_mentions': { body: 2 },
    });
    const ctx = { ...CTX_BASE };
    await retrieveMemory(ctx, { ...DEPS_BASE, fetchImpl });

    const refreshCall = fetchImpl.calls.find(c => c.url.endsWith('/refresh_memory_mentions'));
    assert.ok(refreshCall, 'refresh RPC invoked');
    const body = JSON.parse(refreshCall.init.body);
    assert.deepEqual(body.p_memory_ids.slice().sort(), ['a1', 'r1']);
  });

  test('refresh failure does NOT corrupt ctx.crossThreadMemory', async () => {
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/retrieve_memory_always_inject': {
        body: [{ id: 'a1', category: 'injury', tier: 'A', fact: 'torn ACL', metadata: {}, confirmed_at: '2026-01-01T00:00:00Z', expires_at: null }],
      },
      '/rest/v1/rpc/retrieve_memory_rag':      { body: [] },
      '/rest/v1/rpc/refresh_memory_mentions':  { ok: false, status: 500, body: { message: 'db down' } },
    });
    const ctx = { ...CTX_BASE };
    await retrieveMemory(ctx, { ...DEPS_BASE, fetchImpl });
    assert.ok(ctx.crossThreadMemory);
    assert.equal(ctx.crossThreadMemory.persistent.length, 1);
  });

  test('always-inject failure → ctx stays null', async () => {
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/retrieve_memory_always_inject': { ok: false, status: 500, body: { message: 'down' } },
      '/rest/v1/rpc/retrieve_memory_rag':           { body: [] },
    });
    const ctx = { ...CTX_BASE };
    await retrieveMemory(ctx, { ...DEPS_BASE, fetchImpl });
    assert.equal(ctx.crossThreadMemory, null);
  });

  test('missing supabaseUserId: early-return, zero fetches', async () => {
    const fetchImpl = stubFetch({});
    const ctx = { ...CTX_BASE, supabaseUserId: '' };
    await retrieveMemory(ctx, { ...DEPS_BASE, fetchImpl });
    assert.equal(ctx.crossThreadMemory, null);
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('missing question: skips RAG, still runs always-inject', async () => {
    const fetchImpl = stubFetch({
      '/rest/v1/rpc/retrieve_memory_always_inject': {
        body: [{ id: 'a1', category: 'injury', tier: 'A', fact: 'torn ACL', metadata: {}, confirmed_at: '2026-01-01T00:00:00Z', expires_at: null }],
      },
      '/rest/v1/rpc/refresh_memory_mentions': { body: 1 },
    });
    const ctx = { ...CTX_BASE, question: '' };
    await retrieveMemory(ctx, { ...DEPS_BASE, fetchImpl });
    const paths = fetchImpl.calls.map(c => new URL(c.url).pathname);
    assert.ok(paths.includes('/rest/v1/rpc/retrieve_memory_always_inject'));
    assert.ok(!paths.includes('/rest/v1/rpc/retrieve_memory_rag'));
    assert.equal(ctx.crossThreadMemory.persistent.length, 1);
    assert.equal(ctx.crossThreadMemory.relevant_to_this_question.length, 0);
  });
});
