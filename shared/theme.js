// shared/theme.js — palette resolver + DOM applier.
// Pure functions (resolveInitialTheme, validateTheme) are unit-tested.
// DOM effects (applyTheme, bootTheme, bindSwitcher) are thin, tested manually.

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
 * @param {{ saved: string | null | undefined, systemPrefersLight: boolean | undefined }} ctx
 * @returns {'mint' | 'paper'}
 */
export function resolveInitialTheme({ saved, systemPrefersLight }) {
  const validSaved = validateTheme(saved);
  if (validSaved) return validSaved;
  return systemPrefersLight === true ? 'paper' : 'mint';
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
