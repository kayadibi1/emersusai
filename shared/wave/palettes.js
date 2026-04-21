/* shared/wave/palettes.js
 *
 * Palette presets for the landing hero wave (v2: sea-wave wireframe).
 * Each preset is a 4-stop colour ramp sampled left→right across the
 * canvas in the fragment shader, plus a base alpha. Two families
 * (emersus, warm) × two themes (mint, paper).
 */

export const PALETTES = {
  emersus: {
    mint:  { stops: ['#bff6e4', '#34d399', '#5091f2', '#4338ca'], alpha: 0.72 },
    paper: { stops: ['#55a687', '#2f8a6a', '#3b6dd6', '#2c3ea8'], alpha: 0.55 },
  },
  warm: {
    mint:  { stops: ['#ffb6c1', '#ff6fa2', '#c084fc', '#5b63f6'], alpha: 0.78 },
    paper: { stops: ['#b44f6f', '#a43a79', '#7a40c0', '#3d3fb8'], alpha: 0.55 },
  },
};

export function resolvePalette(family, theme) {
  const fam = PALETTES[family] || PALETTES.emersus;
  return fam[theme] || fam.mint;
}
