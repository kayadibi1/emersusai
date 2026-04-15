import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateShareToken,
  resolveExpiryDate,
} from '../../../../api/emersus/threads-share.js';

describe('threads-share — token generator', () => {
  test('returns a 22-char url-safe string', () => {
    const token = generateShareToken();
    assert.equal(typeof token, 'string');
    assert.equal(token.length, 22);
    assert.match(token, /^[A-Za-z0-9_-]{22}$/);
  });

  test('produces distinct tokens across calls', () => {
    const set = new Set();
    for (let i = 0; i < 100; i++) set.add(generateShareToken());
    assert.equal(set.size, 100);
  });
});

describe('threads-share — expiry resolver', () => {
  test('defaults to 30 days when no input', () => {
    const now = new Date('2026-04-15T00:00:00Z');
    const expires = resolveExpiryDate(undefined, now);
    assert.equal(expires.toISOString(), '2026-05-15T00:00:00.000Z');
  });

  test('honors a valid positive integer', () => {
    const now = new Date('2026-04-15T00:00:00Z');
    const expires = resolveExpiryDate(7, now);
    assert.equal(expires.toISOString(), '2026-04-22T00:00:00.000Z');
  });

  test('caps at 365 days', () => {
    const now = new Date('2026-04-15T00:00:00Z');
    const expires = resolveExpiryDate(9999, now);
    assert.equal(expires.toISOString(), '2027-04-15T00:00:00.000Z');
  });

  test('falls back to default when input is zero / negative / NaN', () => {
    const now = new Date('2026-04-15T00:00:00Z');
    assert.equal(resolveExpiryDate(0, now).toISOString(), '2026-05-15T00:00:00.000Z');
    assert.equal(resolveExpiryDate(-5, now).toISOString(), '2026-05-15T00:00:00.000Z');
    assert.equal(resolveExpiryDate('nope', now).toISOString(), '2026-05-15T00:00:00.000Z');
  });
});
