import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sphereTargets, icosaTargets, dodecaTargets, cubeTargets,
  octaTargets, tetraTargets, pyramidTargets, buckyTargets,
} from '../../../../shared/emersus-orb/shapes.js';

const N = 260;

function assertValidTargets(targets, name, expectedMaxCoord = 200) {
  assert.equal(targets.length, N, `${name} length`);
  for (const p of targets) {
    assert.equal(p.length, 3, `${name} is 3D`);
    for (let i = 0; i < 3; i++) {
      assert(Number.isFinite(p[i]), `${name} has no NaN/Infinity`);
      assert(Math.abs(p[i]) < expectedMaxCoord, `${name} coord in range: ${p[i]}`);
    }
  }
}

describe('emersus-orb/shapes.js — polyhedra', () => {
  test('sphereTargets returns 260 bounded 3D points', () => {
    assertValidTargets(sphereTargets(N), 'sphere');
  });
  test('icosaTargets returns 260 bounded 3D points', () => {
    assertValidTargets(icosaTargets(N), 'icosa');
  });
  test('dodecaTargets returns 260 bounded 3D points', () => {
    assertValidTargets(dodecaTargets(N), 'dodeca');
  });
  test('cubeTargets returns 260 bounded 3D points', () => {
    assertValidTargets(cubeTargets(N), 'cube');
  });
  test('octaTargets returns 260 bounded 3D points', () => {
    assertValidTargets(octaTargets(N), 'octa');
  });
  test('tetraTargets returns 260 bounded 3D points', () => {
    assertValidTargets(tetraTargets(N), 'tetra');
  });
  test('pyramidTargets returns 260 bounded 3D points', () => {
    assertValidTargets(pyramidTargets(N), 'pyramid');
  });
  test('buckyTargets returns 260 bounded 3D points', () => {
    assertValidTargets(buckyTargets(N), 'bucky');
  });
  test('sphere points sit on a ~unit-ish shell', () => {
    const pts = sphereTargets(N);
    for (const p of pts) {
      const r = Math.hypot(...p);
      assert(r > 100 && r < 140, `sphere radius in band: ${r}`);
    }
  });
  test('icosa is seed-stable for edge particles (only vertex wobble is random)', () => {
    assert.equal(icosaTargets(N).length, N);
  });
});
