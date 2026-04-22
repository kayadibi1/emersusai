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
    // isotropic jitter — independent per axis so clouds don't streak along (1,1,1)
    out.push([
      v[0] + (Math.random()-0.5)*4,
      v[1] + (Math.random()-0.5)*4,
      v[2] + (Math.random()-0.5)*4,
    ]);
  }
  const edgePtsTotal = N - vertexPts;
  const perEdge = Math.ceil(edgePtsTotal / Math.max(E.length, 1));
  let count = 0;
  for (const [a, b] of E) {
    for (let k = 0; k < perEdge && count < edgePtsTotal; k++, count++) {
      const t = (k + 0.5) / perEdge;
      out.push([
        lerp(V[a][0], V[b][0], t) + (Math.random()-0.5)*3,
        lerp(V[a][1], V[b][1], t) + (Math.random()-0.5)*3,
        lerp(V[a][2], V[b][2], t) + (Math.random()-0.5)*3,
      ]);
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
  const denom = Math.max(N - 1, 1); // guard N ≤ 1
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / denom) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * goldenAngle;
    out.push([radius * Math.cos(theta) * R, y * R, radius * Math.sin(theta) * R]);
  }
  return out;
}

export function torusTargets(N) {
  const out = []; const R = 105, r = 28;
  for (let i = 0; i < N; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = Math.random() * Math.PI * 2;
    out.push([(R + r*Math.cos(v))*Math.cos(u), r*Math.sin(v), (R + r*Math.cos(v))*Math.sin(u)]);
  }
  return out;
}

export function trefoilTargets(N) {
  const out = [], scale = 32;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const x = scale * (Math.sin(t) + 2 * Math.sin(2 * t));
    const y = scale * (Math.cos(t) - 2 * Math.cos(2 * t));
    const z = scale * (-Math.sin(3 * t));
    const j = () => (Math.random()-0.5)*4;
    out.push([x + j(), y + j(), z + j()]);
  }
  return out;
}

export function torusKnotTargets(N) {
  const out = [], p = 3, q = 2, R = 60, r = 22;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const radial = R + r * Math.cos(q * t);
    const x = radial * Math.cos(p * t);
    const y = radial * Math.sin(p * t);
    const z = r * Math.sin(q * t) * 1.5;
    const j = (Math.random()-0.5) * 5;
    out.push([x + j, z + j, y + j]); // swap to make Y vertical
  }
  return out;
}

export function mobiusTargets(N) {
  const out = [], R = 75, W = 60;
  for (let i = 0; i < N; i++) {
    const v = Math.random() * Math.PI * 2;
    const u = (Math.random() - 0.5) * 2 * W;
    out.push([
      (R + u * Math.cos(v / 2)) * Math.cos(v),
      u * Math.sin(v / 2),
      (R + u * Math.cos(v / 2)) * Math.sin(v),
    ]);
  }
  return out;
}

export function kleinTargets(N) {
  const out = [], R = 60, r = 28;
  for (let i = 0; i < N; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = Math.random() * Math.PI * 2;
    const hv = v / 2;
    const radial = R + r * Math.cos(hv) * Math.sin(u) - r * Math.sin(hv) * Math.sin(2 * u);
    out.push([
      radial * Math.cos(v),
      r * Math.sin(hv) * Math.sin(u) + r * Math.cos(hv) * Math.sin(2 * u),
      radial * Math.sin(v),
    ]);
  }
  return out;
}

export function linkedCirclesTargets(N) {
  const out = [], R = 75;
  for (let i = 0; i < N; i++) {
    const ring = i % 2;
    const t = Math.random() * Math.PI * 2;
    const thick = (Math.random()-0.5) * 8;
    if (ring === 0) out.push([(R + thick) * Math.cos(t), thick * 0.3, (R + thick) * Math.sin(t)]);
    else            out.push([R + thick * 0.3, (R + thick) * Math.cos(t), (R + thick) * Math.sin(t)]);
  }
  return out;
}

export function supertoroidTargets(N) {
  const out = [], R = 90, r = 28, e = 0.5;
  const sign = x => x < 0 ? -1 : 1;
  const p = (a, e) => sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), e);
  const q = (a, e) => sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), e);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = Math.random() * Math.PI * 2;
    const radial = R + r * p(v, e);
    out.push([radial * p(u, e), r * q(v, e), radial * q(u, e)]);
  }
  return out;
}

export function catenoidTargets(N) {
  const out = [], a = 35, height = 180;
  for (let i = 0; i < N; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = (Math.random() - 0.5) * height / 2;
    const r = a * Math.cosh(v / a);
    out.push([r * Math.cos(u), v * 2, r * Math.sin(u)]);
  }
  return out;
}

export function helicoidTargets(N) {
  const out = [], turns = 3, pitch = 28, maxR = 75;
  for (let i = 0; i < N; i++) {
    const v = Math.random() * turns * Math.PI * 2;
    const u = (Math.random() * 2 - 1) * maxR;
    const x = u * Math.cos(v);
    const y = pitch * (v / (Math.PI * 2)) - (pitch * turns / 2);
    const z = u * Math.sin(v);
    out.push([x, y, z]);
  }
  return out;
}
