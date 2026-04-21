/* shared/wave/geometry.js
 *
 * Build a non-indexed BufferGeometry of GL_LINES segments — one line
 * per fiber sampled at `points` x-positions, exposed via THREE.LineSegments.
 *
 * Layout: for each fiber f, segment i (0..points-2) contributes two
 * vertices (x0, x1) at y=z=0; the vertex shader displaces them in 3D.
 */

import * as THREE from 'https://esm.sh/three@0.161.0';

export function buildLineGeometry(fiberCount, points, width) {
  const segPerFiber = points - 1;
  const vertCount   = fiberCount * segPerFiber * 2;
  const positions   = new Float32Array(vertCount * 3);
  const aFiber      = new Float32Array(vertCount);

  let w = 0;
  for (let f = 0; f < fiberCount; f += 1) {
    for (let i = 0; i < segPerFiber; i += 1) {
      const x0 = -width * 0.5 + (width * i)       / (points - 1);
      const x1 = -width * 0.5 + (width * (i + 1)) / (points - 1);
      positions[w * 3] = x0; aFiber[w] = f; w += 1;
      positions[w * 3] = x1; aFiber[w] = f; w += 1;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('aFiber',   new THREE.BufferAttribute(aFiber, 1));
  return g;
}
