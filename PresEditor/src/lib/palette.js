// Section color palette, following the tint/border convention already used
// by CLUSTERS in the source presentation (10% tint, 35% border opacity).
export const SECTION_PALETTE = [
  { color: '#8c6aa3', tint: 'rgba(218,194,230,.10)', border: 'rgba(218,194,230,.35)' },
  { color: 'var(--blue)', tint: 'rgba(244,193,11,.10)', border: 'rgba(244,193,11,.35)' },
  { color: 'var(--navy)', tint: 'rgba(75,9,118,.08)', border: 'rgba(75,9,118,.30)' },
];

export function paletteAt(index) {
  return SECTION_PALETTE[((index % SECTION_PALETTE.length) + SECTION_PALETTE.length) % SECTION_PALETTE.length];
}

export function nextPaletteColor(currentColor) {
  const i = SECTION_PALETTE.findIndex((p) => p.color === currentColor);
  return SECTION_PALETTE[(i + 1 + SECTION_PALETTE.length) % SECTION_PALETTE.length];
}
