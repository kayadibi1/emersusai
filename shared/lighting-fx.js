// shared/lighting-fx.js — Linear-style atmospheric lighting orchestrator.
//
// One-time init per page: adds the film-grain overlay, scans the DOM for
// elements matching a selector list, attaches .lfx-card + the inner
// <span class="lfx-spotlight">, and starts a rAF-throttled pointer-tracker
// that updates --mask-x / --mask-y / --lfx-prox on each card.
//
// For SPA pages (React-rendered /app/*), a MutationObserver picks up any
// later-added matches and enhances them in place without re-initializing
// the pointer listener.
//
// Skips entirely on paper palette — Cream absorbs colored glows at low
// opacity, there's nothing to "light up" there.
//
// Usage:
//   import { initLightingFx } from "/shared/lighting-fx.js";
//   initLightingFx({
//     selectors: ".bento-card, .tr-history-row, .nu-history-row",
//   });

const STATE = {
  initialized: false,
  cards: new Set(),
  selectors: "",
  rafPending: false,
  px: 0,
  py: 0,
};

function shouldUseLiteMotion() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const saveData = Boolean(conn && conn.saveData);
  const lowMemory = (navigator.deviceMemory || 8) < 4;
  const lowCores = (navigator.hardwareConcurrency || 8) < 4;
  const coarseSmall = window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 760;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const slowDisplay = window.matchMedia("(update: slow)").matches;
  return reduced || saveData || lowMemory || lowCores || coarseSmall || slowDisplay;
}

function attachSpotlight(el) {
  if (!el || STATE.cards.has(el)) return;
  el.classList.add("lfx-card");
  // Only add the span if one isn't already there (defensive — some
  // elements might have been enhanced by an older inline script).
  if (!el.querySelector(":scope > .lfx-spotlight")) {
    const span = document.createElement("span");
    span.className = "lfx-spotlight";
    span.setAttribute("aria-hidden", "true");
    el.appendChild(span);
  }
  STATE.cards.add(el);
}

function scanAndAttach(root = document) {
  if (!STATE.selectors) return;
  const matches = root.querySelectorAll ? root.querySelectorAll(STATE.selectors) : [];
  matches.forEach(attachSpotlight);
}

function update() {
  STATE.rafPending = false;
  const vh = window.innerHeight;
  STATE.cards.forEach((c) => {
    // Cards can be removed from the DOM (SPA navigation). Purge them.
    if (!c.isConnected) { STATE.cards.delete(c); return; }
    const r = c.getBoundingClientRect();
    if (r.bottom < -200 || r.top > vh + 200) {
      c.style.setProperty("--lfx-prox", 0);
      return;
    }
    const cx = Math.max(r.left, Math.min(STATE.px, r.right));
    const cy = Math.max(r.top,  Math.min(STATE.py, r.bottom));
    const d = Math.hypot(STATE.px - cx, STATE.py - cy);
    const prox = Math.max(0, Math.min(1, 1 - d / 200));
    c.style.setProperty("--lfx-prox", prox.toFixed(3));
    if (prox > 0) {
      c.style.setProperty("--mask-x", (STATE.px - r.left) + "px");
      c.style.setProperty("--mask-y", (STATE.py - r.top)  + "px");
    }
  });
}

function onPointerMove(e) {
  STATE.px = e.clientX;
  STATE.py = e.clientY;
  if (!STATE.rafPending) {
    STATE.rafPending = true;
    requestAnimationFrame(update);
  }
}

function onPointerLeave() {
  STATE.cards.forEach((c) => c.style.setProperty("--lfx-prox", 0));
}

/**
 * Initialize the lighting effects. Idempotent — calling twice on the
 * same page does nothing the second time. If `selectors` is passed on
 * a subsequent call, they are MERGED into the existing selector list
 * (so /app pages can progressively add SPA-rendered classes).
 *
 * @param {{ selectors?: string }} [opts]
 */
export function initLightingFx(opts = {}) {
  const newSelectors = String(opts.selectors || "").trim();
  if (shouldUseLiteMotion()) {
    document.documentElement.classList.add("motion-lite");
    if (newSelectors) {
      STATE.selectors = STATE.selectors
        ? `${STATE.selectors}, ${newSelectors}`
        : newSelectors;
    }
    return;
  }

  // Paper palette: no-op. Re-check every call since the user can flip
  // themes at runtime (see shared/theme.js). We don't tear down on
  // theme change — the CSS selectors handle visibility — but we avoid
  // the initial DOM work when the page boots on paper.
  if (document.documentElement.getAttribute("data-theme") !== "mint") {
    if (!newSelectors) return;
    STATE.selectors = STATE.selectors
      ? `${STATE.selectors}, ${newSelectors}`
      : newSelectors;
    return;
  }

  // Merge selectors on repeat calls.
  if (STATE.selectors && newSelectors) {
    STATE.selectors = `${STATE.selectors}, ${newSelectors}`;
  } else if (newSelectors) {
    STATE.selectors = newSelectors;
  }

  if (!STATE.initialized) {
    STATE.initialized = true;

    // 1. Film grain overlay (once).
    if (!document.querySelector(".lfx-grain")) {
      const grain = document.createElement("div");
      grain.className = "lfx-grain";
      grain.setAttribute("aria-hidden", "true");
      document.body.appendChild(grain);
    }

    // 2. Pointer listeners.
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);

    // 3. MutationObserver — picks up SPA-rendered cards matching our
    //    selector list. Throttled by batching into a single scan.
    const mo = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) { shouldScan = true; break; }
      }
      if (shouldScan) scanAndAttach();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // Initial scan (also runs on repeat calls so newly-added selectors
  // pick up already-rendered elements).
  scanAndAttach();
}
