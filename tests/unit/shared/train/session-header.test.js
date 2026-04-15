import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatElapsed, normalizeSessionTitle } from '../../../../shared/train/session-header.js';

describe('session-header — formatElapsed', () => {
  test('seconds only under 1m', () => {
    assert.equal(formatElapsed(45_000), '0:45');
  });
  test('mm:ss under 1h', () => {
    assert.equal(formatElapsed(38 * 60_000 + 22_000), '38:22');
  });
  test('h:mm:ss over 1h', () => {
    assert.equal(formatElapsed(3 * 3_600_000 + 5 * 60_000 + 9_000), '3:05:09');
  });
  test('handles 0 and negative as 0:00', () => {
    assert.equal(formatElapsed(0), '0:00');
    assert.equal(formatElapsed(-1000), '0:00');
  });
});

describe('session-header — normalizeSessionTitle', () => {
  test('trims + collapses whitespace', () => {
    assert.equal(normalizeSessionTitle('  push   day '), 'push day');
  });
  test('returns null for blank', () => {
    assert.equal(normalizeSessionTitle(''), null);
    assert.equal(normalizeSessionTitle('   '), null);
    assert.equal(normalizeSessionTitle(null), null);
  });
  test('truncates to max length', () => {
    const long = 'x'.repeat(300);
    assert.equal(normalizeSessionTitle(long).length, 200);
  });
});
