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
    // Independent per-axis jitter — avoids the diagonal-streak cloud.
    const jx = (Math.random()-0.5) * 5;
    const jy = (Math.random()-0.5) * 5;
    const jz = (Math.random()-0.5) * 5;
    out.push([x + jx, z + jy, y + jz]); // swap to make Y vertical
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

function scaleCenter(pts, N, target) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (const p of pts) {
    if(p[0]<minX)minX=p[0]; if(p[0]>maxX)maxX=p[0];
    if(p[1]<minY)minY=p[1]; if(p[1]>maxY)maxY=p[1];
    if(p[2]<minZ)minZ=p[2]; if(p[2]>maxZ)maxZ=p[2];
  }
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2, cz=(minZ+maxZ)/2;
  const spread = Math.max(maxX-minX, maxY-minY, maxZ-minZ) || 1;
  const scale = target / spread;
  const out = [];
  for (let i = 0; i < N; i++) {
    const p = pts[i % pts.length];
    out.push([(p[0]-cx)*scale, (p[1]-cy)*scale, (p[2]-cz)*scale]);
  }
  return out;
}

export function lorenzTargets(N) {
  const sigma = 10, rho = 28, beta = 8/3;
  let x = 0.1, y = 0, z = 0;
  const dt = 0.005;
  for (let i = 0; i < 400; i++) {
    x += sigma*(y-x) * dt;
    y += (x*(rho-z) - y) * dt;
    z += (x*y - beta*z) * dt;
  }
  const pts = [];
  const steps = N * 6;
  for (let i = 0; i < steps; i++) {
    const dx = sigma*(y-x), dy = x*(rho-z) - y, dz = x*y - beta*z;
    x += dx*dt; y += dy*dt; z += dz*dt;
    if (i % 6 === 0) pts.push([x, y - 25, z]);
  }
  return scaleCenter(pts, N, 180);
}

export function rosslerTargets(N) {
  const a = 0.2, b = 0.2, c = 5.7;
  let x = 1, y = 1, z = 1;
  const dt = 0.02;
  for (let i = 0; i < 500; i++) {
    x += (-y - z) * dt;
    y += (x + a*y) * dt;
    z += (b + z*(x - c)) * dt;
  }
  const pts = [];
  const steps = N * 4;
  for (let i = 0; i < steps; i++) {
    const dx = -y - z, dy = x + a*y, dz = b + z*(x - c);
    x += dx*dt; y += dy*dt; z += dz*dt;
    if (i % 4 === 0) pts.push([x, y, z]);
  }
  return scaleCenter(pts, N, 180);
}

export function thomasTargets(N) {
  const b = 0.19;
  let x = 0.5, y = 0.5, z = 0.5;
  const dt = 0.08;
  for (let i = 0; i < 400; i++) {
    x += (Math.sin(y) - b*x) * dt;
    y += (Math.sin(z) - b*y) * dt;
    z += (Math.sin(x) - b*z) * dt;
  }
  const pts = [];
  const steps = N * 3;
  for (let i = 0; i < steps; i++) {
    const dx = Math.sin(y) - b*x, dy = Math.sin(z) - b*y, dz = Math.sin(x) - b*z;
    x += dx*dt; y += dy*dt; z += dz*dt;
    if (i % 3 === 0) pts.push([x, y, z]);
  }
  return scaleCenter(pts, N, 180);
}

export function halvorsenTargets(N) {
  const a = 1.89;
  let x = -1.48, y = -1.51, z = 2.04;
  const dt = 0.008;
  for (let i = 0; i < 400; i++) {
    x += (-a*x - 4*y - 4*z - y*y) * dt;
    y += (-a*y - 4*z - 4*x - z*z) * dt;
    z += (-a*z - 4*x - 4*y - x*x) * dt;
  }
  const pts = [];
  const steps = N * 4;
  for (let i = 0; i < steps; i++) {
    const dx = -a*x - 4*y - 4*z - y*y;
    const dy = -a*y - 4*z - 4*x - z*z;
    const dz = -a*z - 4*x - 4*y - x*x;
    x += dx*dt; y += dy*dt; z += dz*dt;
    if (i % 4 === 0) pts.push([x, y, z]);
  }
  return scaleCenter(pts, N, 180);
}

// ── Bio / Cosmic / Curves ────────────────────────────────────────────────────

export function dnaTargets(N) {
  const out = [];
  const turns = 2.2, height = 240, rHelix = 52;
  const nStrand = Math.floor(N * 0.38);
  const rungSlots = N - nStrand * 2;
  const rungsPerRung = 4;
  const nDistinctRungs = Math.max(1, Math.floor(rungSlots / rungsPerRung));
  const j = () => (Math.random()-0.5)*3;
  // strand 1
  for (let i = 0; i < nStrand; i++) {
    const u = i / (nStrand - 1);
    const t = u * turns * Math.PI * 2;
    const y = -height/2 + u * height;
    out.push([rHelix*Math.cos(t)+j(), y+j(), rHelix*Math.sin(t)+j()]);
  }
  // strand 2 (180° offset)
  for (let i = 0; i < nStrand; i++) {
    const u = i / (nStrand - 1);
    const t = u * turns * Math.PI * 2;
    const y = -height/2 + u * height;
    out.push([rHelix*Math.cos(t+Math.PI)+j(), y+j(), rHelix*Math.sin(t+Math.PI)+j()]);
  }
  // base-pair rungs
  let rp = 0;
  for (let r = 0; r < nDistinctRungs && rp < rungSlots; r++) {
    const u = (r + 0.5) / nDistinctRungs;
    const t = u * turns * Math.PI * 2;
    const y = -height/2 + u * height;
    const x1 = rHelix*Math.cos(t), z1 = rHelix*Math.sin(t);
    const x2 = rHelix*Math.cos(t+Math.PI), z2 = rHelix*Math.sin(t+Math.PI);
    for (let k = 0; k < rungsPerRung && rp < rungSlots; k++, rp++) {
      const f = (k + 1) / (rungsPerRung + 1);
      out.push([lerp(x1,x2,f)+j(), y+j(), lerp(z1,z2,f)+j()]);
    }
  }
  while (out.length < N) {
    const u = Math.random();
    const t = u * turns * Math.PI * 2;
    const y = -height/2 + u * height;
    out.push([rHelix*Math.cos(t), y, rHelix*Math.sin(t)]);
  }
  return out.slice(0, N);
}

export function moleculeTargets(N) {
  const out = [];
  const centers = [[0,0,0],[80,60,0],[-80,60,0],[0,-80,60],[0,-30,-90]];
  for (let i = 0; i < N; i++) {
    const c = centers[i % centers.length];
    const phi = Math.acos(2*Math.random()-1);
    const theta = Math.random() * Math.PI * 2;
    const r = (i % centers.length === 0) ? 22 : 16;
    out.push([c[0]+r*Math.sin(phi)*Math.cos(theta), c[1]+r*Math.cos(phi), c[2]+r*Math.sin(phi)*Math.sin(theta)]);
  }
  return out;
}

export function seashellTargets(N) {
  const out = [], a = 2, b = 0.12;
  for (let i = 0; i < N; i++) {
    const t = Math.random() * 6 * Math.PI;
    const r = a * Math.exp(b * t);
    const v = Math.random() * Math.PI * 2;
    const tubeR = r * 0.4;
    out.push([
      r * Math.cos(t) + tubeR * Math.cos(v),
      -t * 3.5 + tubeR * Math.sin(v) * 0.5 + 50,
      r * Math.sin(t) + tubeR * Math.cos(v),
    ]);
  }
  return scaleCenter(out, N, 200);
}

export function heartTargets(N) {
  const out = [], s = 6;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const hx = s * 16 * Math.pow(Math.sin(t), 3);
    const hy = -s * (13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t));
    const thickness = 28 * (1 - Math.cos(2*t) * 0.5);
    const z = (Math.random()*2 - 1) * thickness * Math.random();
    out.push([hx + (Math.random()-0.5)*4, hy + (Math.random()-0.5)*4, z]);
  }
  return out;
}

export function sunflowerTargets(N) {
  const out = [], goldenAngle = Math.PI * (3 - Math.sqrt(5)), maxR = 110;
  for (let i = 0; i < N; i++) {
    const t = i * goldenAngle;
    const rNorm = Math.sqrt(i / N);
    const r = rNorm * maxR;
    const y = (1 - rNorm * rNorm) * 60 - 20;
    out.push([r * Math.cos(t), y, r * Math.sin(t)]);
  }
  return out;
}

export function galaxyTargets(N) {
  const out = [], arms = 2, a = 8, b = 0.22;
  for (let i = 0; i < N; i++) {
    const arm = i % arms;
    const t = (i / N) * Math.PI * 5 + (arm * Math.PI);
    const r = a * Math.exp(b * t);
    const perpR = (Math.random() - 0.5) * r * 0.2;
    const thickness = (Math.random() - 0.5) * Math.max(6, r * 0.04);
    out.push([
      Math.cos(t) * r + perpR * Math.sin(t),
      thickness,
      Math.sin(t) * r - perpR * Math.cos(t),
    ]);
  }
  let maxR = 0; for (const p of out) maxR = Math.max(maxR, Math.hypot(p[0], p[2]));
  const scale = 140 / (maxR || 1);
  return out.map(p => [p[0]*scale, p[1]*scale, p[2]*scale]);
}

export function saturnTargets(N) {
  const out = [];
  const nSphere = Math.floor(N * 0.35);
  const nRing = N - nSphere;
  const Rs = 55, ri = 75, ro = 130, rh = 3;
  for (let i = 0; i < nSphere; i++) {
    const phi = Math.acos(2*Math.random()-1);
    const theta = Math.random() * Math.PI * 2;
    const r = Rs + (Math.random()-0.5) * 6;
    out.push([r*Math.sin(phi)*Math.cos(theta), r*Math.cos(phi), r*Math.sin(phi)*Math.sin(theta)]);
  }
  for (let i = 0; i < nRing; i++) {
    const theta = Math.random() * Math.PI * 2;
    const r = ri + Math.random() * (ro - ri);
    const y = (Math.random()-0.5) * rh;
    out.push([r*Math.cos(theta), y, r*Math.sin(theta)]);
  }
  return out;
}

export function vivianiTargets(N) {
  const out = [], a = 60;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * 4 * Math.PI;
    out.push([a * (1 + Math.cos(t)) - a, a * Math.sin(t), 2 * a * Math.sin(t/2)]);
  }
  return out;
}

export function lissajous3DTargets(N) {
  const out = [], A = 100, B = 100, C = 100, a = 3, b = 2, c = 5;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    out.push([A * Math.sin(a*t), B * Math.sin(b*t + Math.PI/4), C * Math.sin(c*t)]);
  }
  return out;
}

export function infinityTargets(N) {
  const out = [], a = 120;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const denom = 1 + Math.sin(t) * Math.sin(t);
    out.push([
      a * Math.cos(t) / denom,
      (Math.random()-0.5) * 14,
      a * Math.sin(t) * Math.cos(t) / denom,
    ]);
  }
  return out;
}

// ── Export tables ────────────────────────────────────────────────────────────

function normalize3(x, y, z) { const len = Math.hypot(x, y, z) || 1; return [x/len, y/len, z/len]; }

export const SHAPE_SPIN = Object.freeze({
  sphere:     { axis: normalize3(0.35, 1.0, 0.2),  speed: 0.35 },
  torus:      { axis: normalize3(0.3,  0.5, 1.0),  speed: 0.50 },
  helix:      { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.80 },
  molecule:   { axis: normalize3(0.7,  0.5, 0.4),  speed: 0.40 },
  icosa:      { axis: normalize3(0.4,  0.7, 0.6),  speed: 0.45 },
  trefoil:    { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.55 },
  lorenz:     { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.30 },
  galaxy:     { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.25 },
  mobius:     { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.50 },
  klein:      { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.35 },
  dodeca:     { axis: normalize3(0.4,  0.6, 0.7),  speed: 0.40 },
  rossler:    { axis: normalize3(0.0,  0.0, 1.0),  speed: 0.30 },
  saturn:     { axis: normalize3(0.15, 1.0, 0.1),  speed: 0.32 },
  helicoid:   { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.45 },
  torusKnot:  { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.45 },
  sunflower:  { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.25 },
  octa:       { axis: normalize3(0.4,  0.7, 0.6),  speed: 0.45 },
  tetra:      { axis: normalize3(1.0,  1.0, 0.5),  speed: 0.50 },
  cube:       { axis: normalize3(0.4,  0.7, 0.5),  speed: 0.38 },
  bucky:      { axis: normalize3(0.2,  1.0, 0.3),  speed: 0.32 },
  viviani:    { axis: normalize3(0.0,  0.0, 1.0),  speed: 0.50 },
  thomas:     { axis: normalize3(0.5,  0.5, 0.5),  speed: 0.35 },
  halvorsen:  { axis: normalize3(0.3,  0.7, 0.6),  speed: 0.40 },
  seashell:   { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.45 },
  heart:      { axis: normalize3(0.0,  1.0, 0.1),  speed: 0.30 },
  supertoroid:{ axis: normalize3(0.2,  0.5, 1.0),  speed: 0.40 },
  lissajous:  { axis: normalize3(0.5,  0.7, 0.3),  speed: 0.40 },
  infinity:   { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.40 },
  catenoid:   { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.35 },
  linked:     { axis: normalize3(1.0,  1.0, 0.0),  speed: 0.40 },
  pyramid:    { axis: normalize3(0.0,  1.0, 0.0),  speed: 0.40 },
});

export const SHAPE_NAMES = Object.freeze(Object.keys(SHAPE_SPIN));

export const SHAPE_GENERATORS = Object.freeze({
  sphere: sphereTargets, torus: torusTargets, helix: dnaTargets, molecule: moleculeTargets,
  icosa: icosaTargets, trefoil: trefoilTargets, lorenz: lorenzTargets, galaxy: galaxyTargets,
  mobius: mobiusTargets, klein: kleinTargets, dodeca: dodecaTargets, rossler: rosslerTargets,
  saturn: saturnTargets, helicoid: helicoidTargets, torusKnot: torusKnotTargets, sunflower: sunflowerTargets,
  octa: octaTargets, tetra: tetraTargets, cube: cubeTargets, bucky: buckyTargets,
  viviani: vivianiTargets, thomas: thomasTargets, halvorsen: halvorsenTargets,
  seashell: seashellTargets, heart: heartTargets, supertoroid: supertoroidTargets,
  lissajous: lissajous3DTargets, infinity: infinityTargets, catenoid: catenoidTargets,
  linked: linkedCirclesTargets, pyramid: pyramidTargets,
});
