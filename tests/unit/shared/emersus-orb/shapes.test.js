import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sphereTargets, icosaTargets, dodecaTargets, cubeTargets,
  octaTargets, tetraTargets, pyramidTargets, buckyTargets,
} from '../../../../shared/emersus-orb/shapes.js';
import {
  torusTargets, trefoilTargets, torusKnotTargets, mobiusTargets,
  kleinTargets, linkedCirclesTargets, supertoroidTargets,
  catenoidTargets, helicoidTargets,
} from '../../../../shared/emersus-orb/shapes.js';
import { lorenzTargets, rosslerTargets, thomasTargets, halvorsenTargets } from '../../../../shared/emersus-orb/shapes.js';
import {
  dnaTargets, moleculeTargets, seashellTargets, heartTargets,
  sunflowerTargets, galaxyTargets, saturnTargets,
  vivianiTargets, lissajous3DTargets, infinityTargets,
  SHAPE_SPIN, SHAPE_NAMES,
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

describe('emersus-orb/shapes.js — topology + surfaces', () => {
  test('torus', () => assertValidTargets(torusTargets(N), 'torus'));
  test('trefoil', () => assertValidTargets(trefoilTargets(N), 'trefoil', 180));
  test('torusKnot', () => assertValidTargets(torusKnotTargets(N), 'torusKnot'));
  test('möbius', () => assertValidTargets(mobiusTargets(N), 'mobius'));
  test('klein', () => assertValidTargets(kleinTargets(N), 'klein'));
  test('linkedCircles', () => assertValidTargets(linkedCirclesTargets(N), 'linked'));
  test('supertoroid', () => assertValidTargets(supertoroidTargets(N), 'supertoroid'));
  test('catenoid', () => assertValidTargets(catenoidTargets(N), 'catenoid', 300));
  test('helicoid', () => assertValidTargets(helicoidTargets(N), 'helicoid'));
});

describe('emersus-orb/shapes.js — chaos attractors', () => {
  test('lorenz', () => assertValidTargets(lorenzTargets(N), 'lorenz'));
  test('rossler', () => assertValidTargets(rosslerTargets(N), 'rossler'));
  test('thomas', () => assertValidTargets(thomasTargets(N), 'thomas'));
  test('halvorsen', () => assertValidTargets(halvorsenTargets(N), 'halvorsen'));
});

describe('emersus-orb/shapes.js — bio / cosmic / curves', () => {
  test('dna', () => assertValidTargets(dnaTargets(N), 'dna'));
  test('molecule', () => assertValidTargets(moleculeTargets(N), 'molecule'));
  test('seashell', () => assertValidTargets(seashellTargets(N), 'seashell', 250));
  test('heart', () => assertValidTargets(heartTargets(N), 'heart', 250));
  test('sunflower', () => assertValidTargets(sunflowerTargets(N), 'sunflower'));
  test('galaxy', () => assertValidTargets(galaxyTargets(N), 'galaxy'));
  test('saturn', () => assertValidTargets(saturnTargets(N), 'saturn'));
  test('viviani', () => assertValidTargets(vivianiTargets(N), 'viviani'));
  test('lissajous', () => assertValidTargets(lissajous3DTargets(N), 'lissajous'));
  test('infinity', () => assertValidTargets(infinityTargets(N), 'infinity'));
});

describe('emersus-orb/shapes.js — SHAPE_SPIN + SHAPE_NAMES', () => {
  test('SHAPE_NAMES has 31 entries', () => {
    assert.equal(SHAPE_NAMES.length, 31);
  });
  test('every name has a SHAPE_SPIN entry with a unit axis + positive speed', () => {
    for (const name of SHAPE_NAMES) {
      const spin = SHAPE_SPIN[name];
      assert.ok(spin, `missing spin for ${name}`);
      const axisLen = Math.hypot(spin.axis[0], spin.axis[1], spin.axis[2]);
      assert(Math.abs(axisLen - 1) < 1e-6, `${name} axis must be unit length`);
      assert(spin.speed > 0, `${name} speed must be positive`);
    }
  });
});
