import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupThreadsByDate,
  filterThreadsBySearch,
  GROUP_ORDER,
} from '../../../../shared/chat/sidebar-helpers.js';

const REF = new Date('2026-04-15T12:00:00');

describe('sidebar-helpers — grouping', () => {
  test('GROUP_ORDER lists buckets in display order', () => {
    assert.deepEqual(GROUP_ORDER, ['Today', 'Yesterday', 'Previous 7 days', 'Earlier']);
  });

  test('groups threads into Today / Yesterday / 7-day / Earlier buckets', () => {
    const threads = [
      { id: '1', title: 'today', updatedAt: '2026-04-15T08:00:00' },
      { id: '2', title: 'yest',  updatedAt: '2026-04-14T22:00:00' },
      { id: '3', title: '4d',    updatedAt: '2026-04-11T10:00:00' },
      { id: '4', title: '20d',   updatedAt: '2026-03-26T10:00:00' },
      { id: '5', title: 'no-date' },
    ];
    const grouped = groupThreadsByDate(threads, REF);
    assert.deepEqual(grouped.Today.map((t) => t.id), ['1']);
    assert.deepEqual(grouped.Yesterday.map((t) => t.id), ['2']);
    assert.deepEqual(grouped['Previous 7 days'].map((t) => t.id), ['3']);
    // no-date threads sort into Earlier
    assert.deepEqual(grouped.Earlier.map((t) => t.id).sort(), ['4', '5']);
  });

  test('preserves input order within each bucket', () => {
    const threads = [
      { id: 'a', updatedAt: '2026-04-15T07:00:00' },
      { id: 'b', updatedAt: '2026-04-15T11:00:00' },
      { id: 'c', updatedAt: '2026-04-15T03:00:00' },
    ];
    const grouped = groupThreadsByDate(threads, REF);
    assert.deepEqual(grouped.Today.map((t) => t.id), ['a', 'b', 'c']);
  });

  test('returns empty buckets for missing input', () => {
    const empty = groupThreadsByDate([], REF);
    for (const key of GROUP_ORDER) {
      assert.deepEqual(empty[key], []);
    }
  });
});

describe('sidebar-helpers — search filter', () => {
  const sample = [
    { id: '1', title: 'Protein for hypertrophy', preview: 'How much protein...' },
    { id: '2', title: 'Creatine loading',         preview: 'Worth it?' },
    { id: '3', title: 'Zone 2 cardio',            preview: 'HR target?' },
  ];

  test('case-insensitive title match', () => {
    const out = filterThreadsBySearch(sample, 'PROTEIN');
    assert.deepEqual(out.map((t) => t.id), ['1']);
  });

  test('matches preview text', () => {
    const out = filterThreadsBySearch(sample, 'HR');
    assert.deepEqual(out.map((t) => t.id), ['3']);
  });

  test('empty query → all threads', () => {
    assert.equal(filterThreadsBySearch(sample, '').length, sample.length);
    assert.equal(filterThreadsBySearch(sample, '   ').length, sample.length);
    assert.equal(filterThreadsBySearch(sample, null).length, sample.length);
  });

  test('no matches → empty array', () => {
    assert.deepEqual(filterThreadsBySearch(sample, 'xyz123'), []);
  });
});
