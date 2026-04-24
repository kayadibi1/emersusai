// scripts/perf/landing-audit.mjs
//
// Cross-browser × cross-viewport audit harness. Captures for each
// (surface, browser, viewport) tuple:
//   - full-page screenshot
//   - console errors + warnings
//   - horizontal-overflow elements (element wider than viewport)
//   - touch targets smaller than 44×44 (interactive elements only,
//     mobile viewports only)
//   - computed-style flags for known iOS 100vh traps, missing
//     -webkit- prefixes on backdrop-filter, etc.
//
// Output: scripts/perf/audits/<timestamp>/{report.json,*.png}
//
// Usage:
//   node scripts/perf/landing-audit.mjs [--profile=landing|auth|app|domain] [origin]
//   default profile=landing, origin=https://emersus.ai

import { chromium, webkit, firefox, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const profileArg = args.find(a => a.startsWith('--profile='));
const PROFILE = profileArg ? profileArg.split('=')[1] : 'landing';
const ORIGIN = (args.find(a => a.startsWith('http')) || 'https://emersus.ai').replace(/\/+$/, '');

const PROFILES = {
  landing: [
    { name: 'landing',           path: '/' },
    { name: 'privacy',           path: '/privacy' },
    { name: 'terms',             path: '/terms' },
    { name: 'contact',           path: '/contact' },
    { name: 'consumer-health',   path: '/consumer-health-data' },
    { name: 'demo',              path: '/demo' },
  ],
  auth: [
    { name: 'login',             path: '/auth/login' },
    { name: 'signup',            path: '/auth/signup' },
    { name: 'forgot-password',   path: '/auth/forgot-password' },
    { name: 'callback',          path: '/auth/callback' },
    { name: 'reset-password',    path: '/auth/reset-password' },
  ],
  app: [
    { name: 'app-dashboard',     path: '/app/' },
    { name: 'app-library',       path: '/app/library' },
  ],
  domain: [
    { name: 'app-train',         path: '/app/train' },
    { name: 'app-nutrition',     path: '/app/nutrition' },
    { name: 'app-profile',       path: '/app/profile' },
    { name: 'app-progress',      path: '/app/progress' },
  ],
};

const SURFACES = PROFILES[PROFILE];
if (!SURFACES) {
  console.error(`Unknown profile: ${PROFILE}. Valid: ${Object.keys(PROFILES).join(', ')}`);
  process.exit(1);
}
console.log(`[audit] profile=${PROFILE} origin=${ORIGIN} surfaces=${SURFACES.length}`);

// Cross-product guidance:
// - Chromium: every viewport, catches layout issues
// - WebKit:   mobile viewports + one desktop, catches iOS Safari quirks
// - Firefox:  one mobile + one desktop, catches Gecko quirks
const VIEWPORTS = [
  { name: 'iphone-se1', w: 320, h: 568, isMobile: true,  dpr: 2 },
  { name: 'iphone-se2', w: 375, h: 812, isMobile: true,  dpr: 2 },
  { name: 'iphone-14',  w: 390, h: 844, isMobile: true,  dpr: 3 },
  { name: 'pixel-5',    w: 360, h: 740, isMobile: true,  dpr: 2.75 },
  { name: 'ipad-p',     w: 768, h: 1024, isMobile: true, dpr: 2 },
  { name: 'ipad-l',     w: 1024, h: 768, isMobile: false, dpr: 2 },
  { name: 'desktop',    w: 1440, h: 900, isMobile: false, dpr: 1 },
];

const BROWSER_MATRIX = [
  { id: 'chromium', launcher: chromium, viewports: VIEWPORTS.map(v => v.name) },
  { id: 'webkit',   launcher: webkit,   viewports: ['iphone-se1', 'iphone-se2', 'iphone-14', 'ipad-p', 'desktop'] },
  { id: 'firefox',  launcher: firefox,  viewports: ['iphone-14', 'desktop'] },
];

const OUT_DIR = path.resolve('scripts/perf/audits', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
fs.mkdirSync(OUT_DIR, { recursive: true });

const report = { origin: ORIGIN, startedAt: new Date().toISOString(), results: [] };

async function auditOne(browserCtx, vp, surface) {
  const page = await browserCtx.newPage();
  const consoleMsgs = [];
  const pageErrors = [];
  page.on('console', (m) => {
    const type = m.type();
    if (type === 'error' || type === 'warning') {
      consoleMsgs.push({ type, text: m.text().slice(0, 300) });
    }
  });
  page.on('pageerror', (e) => {
    pageErrors.push({ message: String(e.message).slice(0, 300), stack: String(e.stack || '').slice(0, 500) });
  });

  const url = `${ORIGIN}${surface.path}`;
  let status = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    status = resp ? resp.status() : null;
  } catch (err) {
    await page.close().catch(() => {});
    return {
      browser: browserCtx._browserId,
      viewport: vp.name,
      surface: surface.name,
      url,
      error: String(err.message).slice(0, 300),
    };
  }

  // Let page settle — fonts, wave, lazy content, etc.
  await page.waitForTimeout(1200);

  // Audit DOM — horizontal overflow, touch targets, stylesheet flags.
  const audit = await page.evaluate(({ vpW, isMobile }) => {
    // Walk up the ancestor chain looking for an element whose
    // computed overflow-x is hidden/clip/auto/scroll. If we find one,
    // the offending element is visually clipped and isn't a user-
    // facing overflow bug — it's a decorative or animated element
    // that happens to extend past the viewport by design (marquees,
    // tilted 3D grids, etc.). Only flag overflow when the element
    // escapes to a root scrollable ancestor.
    const isClipped = (el) => {
      let p = el.parentElement;
      while (p && p !== document.body && p !== document.documentElement) {
        const cs = getComputedStyle(p);
        const ox = cs.overflowX;
        if (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') return true;
        p = p.parentElement;
      }
      return false;
    };

    const overflowers = [];
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.right <= vpW + 2 || r.width <= 10) continue;
      const cs = getComputedStyle(el);
      if (cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflowX === 'clip') continue;
      if (isClipped(el)) continue;
      if (overflowers.length < 15) {
        overflowers.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
          overflowPx: Math.round(r.right - vpW),
          width: Math.round(r.width),
        });
      }
    }

    // Touch-target check: WCAG 2.5.5 = 44×44 CSS px. Only run on mobile
    // viewports; desktop UI doesn't bind to this. Target set: <a>, <button>,
    // <summary>, <input type=[button|submit|checkbox|radio|...]>, role=button.
    //
    // WCAG 2.5.5 exempts "Inline: The target is in a sentence or block of
    // text." — an <a> whose parent is a <p>, <li>, <span>, etc. with
    // surrounding text content is treated as inline body text. We detect
    // this by checking whether the element shares a text-flowing parent
    // with other text content. Raw body links dominate audit noise without
    // this filter (landing showed ~140 inline links on a single viewport).
    const isInlineBodyLink = (el) => {
      if (el.tagName !== 'A') return false;
      const p = el.parentElement;
      if (!p) return false;
      const pTag = p.tagName;
      const inlineParents = new Set(['P', 'LI', 'SPAN', 'TD', 'DD', 'DT', 'BLOCKQUOTE', 'SMALL']);
      if (!inlineParents.has(pTag)) return false;
      // Require surrounding text (not just the link alone in a <p>).
      const parentText = (p.innerText || '').replace(el.innerText || '', '').trim();
      return parentText.length > 8;
    };

    const smallTargets = [];
    if (isMobile) {
      const interactive = document.querySelectorAll('a, button, summary, [role=button], input[type=submit], input[type=button], input[type=checkbox], input[type=radio]');
      for (const el of interactive) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;   // hidden
        if (r.width >= 44 && r.height >= 44) continue;
        if (isInlineBodyLink(el)) continue;
        if (smallTargets.length < 20) {
          smallTargets.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
            w: Math.round(r.width),
            h: Math.round(r.height),
            text: (el.innerText || el.value || '').slice(0, 40).replace(/\s+/g, ' '),
          });
        }
      }
    }

    // Quick stylesheet scan for known iOS/Safari compat smells on the
    // loaded document. Same-origin only (cross-origin throws on .cssRules).
    const flags = { has100vhRules: 0, missingWebkitBackdrop: 0 };
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      const walk = (list) => {
        for (const r of list) {
          if (r.cssRules) { walk(r.cssRules); continue; }
          if (!r.style) continue;
          const cssText = r.cssText || '';
          if (/\b(height|min-height|max-height)\s*:\s*100vh\b/i.test(cssText)) flags.has100vhRules++;
          if (cssText.includes('backdrop-filter') && !cssText.includes('-webkit-backdrop-filter')) flags.missingWebkitBackdrop++;
        }
      };
      walk(rules);
    }

    return {
      docHeight: document.documentElement.scrollHeight,
      docWidth:  document.documentElement.scrollWidth,
      overflowers,
      smallTargets,
      flags,
      title: document.title.slice(0, 80),
    };
  }, { vpW: vp.w, isMobile: vp.isMobile });

  // Screenshot.
  const pngName = `${surface.name}__${browserCtx._browserId}__${vp.name}.png`;
  const pngPath = path.join(OUT_DIR, pngName);
  await page.screenshot({ path: pngPath, fullPage: true, type: 'png' }).catch(() => {});

  await page.close().catch(() => {});

  return {
    browser: browserCtx._browserId,
    viewport: vp.name,
    surface: surface.name,
    url,
    httpStatus: status,
    ...audit,
    horizontalScroll: audit.docWidth > vp.w + 2,
    consoleErrors: consoleMsgs.filter(m => m.type === 'error'),
    consoleWarnings: consoleMsgs.filter(m => m.type === 'warning').slice(0, 5),
    pageErrors,
    screenshot: pngName,
  };
}

// Persist the report even if a browser launch or context crashes mid-run.
// Firefox, for instance, rejects `isMobile` outright; without this, a
// partial run would lose every preceding (surface, viewport, browser) sample.
const flush = () => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
};

try {
  for (const browserCfg of BROWSER_MATRIX) {
    let browser;
    try {
      browser = await browserCfg.launcher.launch();
    } catch (err) {
      console.log(`! ${browserCfg.id} launch failed: ${err.message}`);
      continue;
    }
    browser._browserId = browserCfg.id;
    for (const vpName of browserCfg.viewports) {
      const vp = VIEWPORTS.find(v => v.name === vpName);
      // Firefox's Playwright driver doesn't support `isMobile` / `hasTouch`
      // context options. Fall back to plain viewport + UA spoofing there;
      // layout is what we care about, not pointer-events.
      const ctxOpts = {
        viewport: { width: vp.w, height: vp.h },
        deviceScaleFactor: vp.dpr,
      };
      if (browserCfg.id !== 'firefox') {
        ctxOpts.isMobile = vp.isMobile;
        ctxOpts.hasTouch = vp.isMobile;
      }
      if (vp.isMobile && browserCfg.id === 'chromium') {
        ctxOpts.userAgent = 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
      }
      let ctx;
      try {
        ctx = await browser.newContext(ctxOpts);
      } catch (err) {
        console.log(`! ${browserCfg.id} ${vp.name} newContext failed: ${err.message}`);
        continue;
      }
      ctx._browserId = browserCfg.id;
      for (const surface of SURFACES) {
        process.stdout.write(`· ${browserCfg.id} ${vp.name} ${surface.name} `);
        const r = await auditOne(ctx, vp, surface);
        report.results.push(r);
        const tag = r.error ? 'ERROR'
                  : r.horizontalScroll ? 'HSCROLL'
                  : (r.overflowers?.length || 0) > 0 ? `overflow:${r.overflowers.length}`
                  : (r.smallTargets?.length || 0) > 0 ? `tap:${r.smallTargets.length}`
                  : (r.consoleErrors?.length || 0) > 0 ? `jsErr:${r.consoleErrors.length}`
                  : 'ok';
        console.log(tag);
      }
      await ctx.close();
      flush();    // incremental save after each (browser, viewport)
    }
    await browser.close();
  }
} finally {
  flush();
}

const summary = {
  totalRuns:        report.results.length,
  errors:           report.results.filter(r => r.error).length,
  horizontalScroll: report.results.filter(r => r.horizontalScroll).length,
  overflowElements: report.results.reduce((s, r) => s + (r.overflowers?.length || 0), 0),
  smallTapTargets:  report.results.reduce((s, r) => s + (r.smallTargets?.length || 0), 0),
  consoleErrors:    report.results.reduce((s, r) => s + (r.consoleErrors?.length || 0), 0),
  pageErrors:       report.results.reduce((s, r) => s + (r.pageErrors?.length || 0), 0),
  totalFlag_100vh:  report.results.reduce((s, r) => s + (r.flags?.has100vhRules || 0), 0),
};
console.log('\n─── SUMMARY ───');
console.log(JSON.stringify(summary, null, 2));
console.log(`\nReport + screenshots: ${OUT_DIR}`);
