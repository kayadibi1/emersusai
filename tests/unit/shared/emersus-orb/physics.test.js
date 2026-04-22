import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { greedyNearestAssign } from '../../../../shared/emersus-orb/physics.js';

describe('emersus-orb/physics.js — greedyNearestAssign', () => {
  test('assigns same-position particles to their original targets', () => {
    const starts  = [[0,0,0], [10,0,0], [20,0,0]];
    const targets = [[0,0,0], [10,0,0], [20,0,0]];
    const assignment = greedyNearestAssign(starts, targets, () => 0);
    assert.deepEqual(assignment, [[0,0,0], [10,0,0], [20,0,0]]);
  });

  test('permuted targets get reassigned to nearest', () => {
    const starts  = [[0,0,0], [10,0,0], [20,0,0]];
    const targets = [[20,0,0], [0,0,0], [10,0,0]]; // shuffled
    const assignment = greedyNearestAssign(starts, targets, () => 0);
    assert.deepEqual(assignment[0], [0,0,0]);
    assert.deepEqual(assignment[1], [10,0,0]);
    assert.deepEqual(assignment[2], [20,0,0]);
  });

  test('returns exactly N results, none repeated', () => {
    const N = 30;
    const starts = Array.from({length: N}, (_, i) => [i, 0, 0]);
    const targets = Array.from({length: N}, (_, i) => [N - i, 0, 0]);
    const assignment = greedyNearestAssign(starts, targets, () => 0);
    assert.equal(assignment.length, N);
    const used = new Set(assignment.map(p => p.join(',')));
    assert.equal(used.size, N);
  });
});
