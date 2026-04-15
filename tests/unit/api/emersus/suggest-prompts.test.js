import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERIC_PROMPTS,
  promptsForProfile,
} from '../../../../api/emersus/suggest-prompts.js';

describe('suggest-prompts — generic fallback', () => {
  test('returns exactly 6 generic prompts', () => {
    assert.equal(GENERIC_PROMPTS.length, 6);
    for (const prompt of GENERIC_PROMPTS) {
      assert.equal(typeof prompt.id, 'string');
      assert.equal(typeof prompt.label, 'string');
      assert.equal(typeof prompt.prompt, 'string');
      assert.ok(prompt.id.length, 'id non-empty');
      assert.ok(prompt.label.length, 'label non-empty');
      assert.ok(prompt.prompt.length, 'prompt non-empty');
    }
  });

  test('all generic prompt ids are unique', () => {
    const ids = new Set(GENERIC_PROMPTS.map((p) => p.id));
    assert.equal(ids.size, GENERIC_PROMPTS.length);
  });
});

describe('suggest-prompts — profile-aware resolution', () => {
  test('null/empty profile → generic prompts', () => {
    assert.deepEqual(promptsForProfile(null), GENERIC_PROMPTS);
    assert.deepEqual(promptsForProfile({}), GENERIC_PROMPTS);
  });

  test('hypertrophy goal returns the hypertrophy prompt set', () => {
    const out = promptsForProfile({ goal: 'hypertrophy' });
    const text = out.map((p) => p.prompt.toLowerCase()).join(' ');
    assert.match(text, /protein|hypertrophy|set|rep|volume/);
    assert.equal(out.length, 6);
  });

  test('endurance goal returns the endurance prompt set', () => {
    const out = promptsForProfile({ goal: 'endurance' });
    const text = out.map((p) => p.prompt.toLowerCase()).join(' ');
    assert.match(text, /zone 2|vo2|threshold|cardio/);
  });

  test('beginner experience returns beginner prompts', () => {
    const out = promptsForProfile({ experience: 'beginner' });
    const text = out.map((p) => p.prompt.toLowerCase()).join(' ');
    assert.match(text, /start|begin|new/);
  });

  test('always returns 6 prompts', () => {
    for (const goal of ['hypertrophy', 'endurance', 'fat_loss', 'general_health']) {
      assert.equal(promptsForProfile({ goal }).length, 6);
    }
  });

  test('every returned prompt has id / label / prompt', () => {
    for (const prompt of promptsForProfile({ goal: 'hypertrophy', experience: 'intermediate' })) {
      assert.ok(prompt.id);
      assert.ok(prompt.label);
      assert.ok(prompt.prompt);
    }
  });
});
