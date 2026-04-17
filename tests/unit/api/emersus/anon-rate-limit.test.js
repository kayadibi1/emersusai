import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAnonAskRateLimit,
  decrementAnonAskRateLimit,
  __resetAnonAskStoreForTests,
  ANON_ASK_LIMIT,
} from '../../../../api/emersus/rate-limit.js';

function fakeReq(ip = '1.2.3.4') {
  return { ip, socket: { remoteAddress: ip }, headers: {} };
}

describe('anon-ask rate limiter', () => {
  beforeEach(() => __resetAnonAskStoreForTests());

  test('allows first three requests from same IP', () => {
    const req = fakeReq();
    for (let i = 0; i < ANON_ASK_LIMIT; i++) {
      const r = checkAnonAskRateLimit(req);
      assert.equal(r.allowed, true);
      assert.equal(r.asked, i + 1);
    }
  });

  test('blocks the fourth request', () => {
    const req = fakeReq();
    for (let i = 0; i < ANON_ASK_LIMIT; i++) checkAnonAskRateLimit(req);
    const r = checkAnonAskRateLimit(req);
    assert.equal(r.allowed, false);
    assert.equal(r.asked, ANON_ASK_LIMIT);
  });

  test('different IPs are independent', () => {
    for (let i = 0; i < ANON_ASK_LIMIT; i++) checkAnonAskRateLimit(fakeReq('1.1.1.1'));
    const r = checkAnonAskRateLimit(fakeReq('2.2.2.2'));
    assert.equal(r.allowed, true);
    assert.equal(r.asked, 1);
  });

  test('decrement returns a burned slot', () => {
    const req = fakeReq();
    checkAnonAskRateLimit(req);
    checkAnonAskRateLimit(req);
    decrementAnonAskRateLimit(req);
    const r = checkAnonAskRateLimit(req);
    assert.equal(r.allowed, true);
    assert.equal(r.asked, 2);
  });

  test('decrement does not go below zero on an empty store', () => {
    const req = fakeReq();
    decrementAnonAskRateLimit(req);
    const r = checkAnonAskRateLimit(req);
    assert.equal(r.asked, 1);
  });
});
