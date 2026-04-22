// shared/emersus-orb/shapes.js
// 3D shape target generators. Each function accepts N (particle count) and
// returns exactly N `[x, y, z]` points. Randomness is per-call (not seeded):
// the orb re-runs generators on shape change to get fresh jitter.

function lerp(a, b, t) { return a + (b - a) * t; }

// Internal: place particles on a polyhedron's vertices + edges.
function polyVerticesEdges(V, expectedEdge, N) {
  const E = [];
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
    const d = Math.hypot(V[i][0]-V[j][0], V[i][1]-V[j][1], V[i][2]-V[j][2]);
    if (Math.abs(d - expectedEdge) < 0.01) E.push([i, j]);
  }
  const out = [];
  const vertexPts = Math.min(Math.floor(N / 2), V.length * 3);
  for (let i = 0; i < vertexPts; i++) {
    const v = V[i % V.length];
    const j = (Math.random()-0.5)*4;
    out.push([v[0]+j, v[1]+j, v[2]+j]);
  }
  const edgePtsTotal = N - vertexPts;
  const perEdge = Math.ceil(edgePtsTotal / Math.max(E.length, 1));
  let count = 0;
  for (const [a, b] of E) {
    for (let k = 0; k < perEdge && count < edgePtsTotal; k++, count++) {
      const t = (k + 0.5) / perEdge;
      const j = (Math.random()-0.5)*3;
      out.push([lerp(V[a][0], V[b][0], t)+j, lerp(V[a][1], V[b][1], t)+j, lerp(V[a][2], V[b][2], t)+j]);
    }
  }
  while (out.length < N) out.push(V[(Math.random()*V.length)|0].slice());
  return out.slice(0, N);
}

export function sphereTargets(N) {
  const out = [];
  for (let i = 0; i < N; i++) {
    const phi = Math.acos(2*Math.random()-1);
    const theta = Math.random() * Math.PI * 2;
    const r = 120 + (Math.random()-0.5)*8;
    out.push([
      r*Math.sin(phi)*Math.cos(theta),
      r*Math.cos(phi),
      r*Math.sin(phi)*Math.sin(theta),
    ]);
  }
  return out;
}

export function icosaTargets(N) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const scale = 80;
  const V = [
    [-1, phi, 0],[1, phi, 0],[-1,-phi, 0],[1,-phi, 0],
    [0,-1, phi],[0, 1, phi],[0,-1,-phi],[0, 1,-phi],
    [phi, 0,-1],[phi, 0, 1],[-phi, 0,-1],[-phi, 0, 1],
  ].map(v => [v[0]*scale, v[1]*scale, v[2]*scale]);
  return polyVerticesEdges(V, 2 * scale, N);
}

export function dodecaTargets(N) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const ip = 1 / phi;
  const s = 65;
  const V = [
    [ 1, 1, 1],[ 1, 1,-1],[ 1,-1, 1],[ 1,-1,-1],
    [-1, 1, 1],[-1, 1,-1],[-1,-1, 1],[-1,-1,-1],
    [0, ip, phi],[0, ip,-phi],[0,-ip, phi],[0,-ip,-phi],
    [ip, phi, 0],[ip,-phi, 0],[-ip, phi, 0],[-ip,-phi, 0],
    [phi, 0, ip],[phi, 0,-ip],[-phi, 0, ip],[-phi, 0,-ip],
  ].map(v => [v[0]*s, v[1]*s, v[2]*s]);
  return polyVerticesEdges(V, 2 * ip * s, N);
}

export function cubeTargets(N) {
  const s = 75;
  const V = [[s,s,s],[s,s,-s],[s,-s,s],[s,-s,-s],[-s,s,s],[-s,s,-s],[-s,-s,s],[-s,-s,-s]];
  return polyVerticesEdges(V, 2 * s, N);
}

export function octaTargets(N) {
  const s = 90;
  const V = [[s,0,0],[-s,0,0],[0,s,0],[0,-s,0],[0,0,s],[0,0,-s]];
  return polyVerticesEdges(V, s * Math.SQRT2, N);
}

export function tetraTargets(N) {
  const s = 80;
  const V = [[s,s,s],[s,-s,-s],[-s,s,-s],[-s,-s,s]];
  return polyVerticesEdges(V, Math.hypot(2*s, 2*s, 0), N);
}

export function pyramidTargets(N) {
  const s = 75;
  const V = [[s,-s,s],[s,-s,-s],[-s,-s,s],[-s,-s,-s],[0, s, 0]];
  return polyVerticesEdges(V, 2 * s, N);
}

export function buckyTargets(N) {
  // Fibonacci sphere — even distribution that reads as a soccer-ball-ish cloud.
  const out = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const R = 105;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = i * goldenAngle;
    out.push([radius * Math.cos(theta) * R, y * R, radius * Math.sin(theta) * R]);
  }
  return out;
}
