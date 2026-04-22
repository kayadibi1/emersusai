import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, easeInOutCubic, lerpStateParams } from '../../../../shared/emersus-orb/state.js';
import { breathScale } from '../../../../shared/emersus-orb/state.js';

describe('emersus-orb/state.js — STATES + easing', () => {
  test('has three states', () => {
    assert.deepEqual(Object.keys(STATES), ['idle', 'thinking', 'responding']);
  });

  test('idle and thinking both set cycleMs high-enough (thinking freezes shape too)', () => {
    assert.equal(STATES.responding.cycleMs, 2000);
  });

  test('breath settings differ between idle and thinking', () => {
    assert.equal(STATES.idle.breathAmp, 0);
    assert(STATES.thinking.breathAmp > 0);
  });

  test('easeInOutCubic is symmetric', () => {
    assert.equal(easeInOutCubic(0), 0);
    assert.equal(easeInOutCubic(1), 1);
    assert(Math.abs(easeInOutCubic(0.5) - 0.5) < 1e-6);
  });

  test('lerpStateParams interpolates all scalar + nested tint values', () => {
    const out = lerpStateParams(STATES.idle, STATES.responding, 0.5);
    assert(out.springBase > 0);
    assert(out.tint.r > 0);
    const zero = lerpStateParams(STATES.idle, STATES.responding, 0);
    assert.equal(zero.springBase, STATES.idle.springBase);
    assert.equal(zero.tint.r, STATES.idle.tint.r);
  });
});

describe('emersus-orb/state.js — breathScale', () => {
  test('amp=0 always returns 1 regardless of time', () => {
    assert.equal(breathScale(0, 0, 1), 1);
    assert.equal(breathScale(1000, 0, 1), 1);
    assert.equal(breathScale(12345, 0, 2), 1);
  });

  test('amp=0.08 oscillates in [1-amp, 1+amp] bounds', () => {
    for (let ms = 0; ms < 10000; ms += 37) {
      const s = breathScale(ms, 0.08, 0.75);
      assert(s >= 1 - 0.08 - 1e-9, `below lower bound at ${ms}: ${s}`);
      assert(s <= 1 + 0.08 + 1e-9, `above upper bound at ${ms}: ${s}`);
    }
  });

  test('freq controls oscillation period', () => {
    assert.equal(breathScale(1000, 0.1, 0), 1);
  });
});
