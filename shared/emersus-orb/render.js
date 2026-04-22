// shared/emersus-orb/render.js
// Thin three.js layer. Owns the WebGLRenderer, scene, camera, Points,
// LineSegments, and trail buffers. No physics, no state machine — just draw.

import * as THREE from 'https://esm.sh/three@0.169';

const VERTEX_SHADER = `
  attribute float size;
  attribute float alpha;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.1, r);
    gl_FragColor = vec4(vColor, vAlpha * soft);
  }
`;

export function createRenderer(canvas, { size = 160, particleCount = 260, trailLen = 40 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(size, size, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 1000);
  camera.position.set(0, 0, 500);

  // Points geometry + shader material
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const alphas = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    sizes[i] = 2.0;
    alphas[i] = 0.85;
    colors[i*3] = 0.8; colors[i*3+1] = 0.95; colors[i*3+2] = 0.9;
  }
  const pGeom = new THREE.BufferGeometry();
  pGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  pGeom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  pGeom.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  const pMat = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(pGeom, pMat);
  scene.add(points);

  // Line segments for links (rebuilt each frame)
  const MAX_LINK_SEGMENTS = particleCount * 14;
  const linkPositions = new Float32Array(MAX_LINK_SEGMENTS * 2 * 3);
  const linkColors = new Float32Array(MAX_LINK_SEGMENTS * 2 * 3);
  const linkGeom = new THREE.BufferGeometry();
  linkGeom.setAttribute('position', new THREE.BufferAttribute(linkPositions, 3));
  linkGeom.setAttribute('color', new THREE.BufferAttribute(linkColors, 3));
  linkGeom.setDrawRange(0, 0);
  const linkMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 });
  const links = new THREE.LineSegments(linkGeom, linkMat);
  scene.add(links);

  // Trail segments — TRAIL_LEN-1 segments per particle
  const trailPositions = new Float32Array(particleCount * (trailLen - 1) * 2 * 3);
  const trailColors    = new Float32Array(particleCount * (trailLen - 1) * 2 * 3);
  const trailGeom = new THREE.BufferGeometry();
  trailGeom.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeom.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
  trailGeom.setDrawRange(0, 0);
  const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 });
  const trails = new THREE.LineSegments(trailGeom, trailMat);
  scene.add(trails);

  return {
    renderer, scene, camera, points, pGeom, pMat,
    links, linkGeom, trails, trailGeom,
    particleCount, trailLen,
    dispose() {
      pGeom.dispose(); pMat.dispose();
      linkGeom.dispose(); linkMat.dispose();
      trailGeom.dispose(); trailMat.dispose();
      renderer.dispose();
    },
  };
}

// Updates the Points `position`, `color`, `size`, `alpha` buffers from particle
// array. `particles` is [{x,y,z,baseColorHex,...}]. `params` is the current
// interpolated state (tint, tintAmt, brightness).
export function updatePoints(ctx, particles, params) {
  const posAttr = ctx.pGeom.attributes.position;
  const colAttr = ctx.pGeom.attributes.color;
  const szAttr = ctx.pGeom.attributes.size;
  const aAttr = ctx.pGeom.attributes.alpha;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    posAttr.array[i*3 + 0] = p.rx;
    posAttr.array[i*3 + 1] = p.ry;
    posAttr.array[i*3 + 2] = p.rz;
    const [br, bg, bb] = p.baseRGB;
    const tr = params.tint.r, tg = params.tint.g, tb = params.tint.b;
    const amt = params.tintAmt;
    colAttr.array[i*3 + 0] = ((br + (tr - br) * amt) / 255);
    colAttr.array[i*3 + 1] = ((bg + (tg - bg) * amt) / 255);
    colAttr.array[i*3 + 2] = ((bb + (tb - bb) * amt) / 255);
    szAttr.array[i] = 2.2;
    aAttr.array[i] = 0.85 * params.brightness;
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
  szAttr.needsUpdate = true;
  aAttr.needsUpdate = true;
}

export function render(ctx) {
  ctx.renderer.render(ctx.scene, ctx.camera);
}

// Rebuild link segment buffer from current rendered positions. Distance²
// threshold of 650 (in shape-space units) matches the brainstorm tuning.
// Returns number of segments drawn.
export function updateLinks(ctx, particles, params) {
  const N = particles.length;
  const positions = ctx.linkGeom.attributes.position.array;
  const colors = ctx.linkGeom.attributes.color.array;
  let segIdx = 0;
  const maxSeg = positions.length / 6;
  if (params.linkAlpha < 0.01) {
    ctx.linkGeom.setDrawRange(0, 0);
    return 0;
  }
  for (let i = 0; i < N; i++) {
    const a = particles[i];
    const jEnd = Math.min(N, i + 14);
    for (let j = i + 1; j < jEnd && segIdx < maxSeg; j++) {
      const b = particles[j];
      const dx = a.rx - b.rx, dy = a.ry - b.ry, dz = a.rz - b.rz;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 < 650) {
        const alpha = params.linkAlpha * (1 - d2 / 650);
        positions[segIdx*6+0] = a.rx;
        positions[segIdx*6+1] = a.ry;
        positions[segIdx*6+2] = a.rz;
        positions[segIdx*6+3] = b.rx;
        positions[segIdx*6+4] = b.ry;
        positions[segIdx*6+5] = b.rz;
        const c = alpha * 0.7;
        colors[segIdx*6+0] = 0.71 * c;
        colors[segIdx*6+1] = 0.82 * c;
        colors[segIdx*6+2] = 0.90 * c;
        colors[segIdx*6+3] = 0.71 * c;
        colors[segIdx*6+4] = 0.82 * c;
        colors[segIdx*6+5] = 0.90 * c;
        segIdx++;
      }
    }
  }
  ctx.linkGeom.attributes.position.needsUpdate = true;
  ctx.linkGeom.attributes.color.needsUpdate = true;
  ctx.linkGeom.setDrawRange(0, segIdx * 2);
  return segIdx;
}

// Update trails geometry from each particle's trail ring buffer. Trails are
// drawn as TRAIL_LEN-1 segments per particle, alpha-fading from the oldest
// to the newest. Each particle must have a `.trail[]` (ring buffer of
// [x,y,z]) and `.trailIdx` pointer.
export function updateTrails(ctx, particles, params) {
  const positions = ctx.trailGeom.attributes.position.array;
  const colors = ctx.trailGeom.attributes.color.array;
  const T = ctx.trailLen;
  let seg = 0;
  for (const p of particles) {
    for (let k = 0; k < T - 1; k++) {
      const idxA = (p.trailIdx + k) % T;
      const idxB = (p.trailIdx + k + 1) % T;
      const a = p.trail[idxA], b = p.trail[idxB];
      if (!a || !b) continue;
      positions[seg*6+0] = a[0];
      positions[seg*6+1] = a[1];
      positions[seg*6+2] = a[2];
      positions[seg*6+3] = b[0];
      positions[seg*6+4] = b[1];
      positions[seg*6+5] = b[2];
      const fade = 0.25 * ((k + 1) / (T - 1));
      const [br, bg, bb] = p.baseRGB;
      colors[seg*6+0] = (br / 255) * fade;
      colors[seg*6+1] = (bg / 255) * fade;
      colors[seg*6+2] = (bb / 255) * fade;
      colors[seg*6+3] = (br / 255) * fade;
      colors[seg*6+4] = (bg / 255) * fade;
      colors[seg*6+5] = (bb / 255) * fade;
      seg++;
    }
  }
  ctx.trailGeom.attributes.position.needsUpdate = true;
  ctx.trailGeom.attributes.color.needsUpdate = true;
  ctx.trailGeom.setDrawRange(0, seg * 2);
  return seg;
}
