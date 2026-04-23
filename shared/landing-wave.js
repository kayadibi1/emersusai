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

const LITE_DEFAULTS = {
  ...DEFAULTS,
  points:      160,
  fibers:       64,
  speed:       0.18,
  breatheAmp:  0.18,
};

function getPerformanceTier() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const saveData = Boolean(conn && conn.saveData);
  const lowMemory = (navigator.deviceMemory || 8) < 4;
  const lowCores = (navigator.hardwareConcurrency || 8) < 4;
  const coarseSmall = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 760;
  const slowDisplay = window.matchMedia('(update: slow)').matches;
  return (saveData || lowMemory || lowCores || coarseSmall || slowDisplay) ? 'lite' : 'full';
}

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
  const tier = getPerformanceTier();
  const settings = tier === 'lite' ? LITE_DEFAULTS : DEFAULTS;
  let theme = currentTheme();
  let preset = resolvePalette(family, theme);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: tier !== 'lite',
      premultipliedAlpha: false,
      powerPreference: tier === 'lite' ? 'low-power' : 'high-performance',
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === 'lite' ? 1 : 1.5));
  } catch (err) {
    console.warn('[landing-wave] WebGL unavailable', err);
    canvas.parentElement?.classList.add('landing-wave--fallback');
    return { dispose() {} };
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, 1.7778, 0.1, 100);
  camera.position.set(
    0,
    Math.sin(settings.tilt) * settings.camz,
    Math.cos(settings.tilt) * settings.camz,
  );
  camera.lookAt(0, 0, 0);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime:        { value: 0 },
      uWidth:       { value: settings.width },
      uFiberCount:  { value: settings.fibers },
      uSpread:      { value: settings.spread },
      uAmpX:        { value: settings.ampx },
      uFreqX:       { value: settings.freqx },
      uFreqZ:       { value: settings.freqz },
      uSpeed:       { value: settings.speed },
      uBreatheAmp:  { value: settings.breatheAmp },
      uBreatheFreq: { value: settings.breatheFreq },
      uYoff:        { value: settings.yoff },
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

  const geometry = buildLineGeometry(settings.fibers, settings.points, settings.width);
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

  let intersecting = !('IntersectionObserver' in window);
  let visible = document.visibilityState === 'visible';
  let disposed = false;
  let rafId = null;
  let lastPaint = 0;
  const maxFps = tier === 'lite' ? 24 : 36;
  const minFrame = 1000 / maxFps;

  function shouldRun() {
    return !disposed && visible && intersecting;
  }

  function updateLoop() {
    if (shouldRun()) {
      if (!rafId) rafId = requestAnimationFrame(frame);
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  let intersectionObserver = null;
  if ('IntersectionObserver' in window) {
    intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === canvas) intersecting = entry.isIntersecting;
      }
      updateLoop();
    }, { threshold: 0.02 });
    intersectionObserver.observe(canvas);
  }

  function onVisibilityChange() {
    visible = document.visibilityState === 'visible';
    updateLoop();
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
    rafId = null;
    if (disposed) return;
    if (!shouldRun()) return;

    if (mode !== 'frozen' && lastPaint && now - lastPaint < minFrame) {
      rafId = requestAnimationFrame(frame);
      return;
    }
    lastPaint = now;

    const t = (now - start) * 0.001 + 14;
    material.uniforms.uTime.value = mode === 'frozen' ? 14 : t;

    renderer.render(scene, camera);
    if (mode === 'frozen') return;
    rafId = requestAnimationFrame(frame);
  }
  material.uniforms.uTime.value = 14;
  renderer.render(scene, camera);
  updateLoop();
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
