import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computePaceZone, computeWhyInsight } from '../../../../api/emersus/nutrition-day.js';

describe('nutrition-day — computePaceZone', () => {
  test('returns {0,0} when target missing', () => {
    assert.deepEqual(computePaceZone({ targetKcal: 0 }), { start: 0, end: 0 });
  });

  test('mid-day returns ~50% with ±8% band', () => {
    const noon = new Date('2026-04-15T14:30:00Z');
    // Eating window is 7am-10pm = 15h. 14:30 = 7.5h elapsed = 50%.
    const z = computePaceZone({ targetKcal: 2200, now: noon });
    assert.ok(z.start > 0.40 && z.start < 0.45);
    assert.ok(z.end > 0.55 && z.end < 0.60);
  });

  test('start of window returns ~0', () => {
    const morning = new Date('2026-04-15T07:00:00Z');
    const z = computePaceZone({ targetKcal: 2200, now: morning });
    assert.equal(z.start, 0);
    assert.ok(z.end > 0 && z.end < 0.1);
  });

  test('end of window returns ~1', () => {
    const evening = new Date('2026-04-15T22:00:00Z');
    const z = computePaceZone({ targetKcal: 2200, now: evening });
    assert.ok(z.start > 0.9);
    assert.equal(z.end, 1);
  });

  test('custom eating window shifts pace zone', () => {
    const noon = new Date('2026-04-15T14:30:00Z');
    // IF eating window = 12pm-8pm = 8h. 14:30 = 2.5h elapsed = 31.25%.
    const z = computePaceZone({
      targetKcal: 2200,
      eatingWindow: { start: 12, end: 20 },
      now: noon,
    });
    assert.ok(z.start > 0.22 && z.start < 0.33, `start=${z.start}`);
    assert.ok(z.end > 0.33 && z.end < 0.42, `end=${z.end}`);
  });

  test('before custom window start returns 0', () => {
    const earlyMorning = new Date('2026-04-15T10:00:00Z');
    const z = computePaceZone({
      targetKcal: 2200,
      eatingWindow: { start: 12, end: 20 },
      now: earlyMorning,
    });
    assert.equal(z.start, 0);
    assert.ok(z.end < 0.1);
  });
});

describe('nutrition-day — computeWhyInsight', () => {
  test('empty target yields empty string', () => {
    assert.equal(computeWhyInsight({ meals: [], target: {}, consumed: {} }), '');
  });

  test('on-pace returns the on-pace message', () => {
    const out = computeWhyInsight({
      meals: [],
      target: { kcal: 2000 },
      consumed: { kcal: 950 },
    });
    assert.match(out, /on pace/i);
  });

  test('ahead-of-pace cites the biggest meal when present', () => {
    const out = computeWhyInsight({
      meals: [
        { eaten_at: '2026-04-15T08:00', kcal: 340, type: 'breakfast', name: 'Oats' },
        { eaten_at: '2026-04-15T13:00', kcal: 680, type: 'lunch', name: 'Rice bowl' },
      ],
      target: { kcal: 2000 },
      consumed: { kcal: 1500 },
    });
    assert.match(out, /Rice bowl/);
    assert.match(out, /680 kcal/);
  });

  test('behind-pace with no meals reports kcal-behind', () => {
    const out = computeWhyInsight({
      meals: [],
      target: { kcal: 2000 },
      consumed: { kcal: 200 },
    });
    assert.match(out, /behind pace/);
  });

  test('behind-pace WITH a meal shows remaining-kcal phrasing', () => {
    const out = computeWhyInsight({
      meals: [{ eaten_at: '2026-04-15T08:00', kcal: 200, type: 'breakfast', name: 'Toast' }],
      target: { kcal: 2000 },
      consumed: { kcal: 200 },
    });
    assert.match(out, /\d+ more/);
  });
});
