import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { greedyNearestAssign } from '../../../../shared/emersus-orb/physics.js';
import { curlAxisForPath, initialTangentVelocity } from '../../../../shared/emersus-orb/physics.js';
import { stepSpring } from '../../../../shared/emersus-orb/physics.js';

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

describe('emersus-orb/physics.js — curl', () => {
  test('curlAxisForPath returns a unit vector perpendicular to the path direction', () => {
    const axis = curlAxisForPath([1, 0, 0], () => 0.1);
    const dir = [1, 0, 0];
    const dot = axis[0]*dir[0] + axis[1]*dir[1] + axis[2]*dir[2];
    assert(Math.abs(dot) < 1e-6, `axis dot dir must be 0, got ${dot}`);
    assert(Math.abs(Math.hypot(...axis) - 1) < 1e-6, 'axis must be unit');
  });

  test('curlAxisForPath degenerate ref falls back to Y then X axis', () => {
    const axis = curlAxisForPath([0, 1, 0], () => 0.5);
    assert(Math.abs(Math.hypot(...axis) - 1) < 1e-6);
  });

  test('initialTangentVelocity scales with distance and curve magnitude', () => {
    const axis = [0, 1, 0];
    const v1 = initialTangentVelocity(axis, 100, 0.1, 1);
    const v2 = initialTangentVelocity(axis, 50, 0.1, 1);
    assert.equal(v1[1], 10);
    assert.equal(v2[1], 5);
  });

  test('sign flips velocity direction', () => {
    const axis = [0, 1, 0];
    const v = initialTangentVelocity(axis, 100, 0.1, -1);
    assert.equal(v[1], -10);
  });
});

describe('emersus-orb/physics.js — stepSpring', () => {
  test('particle at rest moves toward target on first step', () => {
    const p = { x: 0, y: 0, z: 0, tx: 100, ty: 0, tz: 0, vx: 0, vy: 0, vz: 0 };
    stepSpring(p, { spring: 0.1, drag: 0.9 });
    assert(p.x > 0);
    assert(p.vx > 0);
  });

  test('drag dampens velocity over time without new force', () => {
    const p = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, vx: 10, vy: 0, vz: 0 };
    stepSpring(p, { spring: 0, drag: 0.9 });
    assert.equal(Math.abs(p.vx - 9), 0);
  });

  test('high drag + high spring — particle reaches near-target after enough frames', () => {
    const p = { x: 0, y: 0, z: 0, tx: 100, ty: 0, tz: 0, vx: 0, vy: 0, vz: 0 };
    for (let i = 0; i < 200; i++) stepSpring(p, { spring: 0.08, drag: 0.85 });
    assert(Math.abs(p.x - 100) < 1, `x converges: ${p.x}`);
  });
});
