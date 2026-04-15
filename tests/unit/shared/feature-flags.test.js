import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFlag,
  KNOWN_FLAGS,
  isKnownFlag,
  parseUrlFlagOverride,
} from '../../../shared/feature-flags.js';

describe('feature-flags — pure logic', () => {
  test('KNOWN_FLAGS is the canonical list', () => {
    assert.ok(Array.isArray(KNOWN_FLAGS));
    assert.ok(KNOWN_FLAGS.includes('chat_v2'));
    assert.ok(KNOWN_FLAGS.includes('train_v2'));
    assert.ok(KNOWN_FLAGS.includes('nutrition_v2'));
    assert.ok(KNOWN_FLAGS.includes('progress_v2'));
    assert.ok(KNOWN_FLAGS.includes('profile_v2'));
    assert.ok(KNOWN_FLAGS.includes('auth_v2'));
    assert.ok(KNOWN_FLAGS.includes('public_v2'));
    assert.ok(KNOWN_FLAGS.includes('conversational_onboarding'));
  });

  test('isKnownFlag recognizes canonical flags', () => {
    assert.equal(isKnownFlag('chat_v2'), true);
    assert.equal(isKnownFlag('unknown_flag'), false);
    assert.equal(isKnownFlag(''), false);
    assert.equal(isKnownFlag(null), false);
    assert.equal(isKnownFlag(undefined), false);
  });

  test('readFlag returns default when saved + url are absent', () => {
    assert.equal(readFlag('chat_v2', { saved: null, url: null }), false);
  });

  test('readFlag returns saved value when set (no url override)', () => {
    assert.equal(readFlag('chat_v2', { saved: true, url: null }), true);
    assert.equal(readFlag('chat_v2', { saved: false, url: null }), false);
  });

  test('readFlag url override beats saved', () => {
    assert.equal(readFlag('chat_v2', { saved: false, url: true }), true);
    assert.equal(readFlag('chat_v2', { saved: true, url: false }), false);
  });

  test('readFlag returns false for unknown flag', () => {
    assert.equal(readFlag('does_not_exist', { saved: true, url: true }), false);
  });

  test('parseUrlFlagOverride reads "1" / "true" as true and "0" / "false" as false', () => {
    assert.equal(parseUrlFlagOverride('1'), true);
    assert.equal(parseUrlFlagOverride('true'), true);
    assert.equal(parseUrlFlagOverride('0'), false);
    assert.equal(parseUrlFlagOverride('false'), false);
  });

  test('parseUrlFlagOverride returns null for missing / invalid values', () => {
    assert.equal(parseUrlFlagOverride(null), null);
    assert.equal(parseUrlFlagOverride(undefined), null);
    assert.equal(parseUrlFlagOverride(''), null);
    assert.equal(parseUrlFlagOverride('yes'), null);
    assert.equal(parseUrlFlagOverride('2'), null);
  });

  test('readFlag with default override honors per-flag defaults', () => {
    assert.equal(readFlag('chat_v2', { saved: null, url: null, defaults: { chat_v2: true } }), true);
    assert.equal(readFlag('chat_v2', { saved: null, url: null, defaults: { chat_v2: false } }), false);
  });
});
