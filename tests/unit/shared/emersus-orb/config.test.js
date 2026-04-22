import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, readTuning } from '../../../../shared/emersus-orb/config.js';

describe('emersus-orb/config.js', () => {
  test('DEFAULTS exposes the locked physics values from the brainstorm', () => {
    assert.equal(DEFAULTS.curve, 0.04);
    assert.equal(DEFAULTS.continuous, 0);
    assert.equal(DEFAULTS.overshoot, 0);
    assert.equal(DEFAULTS.preBurst, 1.0);
    assert.equal(DEFAULTS.staggerMs, 750);
    assert.equal(DEFAULTS.spin, 1.0);
  });

  test('DEFAULTS exposes rendering constants', () => {
    assert.equal(DEFAULTS.particleCount, 260);
    assert.equal(DEFAULTS.trailLen, 40);
    assert.equal(DEFAULTS.transitWindowMs, 2200);
    assert.equal(DEFAULTS.burstWindowMs, 350);
    assert.equal(DEFAULTS.stateTxMs, 2200);
  });

  test('readTuning returns DEFAULTS when no search string is given', () => {
    const t = readTuning('');
    assert.equal(t.curve, DEFAULTS.curve);
    assert.equal(t.preBurst, DEFAULTS.preBurst);
  });

  test('readTuning parses ?tune params and overrides matching keys', () => {
    const t = readTuning('?tune=1&curve=0.3&preBurst=1.8&staggerMs=500');
    assert.equal(t.curve, 0.3);
    assert.equal(t.preBurst, 1.8);
    assert.equal(t.staggerMs, 500);
    assert.equal(t.continuous, DEFAULTS.continuous);
  });

  test('readTuning ignores unknown keys and non-numeric values', () => {
    const t = readTuning('?tune=1&curve=abc&bogus=42');
    assert.equal(t.curve, DEFAULTS.curve);
    assert.equal(t.bogus, undefined);
  });
});
