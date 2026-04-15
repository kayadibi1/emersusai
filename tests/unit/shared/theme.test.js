import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInitialTheme, validateTheme, VALID_THEMES } from '../../../shared/theme.js';

describe('theme.js — pure logic', () => {
  test('VALID_THEMES is the canonical list', () => {
    assert.deepEqual(VALID_THEMES, ['mint', 'paper']);
  });

  test('validateTheme returns the theme when valid', () => {
    assert.equal(validateTheme('mint'), 'mint');
    assert.equal(validateTheme('paper'), 'paper');
  });

  test('validateTheme returns null for unknown themes', () => {
    assert.equal(validateTheme('neon'), null);
    assert.equal(validateTheme(''), null);
    assert.equal(validateTheme(null), null);
    assert.equal(validateTheme(undefined), null);
  });

  test('resolveInitialTheme prefers saved value when valid', () => {
    assert.equal(resolveInitialTheme({ saved: 'paper' }), 'paper');
    assert.equal(resolveInitialTheme({ saved: 'mint' }), 'mint');
  });

  test('resolveInitialTheme ignores an invalid saved value and returns the default', () => {
    assert.equal(resolveInitialTheme({ saved: 'neon' }), 'paper');
    assert.equal(resolveInitialTheme({ saved: '' }), 'paper');
  });

  test('resolveInitialTheme defaults to paper when nothing is saved', () => {
    assert.equal(resolveInitialTheme({ saved: null }), 'paper');
    assert.equal(resolveInitialTheme({ saved: undefined }), 'paper');
    assert.equal(resolveInitialTheme({}), 'paper');
  });

  test('resolveInitialTheme ignores systemPrefersLight (product ships light-first)', () => {
    assert.equal(resolveInitialTheme({ saved: null, systemPrefersLight: false }), 'paper');
    assert.equal(resolveInitialTheme({ saved: null, systemPrefersLight: true }), 'paper');
  });
});
