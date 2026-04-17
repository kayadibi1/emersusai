import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordSuccess,
  recordError,
  getCircuitStatus,
  _resetCircuit,
  CIRCUIT_WINDOW_MS,
  CIRCUIT_COOLDOWN_MS,
  CIRCUIT_MIN_SAMPLES,
  CIRCUIT_ERROR_RATE,
} from '../../../../../api/emersus/pipeline/extract-memory-circuit.js';

describe('extractMemory circuit breaker', () => {
  beforeEach(() => _resetCircuit());

  test('fresh state — closed', () => {
    const s = getCircuitStatus(1000);
    assert.equal(s.open, false);
    assert.equal(s.error_rate, 0);
    assert.equal(s.samples, 0);
  });

  test('3 errors, under minimum sample count — still closed', () => {
    const t = 1000;
    for (let i = 0; i < 3; i++) recordError(t + i);
    const s = getCircuitStatus(t + 10);
    assert.equal(s.open, false);
    assert.equal(s.samples, 3);
    assert.equal(s.error_count, 3);
    assert.ok(CIRCUIT_MIN_SAMPLES > 3, 'test assumes min samples > 3');
  });

  test('min samples but error rate below threshold — closed', () => {
    const t = 1000;
    // 1 error + 4 successes → 20% rate, below 30%
    recordError(t);
    for (let i = 0; i < 4; i++) recordSuccess(t + 1 + i);
    const s = getCircuitStatus(t + 10);
    assert.equal(s.open, false);
    assert.equal(s.error_rate, 0.2);
  });

  test('min samples + ≥ 30% error rate — opens', () => {
    const t = 1000;
    // 2 errors + 3 successes → 40% rate
    recordError(t);
    recordError(t + 1);
    for (let i = 0; i < 3; i++) recordSuccess(t + 2 + i);
    const s = getCircuitStatus(t + 10);
    assert.equal(s.open, true);
    assert.ok(s.opened_at != null);
    assert.equal(s.reason, 'error_rate_exceeded');
  });

  test('once open, stays open for cooldown window even with successes', () => {
    const t = 1000;
    for (let i = 0; i < 5; i++) recordError(t + i);
    assert.equal(getCircuitStatus(t + 10).open, true);

    for (let i = 0; i < 100; i++) recordSuccess(t + 100 + i);
    assert.equal(getCircuitStatus(t + 200).open, true);

    const afterCooldown = getCircuitStatus(t + CIRCUIT_COOLDOWN_MS + 1000);
    assert.equal(afterCooldown.open, false);
  });

  test('closing at cooldown resets the sample window', () => {
    const t = 1000;
    for (let i = 0; i < 5; i++) recordError(t + i);
    assert.equal(getCircuitStatus(t + 10).open, true);

    const after = t + CIRCUIT_COOLDOWN_MS + 1000;
    const reopened = getCircuitStatus(after);
    assert.equal(reopened.open, false);
    assert.equal(reopened.samples, 0, 'samples cleared on close');
  });

  test('old samples outside window are ignored', () => {
    const t = 1000;
    for (let i = 0; i < 4; i++) recordError(t + i); // way in the past
    const future = t + CIRCUIT_WINDOW_MS + 1000;
    // now add one new error and one success — below threshold
    recordError(future);
    recordSuccess(future + 1);
    const s = getCircuitStatus(future + 2);
    assert.equal(s.samples, 2);
    assert.equal(s.error_rate, 0.5);
    assert.equal(s.open, false, 'only 2 samples, below min');
  });

  test('onOpen callback fires once per open event', () => {
    const t = 1000;
    const onOpenCalls = [];
    for (let i = 0; i < 5; i++) {
      recordError(t + i, { onOpen: (ctx) => onOpenCalls.push(ctx) });
    }
    assert.equal(onOpenCalls.length, 1, 'fires exactly once');
    assert.equal(onOpenCalls[0].reason, 'error_rate_exceeded');
  });
});
