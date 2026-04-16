// tests/integration/memory-rls-isolation.test.js
//
// Two-user RLS isolation test for the user_memories table. Validates that
// user A's row is invisible and un-mutable from user B's session.
//
// Requires a live Supabase instance with two seeded test users. Set:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   TEST_USER_A_EMAIL + TEST_USER_A_PASSWORD
//   TEST_USER_B_EMAIL + TEST_USER_B_PASSWORD
//
// If any of those are unset the test SKIPS gracefully — this test is
// deferred infrastructure that lights up once a Supabase-backed test env is
// provisioned. Manual verification for Phase 0 happens in
// supabase/20260417_user_memories.sql's apply runbook (see plan Task 2).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const url  = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const aEmail = process.env.TEST_USER_A_EMAIL;
const aPass  = process.env.TEST_USER_A_PASSWORD;
const bEmail = process.env.TEST_USER_B_EMAIL;
const bPass  = process.env.TEST_USER_B_PASSWORD;

const enabled = url && anon && aEmail && aPass && bEmail && bPass;

describe('user_memories RLS — two-user isolation', { skip: !enabled && 'test users not configured' }, () => {
  let createClient, clientA, clientB, createdId;

  before(async () => {
    ({ createClient } = await import('@supabase/supabase-js'));
    clientA = createClient(url, anon);
    clientB = createClient(url, anon);

    const a = await clientA.auth.signInWithPassword({ email: aEmail, password: aPass });
    assert.equal(a.error, null, `user A sign-in failed: ${a.error?.message}`);
    const b = await clientB.auth.signInWithPassword({ email: bEmail, password: bPass });
    assert.equal(b.error, null, `user B sign-in failed: ${b.error?.message}`);
  });

  after(async () => {
    if (createdId && clientA) {
      await clientA.from('user_memories').delete().eq('id', createdId);
    }
    if (clientA) await clientA.auth.signOut();
    if (clientB) await clientB.auth.signOut();
  });

  test('user A inserts; user B cannot SELECT', async () => {
    const insert = await clientA.from('user_memories').insert({
      category: 'custom',
      tier: 'X',
      fact: 'RLS isolation test — should not leak',
      source: 'explicit',
    }).select().single();

    assert.equal(insert.error, null, `insert failed: ${insert.error?.message}`);
    createdId = insert.data.id;

    const selA = await clientA.from('user_memories').select('id').eq('id', createdId);
    assert.equal(selA.data.length, 1, 'user A should see their own row');

    const selB = await clientB.from('user_memories').select('id').eq('id', createdId);
    assert.equal(selB.error, null);
    assert.equal(selB.data.length, 0, 'RLS leak: user B saw user A\'s memory');
  });

  test('user B cannot UPDATE user A\'s row', async () => {
    assert.ok(createdId, 'prior test must have created a row');
    // RLS update policy returns success with 0 rows affected.
    await clientB.from('user_memories').update({ fact: 'hacked' }).eq('id', createdId);

    const sel = await clientA.from('user_memories').select('fact').eq('id', createdId).single();
    assert.equal(sel.data.fact, 'RLS isolation test — should not leak');
  });
});
