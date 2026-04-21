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
    assert.equal(resolveInitialTheme({ saved: 'neon' }), 'mint');
    assert.equal(resolveInitialTheme({ saved: '' }), 'mint');
  });

  test('resolveInitialTheme defaults to mint when nothing is saved', () => {
    assert.equal(resolveInitialTheme({ saved: null }), 'mint');
    assert.equal(resolveInitialTheme({ saved: undefined }), 'mint');
    assert.equal(resolveInitialTheme({}), 'mint');
  });

  test('resolveInitialTheme ignores systemPrefersLight (default is mint regardless)', () => {
    assert.equal(resolveInitialTheme({ saved: null, systemPrefersLight: false }), 'mint');
    assert.equal(resolveInitialTheme({ saved: null, systemPrefersLight: true }), 'mint');
  });
});
