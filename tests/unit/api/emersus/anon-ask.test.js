import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../../../api/emersus/anon-ask.js';
import {
  checkAnonAskRateLimit,
  __resetAnonAskStoreForTests,
  ANON_ASK_LIMIT,
} from '../../../../api/emersus/rate-limit.js';

function makeReqRes({ method = 'POST', body = { question: 'What is creatine?' }, ip = '1.2.3.4' } = {}) {
  const headers = { 'user-agent': 'test-runner' };
  const req = { method, body, ip, socket: { remoteAddress: ip }, headers };
  const listeners = {};
  const res = {
    statusCode: 200,
    headers: {},
    _json: null,
    _writes: [],
    headersSent: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this._json = payload; this.headersSent = true; return this; },
    write(chunk) { this._writes.push(chunk); },
    end() { this.headersSent = true; },
    on(event, fn) { listeners[event] = fn; },
  };
  return { req, res, listeners };
}

describe('anon-ask handler', () => {
  beforeEach(() => __resetAnonAskStoreForTests());

  test('rejects non-POST with 405', async () => {
    const { req, res } = makeReqRes({ method: 'GET' });
    await handler(req, res);
    assert.equal(res.statusCode, 405);
  });

  test('responds 204 on OPTIONS', async () => {
    const { req, res } = makeReqRes({ method: 'OPTIONS' });
    await handler(req, res);
    assert.equal(res.statusCode, 204);
  });

  test('rejects empty question with 400', async () => {
    const { req, res } = makeReqRes({ body: { question: '' } });
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  test('returns 429 when the IP has already used its 3-per-day quota', async () => {
    const ip = '9.9.9.9';
    for (let i = 0; i < ANON_ASK_LIMIT; i++) {
      checkAnonAskRateLimit({ ip, socket: { remoteAddress: ip }, headers: {} });
    }
    const { req, res } = makeReqRes({ ip });
    await handler(req, res);
    assert.equal(res.statusCode, 429);
    assert.equal(res._json.error, 'rate_limit');
    assert.equal(res._json.asked, ANON_ASK_LIMIT);
    assert.equal(res._json.limit, ANON_ASK_LIMIT);
  });

  test('429 payload includes resetAt timestamp', async () => {
    const ip = '8.8.8.8';
    for (let i = 0; i < ANON_ASK_LIMIT; i++) {
      checkAnonAskRateLimit({ ip, socket: { remoteAddress: ip }, headers: {} });
    }
    const { req, res } = makeReqRes({ ip });
    await handler(req, res);
    assert.equal(typeof res._json.resetAt, 'number');
    assert.ok(res._json.resetAt > Date.now());
  });
});
