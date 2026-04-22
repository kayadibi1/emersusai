import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, easeInOutCubic, lerpStateParams } from '../../../../shared/emersus-orb/state.js';

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
