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
