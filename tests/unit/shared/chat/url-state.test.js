import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTrainUrl,
  buildTrainUrl,
  MODALITIES,
  TABS,
} from '../../../../shared/chat/url-state.js';

describe('url-state — parseTrainUrl', () => {
  test('defaults to lift/active when search empty', () => {
    assert.deepEqual(parseTrainUrl(''), { modality: 'lift', tab: 'active', sessionId: '' });
    assert.deepEqual(parseTrainUrl(null), { modality: 'lift', tab: 'active', sessionId: '' });
  });

  test('parses all three params', () => {
    const out = parseTrainUrl('?modality=cardio&tab=history&session=abc-123');
    assert.deepEqual(out, { modality: 'cardio', tab: 'history', sessionId: 'abc-123' });
  });

  test('rejects unknown modality / tab and falls back to defaults', () => {
    assert.equal(parseTrainUrl('?modality=fishing').modality, 'lift');
    assert.equal(parseTrainUrl('?tab=bogus').tab, 'active');
  });

  test('search string with no leading ? is also accepted', () => {
    const out = parseTrainUrl('modality=swim');
    assert.equal(out.modality, 'swim');
  });
});

describe('url-state — buildTrainUrl', () => {
  test('omits defaults to keep URLs short', () => {
    assert.equal(buildTrainUrl({ modality: 'lift', tab: 'active' }), '');
    assert.equal(buildTrainUrl({ modality: 'lift', tab: 'active', sessionId: '' }), '');
  });

  test('includes non-default fields', () => {
    assert.equal(buildTrainUrl({ modality: 'cardio', tab: 'active' }), '?modality=cardio');
    assert.equal(buildTrainUrl({ modality: 'lift', tab: 'history' }), '?tab=history');
    assert.equal(
      buildTrainUrl({ modality: 'cardio', tab: 'history', sessionId: 'x1' }),
      '?modality=cardio&tab=history&session=x1',
    );
  });

  test('round-trips through parseTrainUrl', () => {
    const original = { modality: 'climb', tab: 'history', sessionId: 'abc' };
    const round = parseTrainUrl(buildTrainUrl(original));
    assert.deepEqual(round, original);
  });
});

describe('url-state — constants', () => {
  test('MODALITIES is the canonical 4', () => {
    assert.deepEqual(MODALITIES, ['lift', 'cardio', 'swim', 'climb']);
  });
  test('TABS is the canonical 2', () => {
    assert.deepEqual(TABS, ['active', 'history']);
  });
});
