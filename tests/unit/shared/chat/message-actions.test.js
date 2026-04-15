import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSourcesAsAPA,
  resolveAvailableActions,
  messageHasWorkoutPlan,
  messageHasMealPlan,
} from '../../../../shared/chat/message-actions.js';

describe('message-actions — APA citation formatter', () => {
  test('formats a PubMed source with authors / year / title / journal', () => {
    const out = formatSourcesAsAPA([
      {
        authors: ['Morton RW', 'Murphy KT', 'McKellar SR'],
        year: 2018,
        title: 'A systematic review, meta-analysis and meta-regression of protein supplementation on resistance training',
        journal: 'British Journal of Sports Medicine',
        pmid: 28698222,
        source: 'pubmed',
      },
    ]);
    assert.match(out, /Morton/);
    assert.match(out, /2018/);
    assert.match(out, /British Journal of Sports Medicine/);
    assert.match(out, /pubmed\.ncbi\.nlm\.nih\.gov\/28698222/);
  });

  test('falls back to "Unknown author" when authors missing', () => {
    const out = formatSourcesAsAPA([
      { year: 2021, title: 'Creatine review', journal: 'JISSN' },
    ]);
    assert.match(out, /Unknown author/);
  });

  test('returns empty string for empty / missing input', () => {
    assert.equal(formatSourcesAsAPA([]), '');
    assert.equal(formatSourcesAsAPA(null), '');
    assert.equal(formatSourcesAsAPA(undefined), '');
  });

  test('numbers entries and separates with blank lines', () => {
    const out = formatSourcesAsAPA([
      { authors: ['A'], year: 2020, title: 'T1', journal: 'J1' },
      { authors: ['B'], year: 2021, title: 'T2', journal: 'J2' },
    ]);
    assert.match(out, /^\[1\]/);
    assert.match(out, /\n\n\[2\]/);
  });

  test('joins more than 6 authors with "et al."', () => {
    const many = Array.from({ length: 10 }, (_, i) => `Author${i + 1}`);
    const out = formatSourcesAsAPA([{ authors: many, year: 2022, title: 'T', journal: 'J' }]);
    assert.match(out, /et al\./);
  });
});

describe('message-actions — plan detection', () => {
  test('messageHasWorkoutPlan returns true for workout-plan fence in text', () => {
    assert.equal(messageHasWorkoutPlan({ text: '```workout-plan\n{"title":"x"}\n```' }), true);
    assert.equal(messageHasWorkoutPlan({ plainText: '```workout-plan\n{}\n```' }), true);
  });

  test('messageHasWorkoutPlan respects toolResults', () => {
    assert.equal(messageHasWorkoutPlan({ toolResults: { emit_workout_plan: { title: 'x' } } }), true);
  });

  test('messageHasWorkoutPlan false for unrelated content', () => {
    assert.equal(messageHasWorkoutPlan({ text: 'no plan here' }), false);
    assert.equal(messageHasWorkoutPlan(null), false);
    assert.equal(messageHasWorkoutPlan({}), false);
  });

  test('messageHasMealPlan detects fence + toolResults', () => {
    assert.equal(messageHasMealPlan({ text: '```meal-plan\n{}\n```' }), true);
    assert.equal(messageHasMealPlan({ toolResults: { emit_meal_plan: { day_types: [] } } }), true);
    assert.equal(messageHasMealPlan({ text: 'nope' }), false);
  });
});

describe('message-actions — available action resolver', () => {
  test('defaults include copy / cite / regenerate / export', () => {
    const ids = resolveAvailableActions({ role: 'assistant', text: 'hi' }).map((a) => a.id);
    assert.deepEqual(ids, ['copy', 'cite', 'regenerate', 'export']);
  });

  test('adds save-plan when workout plan is present', () => {
    const ids = resolveAvailableActions({
      role: 'assistant',
      text: '```workout-plan\n{"title":"a"}\n```',
    }).map((a) => a.id);
    assert.ok(ids.includes('save-plan'));
    assert.equal(ids.indexOf('save-plan'), ids.indexOf('regenerate') + 1);
  });

  test('adds swap-meal when meal plan is present', () => {
    const ids = resolveAvailableActions({
      role: 'assistant',
      text: '```meal-plan\n{"day_types":[]}\n```',
    }).map((a) => a.id);
    assert.ok(ids.includes('swap-meal'));
  });

  test('returns empty list for user messages', () => {
    assert.deepEqual(resolveAvailableActions({ role: 'user', text: 'question' }), []);
  });

  test('every action exposes id + label', () => {
    for (const action of resolveAvailableActions({ role: 'assistant', text: 'hi' })) {
      assert.ok(typeof action.id === 'string' && action.id.length);
      assert.ok(typeof action.label === 'string' && action.label.length);
    }
  });
});
