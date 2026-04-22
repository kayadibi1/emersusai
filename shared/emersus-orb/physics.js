// shared/emersus-orb/physics.js
// Pure physics helpers for the orb. No DOM, no WebGL — safe to import in node.

// Greedy nearest-neighbour assignment: each start takes its closest unused
// target. O(N²) — fine for N ≤ ~300. `rng` must be a function returning 0..1;
// defaults to Math.random so callers can inject for determinism in tests.
export function greedyNearestAssign(startPositions, newTargets, rng = Math.random) {
  const N = startPositions.length;
  const used = new Array(N).fill(false);
  const assignment = new Array(N);
  // Shuffle iteration order so no particle has priority bias.
  const order = [];
  for (let i = 0; i < N; i++) order.push(i);
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const i of order) {
    let bestJ = -1, bestD = Infinity;
    const sx = startPositions[i][0], sy = startPositions[i][1], sz = startPositions[i][2];
    for (let j = 0; j < N; j++) {
      if (used[j]) continue;
      const dx = newTargets[j][0] - sx, dy = newTargets[j][1] - sy, dz = newTargets[j][2] - sz;
      const d = dx*dx + dy*dy + dz*dz;
      if (d < bestD) { bestD = d; bestJ = j; }
    }
    assignment[i] = bestJ;
    used[bestJ] = true;
  }
  return assignment.map(j => newTargets[j].slice());
}

function cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}
function normalize3(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  return [x/len, y/len, z/len];
}

// Pick a unit vector perpendicular to `dir` for curved trajectories.
// Uses a random reference axis; falls back to Y and then X if the random
// ref is parallel to dir.
export function curlAxisForPath(dir, rng = Math.random) {
  const [dx, dy, dz] = dir;
  let rax = rng() - 0.5, ray = rng() - 0.5, raz = rng() - 0.5;
  const rlen = Math.hypot(rax, ray, raz) || 1;
  rax /= rlen; ray /= rlen; raz /= rlen;
  let c = cross([dx, dy, dz], [rax, ray, raz]);
  if (Math.hypot(c[0], c[1], c[2]) < 0.1) {
    c = cross([dx, dy, dz], [0, 1, 0]);
    if (Math.hypot(c[0], c[1], c[2]) < 0.1) c = cross([dx, dy, dz], [1, 0, 0]);
  }
  return normalize3(c[0], c[1], c[2]);
}

// Returns an initial velocity vector along `curlAxis` scaled by distance +
// curve knob. `sign` should be ±1; use Math.random() < 0.5 to pick once per
// particle at creation so half the swarm curls each way.
export function initialTangentVelocity(curlAxis, distance, curve, sign) {
  const mag = curve * distance * sign;
  return [curlAxis[0] * mag, curlAxis[1] * mag, curlAxis[2] * mag];
}
