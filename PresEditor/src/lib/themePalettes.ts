// Milestone C (v2, new-from-scratch + theming): a small curated set of
// full palettes, reusing the exact CSS custom-property names already read/
// written by lib/paletteFromCss.js (the same ones Milestone 4's theme-token
// panel edits one at a time on an existing deck) — applying a palette here
// is just that same setThemeTokenInStyleBlock() call looped over every var,
// nothing new at the CSS-mechanism level. Only color-valued tokens are
// covered; --inv-ns (a numeric scale factor) and the three font-family
// tokens are left untouched by every palette.
import { setThemeTokenInStyleBlock } from './paletteFromCss';

export interface ThemePalette {
  key: string;
  label: string;
  vars: Record<string, string>;
}

export const THEME_PALETTES: ThemePalette[] = [
  {
    key: 'violet',
    label: 'Violet (par défaut)',
    vars: {
      navy: '#4b0976',
      'navy-2': '#461665',
      blue: '#f4c10b',
      'blue-dark': '#edd672',
      teal: '#f4c10b',
      'teal-dim': '#8c6aa3',
      'bg-light': '#fdfafc',
      ink: '#fdfafc',
      muted: '#dac2e6',
      card: '#461665',
      flag: '#edd672',
      'flag-soft': '#fff8bb',
      'accent-purple': '#8c6aa3',
    },
  },
  {
    key: 'ocean',
    label: 'Océan',
    vars: {
      navy: '#08304f',
      'navy-2': '#062338',
      blue: '#2fd4c8',
      'blue-dark': '#8fe9e0',
      teal: '#2fd4c8',
      'teal-dim': '#4d7a95',
      'bg-light': '#f4fbfb',
      ink: '#f4fbfb',
      muted: '#bcd7e0',
      card: '#0d3a5c',
      flag: '#8fe9e0',
      'flag-soft': '#e3fbf8',
      'accent-purple': '#4d7a95',
    },
  },
  {
    key: 'forest',
    label: 'Forêt',
    vars: {
      navy: '#123524',
      'navy-2': '#0c2719',
      blue: '#c8e05a',
      'blue-dark': '#e2f0a0',
      teal: '#7bb661',
      'teal-dim': '#4f7a52',
      'bg-light': '#f8faf2',
      ink: '#f8faf2',
      muted: '#cfe0bd',
      card: '#1c4a30',
      flag: '#c8e05a',
      'flag-soft': '#f2f8dc',
      'accent-purple': '#4f7a52',
    },
  },
  {
    key: 'sunset',
    label: 'Coucher de soleil',
    vars: {
      navy: '#4a1220',
      'navy-2': '#380d18',
      blue: '#ff8a3d',
      'blue-dark': '#ffc38a',
      teal: '#ff8a3d',
      'teal-dim': '#c2645a',
      'bg-light': '#fff8f3',
      ink: '#fff8f3',
      muted: '#f0c4ae',
      card: '#652038',
      flag: '#ffc38a',
      'flag-soft': '#ffe9d6',
      'accent-purple': '#c2645a',
    },
  },
  {
    key: 'slate',
    label: 'Ardoise',
    vars: {
      navy: '#22262b',
      'navy-2': '#181b1f',
      blue: '#5fd4d0',
      'blue-dark': '#a6ebe8',
      teal: '#5fd4d0',
      'teal-dim': '#7b8894',
      'bg-light': '#f7f8f9',
      ink: '#f7f8f9',
      muted: '#c3cad1',
      card: '#31363d',
      flag: '#5fd4d0',
      'flag-soft': '#e2f7f6',
      'accent-purple': '#7b8894',
    },
  },
];

export function applyThemePalette(styleBlock: string, palette: ThemePalette): string {
  return Object.entries(palette.vars).reduce(
    (block, [varName, value]) => setThemeTokenInStyleBlock(block, varName, value),
    styleBlock
  );
}
