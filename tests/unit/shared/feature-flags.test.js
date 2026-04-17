import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFlag,
  KNOWN_FLAGS,
  isKnownFlag,
  parseUrlFlagOverride,
  DEFAULT_FLAGS,
} from '../../../shared/feature-flags.js';

describe('feature-flags — pure logic', () => {
  test('KNOWN_FLAGS is the canonical list (post-v2-cleanup)', () => {
    assert.ok(Array.isArray(KNOWN_FLAGS));
    // Per-phase v2 flags retired 2026-04-16 — every phase shipped on by
    // default and the flags became no-ops. Only product flags remain.
    assert.ok(KNOWN_FLAGS.includes('conversational_onboarding'));
    assert.ok(KNOWN_FLAGS.includes('chat_model_selector'));
    assert.ok(KNOWN_FLAGS.includes('progress_benchmarks'));
    assert.ok(KNOWN_FLAGS.includes('progress_training_load'));
    assert.ok(KNOWN_FLAGS.includes('nutrition_quick_log'));
    assert.ok(KNOWN_FLAGS.includes('integrations_waitlist'));
    // Retired v2 phase flags MUST NOT appear in KNOWN_FLAGS
    for (const retired of ['chat_v2', 'auth_v2', 'train_v2', 'nutrition_v2', 'progress_v2', 'profile_v2', 'public_v2']) {
      assert.ok(!KNOWN_FLAGS.includes(retired), `${retired} should be retired`);
    }
  });

  test('isKnownFlag recognizes canonical flags', () => {
    assert.equal(isKnownFlag('conversational_onboarding'), true);
    assert.equal(isKnownFlag('chat_v2'), false); // retired
    assert.equal(isKnownFlag('unknown_flag'), false);
    assert.equal(isKnownFlag(''), false);
    assert.equal(isKnownFlag(null), false);
    assert.equal(isKnownFlag(undefined), false);
  });

  test('readFlag returns default when saved + url are absent', () => {
    assert.equal(readFlag('chat_model_selector', { saved: null, url: null }), false);
  });

  test('readFlag returns saved value when set (no url override)', () => {
    assert.equal(readFlag('conversational_onboarding', { saved: true, url: null }), true);
    assert.equal(readFlag('conversational_onboarding', { saved: false, url: null }), false);
  });

  test('readFlag url override beats saved', () => {
    assert.equal(readFlag('conversational_onboarding', { saved: false, url: true }), true);
    assert.equal(readFlag('conversational_onboarding', { saved: true, url: false }), false);
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
    assert.equal(readFlag('conversational_onboarding', { saved: null, url: null, defaults: { conversational_onboarding: true } }), true);
    assert.equal(readFlag('conversational_onboarding', { saved: null, url: null, defaults: { conversational_onboarding: false } }), false);
  });

  test('DEFAULT_FLAGS has only conversational_onboarding pre-enabled', () => {
    assert.equal(DEFAULT_FLAGS.conversational_onboarding, true);
    // Other flags have no default → resolve to false unless explicitly enabled.
    assert.equal(DEFAULT_FLAGS.chat_model_selector, undefined);
    assert.equal(DEFAULT_FLAGS.progress_benchmarks, undefined);
    assert.equal(DEFAULT_FLAGS.progress_training_load, undefined);
    assert.equal(DEFAULT_FLAGS.nutrition_quick_log, undefined);
    assert.equal(DEFAULT_FLAGS.integrations_waitlist, undefined);
  });

  test('DEFAULT_FLAGS is frozen so callers cannot mutate the baseline', () => {
    assert.throws(() => { DEFAULT_FLAGS.conversational_onboarding = false; }, /Cannot assign|read only/i);
  });
});

describe('feature-flags — WIDGET_V2_ENABLED', () => {
  test('WIDGET_V2_ENABLED exists and is boolean', async () => {
    const { WIDGET_V2_ENABLED } = await import('../../../shared/feature-flags.js');
    assert.equal(typeof WIDGET_V2_ENABLED, 'boolean');
  });

  test('WIDGET_V2_ENABLED defaults to false without env override', async () => {
    const { WIDGET_V2_ENABLED } = await import('../../../shared/feature-flags.js');
    // Default behavior: disabled until explicit opt-in via WIDGET_V2_ENABLED=true
    assert.equal(WIDGET_V2_ENABLED, process.env.WIDGET_V2_ENABLED === 'true');
  });
});
