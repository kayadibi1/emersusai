// shared/brand-dots.js
// Replaces the ∴ glyph inside every brand mark with three span-dots so
// they can be individually positioned, then cycles their arrangement
// every 30 s. Dots rotate through three configurations (A→B→C→A) with
// a staggered ease so the motion reads as premium, not nervous.
//
// Self-contained: injects its own <style>, side-effect mounts on load.
// Loaded globally via a side-effect import from shared/theme.js.

const DOT_GLYPH = '∴'; // ∴

const SELECTORS = [
  '.brand b',
  '.brand-mark b',
  '.app-sidebar-brand b',
  '.footer-brand b',
  '.nav-wrap .brand b',
].join(',');

const STYLE_ID = 'brand-dots-style';

// Positions forming ∴ (top dot, bottom-left, bottom-right). Values in em
// so they scale with the containing wordmark's font-size.
const POS = {
  A: { top: '0.10em', left: '0.27em' }, // top
  B: { top: '0.54em', left: '0.07em' }, // bottom-left
  C: { top: '0.54em', left: '0.47em' }, // bottom-right
};

const STYLE = `
  .brand-dots {
    display: inline-block;
    position: relative;
    width: 0.68em;
    height: 0.82em;
    vertical-align: -0.04em;
    margin: 0 0.02em;
    /* Keep the accent color — inherits from the parent .brand b rule. */
  }
  .brand-dot {
    position: absolute;
    width: 0.13em;
    height: 0.13em;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 0 0 currentColor;
    transition:
      top 1.15s cubic-bezier(.76, 0, .24, 1),
      left 1.15s cubic-bezier(.76, 0, .24, 1),
      box-shadow .45s ease;
  }
  /* Staggered delay produces a cascade — dot 1 leads, 2 follows, 3 last. */
  .brand-dot-2 { transition-delay: 0.09s, 0.09s, 0s; }
  .brand-dot-3 { transition-delay: 0.18s, 0.18s, 0s; }

  /* Rotation 0 (resting ∴): dot-1=A, dot-2=B, dot-3=C */
  .brand-dots[data-rot="0"] .brand-dot-1 { top: ${POS.A.top}; left: ${POS.A.left}; }
  .brand-dots[data-rot="0"] .brand-dot-2 { top: ${POS.B.top}; left: ${POS.B.left}; }
  .brand-dots[data-rot="0"] .brand-dot-3 { top: ${POS.C.top}; left: ${POS.C.left}; }

  /* Rotation 1: each dot moves to the next position (A→B, B→C, C→A) */
  .brand-dots[data-rot="1"] .brand-dot-1 { top: ${POS.B.top}; left: ${POS.B.left}; }
  .brand-dots[data-rot="1"] .brand-dot-2 { top: ${POS.C.top}; left: ${POS.C.left}; }
  .brand-dots[data-rot="1"] .brand-dot-3 { top: ${POS.A.top}; left: ${POS.A.left}; }

  /* Rotation 2: one more step (A→C via B's slot, etc.) */
  .brand-dots[data-rot="2"] .brand-dot-1 { top: ${POS.C.top}; left: ${POS.C.left}; }
  .brand-dots[data-rot="2"] .brand-dot-2 { top: ${POS.A.top}; left: ${POS.A.left}; }
  .brand-dots[data-rot="2"] .brand-dot-3 { top: ${POS.B.top}; left: ${POS.B.left}; }

  /* While mid-rotation, dots glow briefly — signals transition intent. */
  .brand-dots.rotating .brand-dot {
    box-shadow: 0 0 0.45em 0 currentColor;
  }

  @media (prefers-reduced-motion: reduce) {
    .brand-dot { transition: none; }
    .brand-dots.rotating .brand-dot { box-shadow: none; }
  }
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

function buildDots(b) {
  b.textContent = '';
  b.classList.add('brand-dots');
  b.setAttribute('data-rot', '0');
  b.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= 3; i++) {
    const span = document.createElement('span');
    span.className = 'brand-dot brand-dot-' + i;
    b.appendChild(span);
  }
}

let instances = [];
let intervalId = null;
let rotStep = 0;

function tick() {
  rotStep = (rotStep + 1) % 3;
  instances.forEach((el) => {
    el.classList.add('rotating');
    el.setAttribute('data-rot', String(rotStep));
  });
  // Turn the glow off after the motion settles (stagger + transit).
  setTimeout(() => {
    instances.forEach((el) => el.classList.remove('rotating'));
  }, 1500);
}

function mount() {
  const candidates = document.querySelectorAll(SELECTORS);
  instances = [];
  candidates.forEach((b) => {
    if (b.textContent.trim() !== DOT_GLYPH) return;
    buildDots(b);
    instances.push(b);
  });
  if (!instances.length) return;
  injectStyles();
  // Delay the first rotation so the logo is seen at rest before it moves.
  intervalId = setInterval(tick, 30000);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
