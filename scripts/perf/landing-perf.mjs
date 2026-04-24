// scripts/perf/landing-perf.mjs
//
// Headed-Chromium landing-page perf benchmark. Samples idle + scroll FPS at
// three CPU-throttle tiers via CDP's Emulation.setCPUThrottlingRate so we
// know how the animation feels on mid-tier and low-end hardware, not just
// the dev box. Also captures the GPU the wave actually ran on, so we can
// distinguish SwiftShader (software) from real GPU.
//
// Usage: node scripts/perf/landing-perf.mjs [url]
//   default url: https://emersus.ai/

import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://emersus.ai/';

// Lighthouse uses 4x CPU slowdown for mid-tier laptop, 6x for low-end.
const PROFILES = [
  { name: '1x (your hardware)',            cpu: 1 },
  { name: '4x CPU slowdown (mid-laptop)',  cpu: 4 },
  { name: '6x CPU slowdown (low-end)',     cpu: 6 },
];

async function runProfile({ name, cpu }, url) {
  const browser = await chromium.launch({
    headless: false,
    args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

  await page.goto(url, { waitUntil: 'load' });
  // Warm up: give the wave's RAF chain time to establish and the page to settle.
  await page.waitForTimeout(1000);
  // Make sure the page is focused (not backgrounded) so RAF isn't throttled.
  await page.bringToFront();

  const result = await page.evaluate(async () => {
    const sampleFps = (ms) => new Promise((resolve) => {
      const frames = [];
      let last = performance.now();
      const start = last;
      const tick = (now) => {
        frames.push(now - last);
        last = now;
        if (now - start < ms) requestAnimationFrame(tick);
        else resolve(frames);
      };
      requestAnimationFrame(tick);
    });

    const loafEntries = [];
    let loafObs = null;
    try {
      loafObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          loafEntries.push({ d: e.duration, block: e.blockingDuration || 0 });
        }
      });
      loafObs.observe({ type: 'long-animation-frame', buffered: true });
    } catch {}

    const idleFrames = await sampleFps(4000);

    // Scroll: smoothly drive the page through the hero and mid sections.
    const scrollFrames = [];
    {
      let last = performance.now();
      const startY = window.scrollY;
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      const endY = Math.min(maxY, startY + 2400);
      const dur = 4000;
      await new Promise((resolve) => {
        const s = performance.now();
        const tick = (now) => {
          scrollFrames.push(now - last);
          last = now;
          const t = Math.min(1, (now - s) / dur);
          window.scrollTo(0, startY + (endY - startY) * t);
          if (now - s < dur) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
    }

    if (loafObs) loafObs.disconnect();

    const summarize = (frames) => {
      if (!frames.length) return null;
      const sorted = [...frames].sort((a, b) => a - b);
      const sum = frames.reduce((s, x) => s + x, 0);
      const avg = sum / frames.length;
      const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      return {
        frames: frames.length,
        avgFps: +(1000 / avg).toFixed(1),
        p50Ms: +p(0.50).toFixed(2),
        p95Ms: +p(0.95).toFixed(2),
        p99Ms: +p(0.99).toFixed(2),
        maxMs: +sorted[sorted.length - 1].toFixed(2),
        janks50: frames.filter(f => f > 50).length,
        stutter18: frames.filter(f => f > 18).length,
      };
    };

    let gpuInfo = null;
    const waveCanvas = document.getElementById('landing-wave');
    if (waveCanvas) {
      const gl = waveCanvas.getContext('webgl2') || waveCanvas.getContext('webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        gpuInfo = {
          renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          vendor:   ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)   : gl.getParameter(gl.VENDOR),
        };
      }
    }

    const nav = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint');
    const fcp = paint.find(p => p.name === 'first-contentful-paint');

    return {
      doc: { hidden: document.hidden, visibilityState: document.visibilityState },
      gpu: gpuInfo,
      load: {
        ttfbMs: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
        fcpMs:  fcp ? Math.round(fcp.startTime) : null,
        domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : null,
      },
      idle: summarize(idleFrames),
      scroll: summarize(scrollFrames),
      loaf: {
        count: loafEntries.length,
        totalMs: +loafEntries.reduce((s, e) => s + e.d, 0).toFixed(1),
        totalBlockingMs: +loafEntries.reduce((s, e) => s + e.block, 0).toFixed(1),
        maxMs: loafEntries.length ? +Math.max(...loafEntries.map(e => e.d)).toFixed(1) : 0,
      },
      memoryMB: performance.memory
        ? { used: Math.round(performance.memory.usedJSHeapSize / 1048576) }
        : null,
    };
  });

  await browser.close();
  return { profile: name, cpu, ...result };
}

console.log(`[landing-perf] ${URL}`);
console.log('');
for (const p of PROFILES) {
  const r = await runProfile(p, URL);
  console.log(`── ${r.profile} ──`);
  console.log(`  GPU:          ${r.gpu ? `${r.gpu.renderer} (${r.gpu.vendor})` : 'n/a'}`);
  console.log(`  Load:         TTFB ${r.load.ttfbMs}ms · FCP ${r.load.fcpMs}ms · DCL ${r.load.domContentLoadedMs}ms`);
  console.log(`  Idle FPS:     ${r.idle.avgFps.toString().padStart(5)} avg · p95 frame ${r.idle.p95Ms}ms · max ${r.idle.maxMs}ms · janks(>50ms) ${r.idle.janks50} · stutters(>18ms) ${r.idle.stutter18}/${r.idle.frames}`);
  console.log(`  Scroll FPS:   ${r.scroll.avgFps.toString().padStart(5)} avg · p95 frame ${r.scroll.p95Ms}ms · max ${r.scroll.maxMs}ms · janks(>50ms) ${r.scroll.janks50} · stutters(>18ms) ${r.scroll.stutter18}/${r.scroll.frames}`);
  console.log(`  LongAnimFr:   ${r.loaf.count} entries · total ${r.loaf.totalMs}ms · blocking ${r.loaf.totalBlockingMs}ms · max ${r.loaf.maxMs}ms`);
  console.log(`  JS heap:      ${r.memoryMB?.used ?? '?'} MB`);
  console.log('');
}
