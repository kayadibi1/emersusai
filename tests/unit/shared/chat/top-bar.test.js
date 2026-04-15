import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeThreadTitle,
  resolveTitleKeyAction,
  MODEL_OPTIONS,
  isKnownModel,
} from '../../../../shared/chat/top-bar.js';

describe('top-bar — title normalization', () => {
  test('trims whitespace', () => {
    assert.equal(normalizeThreadTitle('  hello  '), 'hello');
  });

  test('collapses internal whitespace runs to single space', () => {
    assert.equal(normalizeThreadTitle('a    b\t\tc\n\nd'), 'a b c d');
  });

  test('returns null for blank / whitespace-only input', () => {
    assert.equal(normalizeThreadTitle(''), null);
    assert.equal(normalizeThreadTitle('   '), null);
    assert.equal(normalizeThreadTitle('\n\t'), null);
    assert.equal(normalizeThreadTitle(null), null);
    assert.equal(normalizeThreadTitle(undefined), null);
  });

  test('truncates to 120 chars', () => {
    const long = 'x'.repeat(200);
    const result = normalizeThreadTitle(long);
    assert.equal(result.length, 120);
  });

  test('coerces non-strings to string before normalizing', () => {
    assert.equal(normalizeThreadTitle(123), '123');
  });
});

describe('top-bar — key action resolver', () => {
  test('Enter commits when draft differs from original', () => {
    assert.equal(
      resolveTitleKeyAction('Enter', { shiftKey: false }, { draft: 'New', original: 'Old' }),
      'commit',
    );
  });

  test('Enter with Shift does nothing (allow multi-line in case of textarea)', () => {
    assert.equal(
      resolveTitleKeyAction('Enter', { shiftKey: true }, { draft: 'New', original: 'Old' }),
      null,
    );
  });

  test('Enter cancels when draft normalizes to empty', () => {
    assert.equal(
      resolveTitleKeyAction('Enter', { shiftKey: false }, { draft: '   ', original: 'Old' }),
      'cancel',
    );
  });

  test('Enter is no-op when draft unchanged', () => {
    assert.equal(
      resolveTitleKeyAction('Enter', { shiftKey: false }, { draft: 'Same', original: 'Same' }),
      'cancel',
    );
  });

  test('Escape cancels', () => {
    assert.equal(
      resolveTitleKeyAction('Escape', {}, { draft: 'New', original: 'Old' }),
      'cancel',
    );
  });

  test('other keys return null', () => {
    assert.equal(resolveTitleKeyAction('a', {}, { draft: 'N', original: 'O' }), null);
    assert.equal(resolveTitleKeyAction('Tab', {}, { draft: 'N', original: 'O' }), null);
  });
});

describe('top-bar — model registry', () => {
  test('MODEL_OPTIONS has the three tiers with stable ids', () => {
    assert.ok(Array.isArray(MODEL_OPTIONS));
    const ids = MODEL_OPTIONS.map((m) => m.id);
    assert.deepEqual(ids, ['emersus-0.5', 'emersus-0.5-fast', 'emersus-0.5-deep']);
    for (const option of MODEL_OPTIONS) {
      assert.equal(typeof option.label, 'string');
      assert.ok(option.label.length > 0);
    }
  });

  test('isKnownModel recognizes tier ids only', () => {
    assert.equal(isKnownModel('emersus-0.5'), true);
    assert.equal(isKnownModel('emersus-0.5-fast'), true);
    assert.equal(isKnownModel('emersus-0.5-deep'), true);
    assert.equal(isKnownModel('gpt-4'), false);
    assert.equal(isKnownModel(''), false);
    assert.equal(isKnownModel(null), false);
    assert.equal(isKnownModel(undefined), false);
  });
});
