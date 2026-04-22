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
