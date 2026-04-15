import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const SECRET_ENV = 'EMERSUS_INVITE_SECRET';

let originalSecret;
before(() => { originalSecret = process.env[SECRET_ENV]; process.env[SECRET_ENV] = 'test-secret'; });
after(() => { if (originalSecret === undefined) delete process.env[SECRET_ENV]; else process.env[SECRET_ENV] = originalSecret; });

const { mintInviteToken, verifyInviteToken } = await import('../../../../api/auth/invite-tokens.js');

describe('invite-tokens', () => {
  test('mints a token that round-trips', () => {
    const token = mintInviteToken('alice@example.com');
    const result = verifyInviteToken(token);
    assert.equal(result.valid, true);
    assert.equal(result.email, 'alice@example.com');
    assert.match(result.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('lowercases + trims email at mint', () => {
    const token = mintInviteToken('  Bob@Example.COM  ');
    const result = verifyInviteToken(token);
    assert.equal(result.email, 'bob@example.com');
  });

  test('rejects malformed tokens', () => {
    assert.equal(verifyInviteToken('').valid, false);
    assert.equal(verifyInviteToken('no-dot').valid, false);
    assert.equal(verifyInviteToken('a.b.c.d').valid, false);
    assert.equal(verifyInviteToken(null).valid, false);
  });

  test('rejects tampered payload', () => {
    const token = mintInviteToken('alice@example.com');
    const [_payload, hmac] = token.split('.');
    const tampered = `${Buffer.from(JSON.stringify({ email: 'eve@example.com', exp: 9999999999 })).toString('base64url')}.${hmac}`;
    assert.equal(verifyInviteToken(tampered).valid, false);
  });

  test('rejects token with past expiry', async () => {
    // Hand-craft an expired payload + sign it with the test secret.
    const crypto = await import('node:crypto');
    const payload = JSON.stringify({ email: 'alice@example.com', exp: 1 }); // 1970
    const payloadEncoded = Buffer.from(payload).toString('base64url');
    const hmac = crypto.createHmac('sha256', process.env.EMERSUS_INVITE_SECRET).update(payloadEncoded).digest('hex');
    const expired = `${payloadEncoded}.${hmac}`;
    assert.equal(verifyInviteToken(expired).valid, false);
    assert.equal(verifyInviteToken(expired).reason, 'expired');
  });

  test('caps TTL at 90 days', () => {
    const token = mintInviteToken('alice@example.com', 99999);
    const result = verifyInviteToken(token);
    assert.equal(result.valid, true);
    const expires = new Date(result.expiresAt).getTime();
    const ninetyDaysMs = 90 * 86400 * 1000;
    assert.ok(expires - Date.now() <= ninetyDaysMs + 5000);
  });
});
