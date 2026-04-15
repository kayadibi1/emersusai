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
    const result = resolveInitialTheme({ saved: 'paper', systemPrefersLight: false });
    assert.equal(result, 'paper');
  });

  test('resolveInitialTheme falls back to system preference when saved is invalid', () => {
    assert.equal(resolveInitialTheme({ saved: 'neon', systemPrefersLight: true }), 'paper');
    assert.equal(resolveInitialTheme({ saved: 'neon', systemPrefersLight: false }), 'mint');
  });

  test('resolveInitialTheme defaults to mint when nothing is known', () => {
    assert.equal(resolveInitialTheme({ saved: null, systemPrefersLight: false }), 'mint');
    assert.equal(resolveInitialTheme({ saved: undefined, systemPrefersLight: undefined }), 'mint');
  });

  test('resolveInitialTheme picks paper when system prefers light and no saved value', () => {
    assert.equal(resolveInitialTheme({ saved: null, systemPrefersLight: true }), 'paper');
  });
});
