/* shared/landing-wave.js
 *
 * Landing hero sea-wave wireframe (v2). Mounts a THREE.js LineSegments
 * mesh onto a canvas, respects reduced-motion + coarse-pointer-mobile
 * gates, pauses while off-screen or the tab is hidden, re-tints on theme
 * change. Defaults are the values that were signed off in
 * app/wave-v2-mockup.html; URL param `?wave=warm` overrides the palette
 * family for quick A/B.
 *
 * Usage:
 *   import { initLandingWave } from '/shared/landing-wave.js';
 *   initLandingWave({ canvas: document.getElementById('landing-wave') });
 */

import * as THREE from 'https://esm.sh/three@0.161.0';
import { buildLineGeometry } from '/shared/wave/geometry.js';
import { VERTEX_SHADER, FRAGMENT_SHADER } from '/shared/wave/shaders.js';
import { resolvePalette } from '/shared/wave/palettes.js';

const DEFAULTS = {
  width:       14.0,
  points:      240,
  fibers:       96,
  spread:      3.00,
  ampx:        0.85,
  freqx:       1.40,
  freqz:       0.90,
  speed:       0.25,
  breatheAmp:  0.28,
  breatheFreq: 0.14,
  tilt:        0.55,
  fov:         44,
  camz:        5.50,
  yoff:        0.0,
};

function resolveFamily(palette) {
  try {
    const q = new URLSearchParams(window.location.search).get('wave');
    if (q === 'warm' || q === 'emersus') return q;
  } catch (_) { /* no window */ }
  return palette || 'emersus';
}

function currentTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'paper' ? 'paper' : 'mint';
}

function shouldRender() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'frozen';
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  if (conn && conn.saveData) return 'skip';
  const mem = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (mem < 4 || cores < 4) return 'skip';
  if (window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 700) return 'skip';
  return 'animate';
}

export function initLandingWave({ canvas, palette } = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) return { dispose() {} };

  const mode = shouldRender();
  if (mode === 'skip') {
    canvas.parentElement?.classList.add('landing-wave--fallback');
    return { dispose() {} };
  }

  const family = resolveFamily(palette);
  let theme = currentTheme();
  let preset = resolvePalette(family, theme);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  } catch (err) {
    console.warn('[landing-wave] WebGL unavailable', err);
    canvas.parentElement?.classList.add('landing-wave--fallback');
    return { dispose() {} };
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(DEFAULTS.fov, 1.7778, 0.1, 100);
  camera.position.set(
    0,
    Math.sin(DEFAULTS.tilt) * DEFAULTS.camz,
    Math.cos(DEFAULTS.tilt) * DEFAULTS.camz,
  );
  camera.lookAt(0, 0, 0);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime:        { value: 0 },
      uWidth:       { value: DEFAULTS.width },
      uFiberCount:  { value: DEFAULTS.fibers },
      uSpread:      { value: DEFAULTS.spread },
      uAmpX:        { value: DEFAULTS.ampx },
      uFreqX:       { value: DEFAULTS.freqx },
      uFreqZ:       { value: DEFAULTS.freqz },
      uSpeed:       { value: DEFAULTS.speed },
      uBreatheAmp:  { value: DEFAULTS.breatheAmp },
      uBreatheFreq: { value: DEFAULTS.breatheFreq },
      uYoff:        { value: DEFAULTS.yoff },
      uC0:    { value: new THREE.Color(preset.stops[0]) },
      uC1:    { value: new THREE.Color(preset.stops[1]) },
      uC2:    { value: new THREE.Color(preset.stops[2]) },
      uC3:    { value: new THREE.Color(preset.stops[3]) },
      uAlpha: { value: preset.alpha },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  const geometry = buildLineGeometry(DEFAULTS.fibers, DEFAULTS.points, DEFAULTS.width);
  const mesh = new THREE.LineSegments(geometry, material);
  scene.add(mesh);

  function applyPalette() {
    preset = resolvePalette(family, theme);
    material.uniforms.uC0.value.set(preset.stops[0]);
    material.uniforms.uC1.value.set(preset.stops[1]);
    material.uniforms.uC2.value.set(preset.stops[2]);
    material.uniforms.uC3.value.set(preset.stops[3]);
    material.uniforms.uAlpha.value = preset.alpha;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width  = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  let intersecting = true;
  let visible = true;
  let disposed = false;
  let rafId = null;

  let intersectionObserver = null;
  if ('IntersectionObserver' in window) {
    intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === canvas) intersecting = entry.isIntersecting;
      }
    }, { threshold: 0.02 });
    intersectionObserver.observe(canvas);
  }

  function onVisibilityChange() {
    visible = document.visibilityState === 'visible';
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  const themeObserver = new MutationObserver(() => {
    const next = currentTheme();
    if (next !== theme) {
      theme = next;
      applyPalette();
    }
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const start = performance.now();
  function frame(now) {
    if (disposed) return;
    const t = (now - start) * 0.001 + 14;
    material.uniforms.uTime.value = mode === 'frozen' ? 14 : t;

    if (intersecting && visible) {
      renderer.render(scene, camera);
    }
    if (mode === 'frozen') return;
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
  canvas.parentElement?.classList.add('landing-wave--mounted');

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      themeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      scene.remove(mesh);
    },
  };
}
