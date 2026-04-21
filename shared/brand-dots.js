// shared/brand-dots.js
// Rotates the ∴ glyph 120° every 30 s. Since ∴ is visually symmetric
// under 120° rotation, the dots appear to swap places between their
// existing positions while the overall glyph looks identical at rest.
// A brief accent glow fires during transit so the motion reads.
//
// Self-contained: injects its own <style>, side-effect mounts on load.
// Loaded globally via a side-effect import from shared/theme.js.

const SELECTORS = [
  '.brand b',
  '.brand-mark b',
  '.app-sidebar-brand b',
  '.footer-brand b',
  '.nav-wrap .brand b',
].join(',');

const STYLE_ID = 'brand-dots-style';
const DOT_GLYPH = '∴';
const ROTATE_EVERY_MS = 30000;
const TRANSIT_MS = 1150;

const STYLE = `
  .brand b, .brand-mark b, .app-sidebar-brand b,
  .footer-brand b, .nav-wrap .brand b {
    display: inline-block;
    /* Rotate about the ∴ centroid (slightly below the glyph's box center
       because two dots live on the bottom row). Tuned visually so the
       character sits in roughly the same spot across all 3 rotations. */
    transform-origin: 50% 60%;
    transition:
      transform ${TRANSIT_MS}ms cubic-bezier(.76, 0, .24, 1),
      filter .5s ease;
    will-change: transform, filter;
  }
  /* Brief glow during transit — telegraphs "something happened". */
  .brand b.is-rotating,
  .brand-mark b.is-rotating,
  .app-sidebar-brand b.is-rotating,
  .footer-brand b.is-rotating,
  .nav-wrap .brand b.is-rotating {
    filter:
      drop-shadow(0 0 0.32em currentColor)
      drop-shadow(0 0 0.08em currentColor);
  }

  @media (prefers-reduced-motion: reduce) {
    .brand b, .brand-mark b, .app-sidebar-brand b,
    .footer-brand b, .nav-wrap .brand b {
      transition: none;
    }
  }
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

let rotDeg = 0;
let instances = [];

function tick() {
  rotDeg += 120;
  instances.forEach((el) => {
    el.classList.add('is-rotating');
    el.style.transform = `rotate(${rotDeg}deg)`;
  });
  // Drop the glow just after the transit settles.
  setTimeout(() => {
    instances.forEach((el) => el.classList.remove('is-rotating'));
  }, TRANSIT_MS + 250);
}

function mount() {
  instances = Array.from(document.querySelectorAll(SELECTORS))
    .filter((el) => el.textContent.trim() === DOT_GLYPH);
  if (!instances.length) return;
  injectStyles();
  setInterval(tick, ROTATE_EVERY_MS);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
