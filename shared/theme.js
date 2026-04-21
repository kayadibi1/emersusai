// shared/theme.js — palette resolver + DOM applier.
// Pure functions (resolveInitialTheme, validateTheme) are unit-tested.
// DOM effects (applyTheme, bootTheme, bindSwitcher) are thin, tested manually.

// Side-effect: mount the animated brand dots globally. Every page that
// imports bootTheme (every page) gets the dot animation for free.
import './brand-dots.js';

export const VALID_THEMES = ['mint', 'paper'];
const STORAGE_KEY = 'emersus-theme';

/**
 * @param {string | null | undefined} theme
 * @returns {string | null} the theme if valid, else null
 */
export function validateTheme(theme) {
  return VALID_THEMES.includes(theme) ? theme : null;
}

/**
 * Resolve the initial theme. Order of precedence:
 *   1. Saved preference (user picked once, we respect it).
 *   2. Graphite·Jade (mint, dark) — product default.
 *
 * We intentionally ignore `prefers-color-scheme` here: the OS-level hint
 * was causing unexpected theme flips for users who hadn't opted in.
 * Users switch themes in Settings.
 *
 * @param {{ saved: string | null | undefined, systemPrefersLight?: boolean | undefined }} ctx
 * @returns {'mint' | 'paper'}
 */
export function resolveInitialTheme({ saved }) {
  const validSaved = validateTheme(saved);
  if (validSaved) return validSaved;
  return 'mint';
}

/**
 * Apply a theme to the document root. DOM effect.
 * @param {string} theme
 */
export function applyTheme(theme) {
  const valid = validateTheme(theme) || 'mint';
  document.documentElement.setAttribute('data-theme', valid);
  try { localStorage.setItem(STORAGE_KEY, valid); } catch (_) {}
  document.dispatchEvent(new CustomEvent('emersus:themechange', { detail: { theme: valid } }));
}

/**
 * Read saved theme from localStorage. DOM effect (storage access).
 * @returns {string | null}
 */
export function readSavedTheme() {
  try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
}

/**
 * Detect system preference. DOM effect.
 * @returns {boolean}
 */
export function systemPrefersLight() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

/**
 * Bootstrap: set the initial theme on page load.
 * Call once, early (before first paint ideally).
 */
export function bootTheme() {
  const theme = resolveInitialTheme({
    saved: readSavedTheme(),
    systemPrefersLight: systemPrefersLight(),
  });
  document.documentElement.setAttribute('data-theme', theme);

  // Cross-tab sync: if another tab flips the theme, mirror it here so
  // open pages don't drift. Only rebinds on the STORAGE_KEY to avoid
  // reacting to unrelated localStorage writes.
  if (typeof window !== 'undefined' && !window.__emersusThemeStorageBound) {
    window.__emersusThemeStorageBound = true;
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      const next = validateTheme(e.newValue);
      if (!next) return;
      document.documentElement.setAttribute('data-theme', next);
      document.dispatchEvent(new CustomEvent('emersus:themechange', { detail: { theme: next } }));
    });
  }

  return theme;
}

/**
 * Bind click handlers for palette swatches.
 * Expects swatches with `data-theme-swatch="mint"` or `data-theme-swatch="paper"`.
 * Marks the active one with `.active`.
 */
export function bindSwitcher(root = document) {
  const swatches = root.querySelectorAll('[data-theme-swatch]');
  const mark = (theme) => {
    swatches.forEach((s) => s.classList.toggle('active', s.dataset.themeSwatch === theme));
  };
  const current = document.documentElement.getAttribute('data-theme') || 'mint';
  mark(current);

  swatches.forEach((s) => {
    s.addEventListener('click', () => {
      const theme = s.dataset.themeSwatch;
      applyTheme(theme);
      mark(theme);
    });
  });

  document.addEventListener('emersus:themechange', (e) => mark(e.detail.theme));
}
