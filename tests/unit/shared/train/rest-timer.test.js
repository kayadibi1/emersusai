import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatRestRemaining, computeRemainingSeconds } from '../../../../shared/train/rest-timer.js';

describe('rest-timer', () => {
  test('formats minutes:seconds', () => {
    assert.equal(formatRestRemaining(0), '0:00');
    assert.equal(formatRestRemaining(45), '0:45');
    assert.equal(formatRestRemaining(120), '2:00');
    assert.equal(formatRestRemaining(125), '2:05');
  });

  test('computeRemainingSeconds clamps to 0', () => {
    const now = new Date('2026-04-15T12:00:00Z').getTime();
    const past = new Date('2026-04-15T11:59:00Z').toISOString();
    assert.equal(computeRemainingSeconds(past, now), 0);
  });

  test('computeRemainingSeconds rounds normally', () => {
    const now = new Date('2026-04-15T12:00:00Z').getTime();
    const future = new Date('2026-04-15T12:02:30Z').toISOString();
    assert.equal(computeRemainingSeconds(future, now), 150);
  });

  test('null/invalid endsAt returns 0', () => {
    assert.equal(computeRemainingSeconds(null), 0);
    assert.equal(computeRemainingSeconds(undefined), 0);
    assert.equal(computeRemainingSeconds('not a date'), 0);
  });
});
