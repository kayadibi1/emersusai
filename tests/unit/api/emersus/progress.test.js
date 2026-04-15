import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeStreak } from '../../../../api/emersus/progress.js';

describe('progress — computeStreak', () => {
  const NOW = new Date('2026-04-15T12:00:00');

  test('empty input → all zeros', () => {
    const s = computeStreak([], NOW);
    assert.equal(s.current, 0);
    assert.equal(s.longest_all_time.days, 0);
    assert.equal(s.total_active_2026, 0);
  });

  test('today + yesterday → current=2', () => {
    const s = computeStreak(['2026-04-15', '2026-04-14'], NOW);
    assert.equal(s.current, 2);
  });

  test('only yesterday is OK (current=1)', () => {
    const s = computeStreak(['2026-04-14'], NOW);
    assert.equal(s.current, 1);
  });

  test('finds longest historical streak', () => {
    const s = computeStreak([
      '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05',
      '2026-04-15',
    ], NOW);
    assert.equal(s.longest_all_time.days, 5);
    assert.equal(s.longest_all_time.start_date, '2026-01-01');
    assert.equal(s.longest_all_time.end_date, '2026-01-05');
  });

  test('counts yearly + monthly active days', () => {
    const s = computeStreak([
      '2026-04-01', '2026-04-05', '2026-04-10', '2026-04-15',
      '2026-03-30', // March, ignored for this_month
    ], NOW);
    assert.equal(s.total_active_2026, 5);
    assert.equal(s.this_month.active, 4);
    assert.equal(s.this_month.total, 30);
  });
});
