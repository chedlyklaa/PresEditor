// Milestone 9 (starter templates): full starter decks, offered from the
// Welcome screen alongside "start blank" — each one just chains a couple of
// lib/sectionTemplates.ts entries onto a fresh empty state, exactly the way
// lib/emptyState.js's createBlankStartState builds its own single starter
// slide. Reusing SECTION_TEMPLATES here (rather than a separate deck-level
// template format) means new starter content only ever needs to be defined
// once.
import { createEmptyState } from './emptyState';
import { buildSectionFromTemplate } from './sectionTemplates';
import { GENERIC_STYLE_BLOCK } from './genericTemplate';
import { synthesizeLinearEdges } from './edgeGraph';
import { THEME_PALETTES, applyThemePalette } from './themePalettes';
import type { EditorState } from '../types/state';

export const PRESENTATION_TEMPLATES: Record<
  string,
  { label: string; desc: string; icon: string; sections: string[]; paletteKey?: string }
> = {
  pitch: {
    label: 'Pitch produit',
    desc: 'Pitch puis section standard — pour une présentation courte et percutante.',
    icon: 'sitemap',
    sections: ['pitch', 'standard'],
  },
  report: {
    label: 'Rapport de projet',
    desc: 'Deux sections de rapport structuré — pour un compte-rendu détaillé.',
    icon: 'clipboard',
    sections: ['report', 'standard'],
  },
  // Milestone D (templates gallery): three additional full-deck starters,
  // each pairing one new lib/sectionTemplates.ts entry with an existing one
  // (same composition mechanism as pitch/report above), and each on a
  // distinct lib/themePalettes.ts palette so the gallery's own thumbnails
  // (lib/thumbnail.ts) are visually distinguishable at a glance.
  architecture: {
    label: 'Revue d’architecture technique',
    desc: 'Titre, diagramme d’architecture en couches, risques, puis un rapport détaillé.',
    icon: 'server',
    sections: ['architecture', 'report'],
    paletteKey: 'slate',
  },
  course: {
    label: 'Cours / leçon',
    desc: 'Introduction du cours et objectifs, puis contenu détaillé en plusieurs parties.',
    icon: 'clipboard',
    sections: ['lesson', 'standard'],
    paletteKey: 'forest',
  },
  quarterly: {
    label: 'Revue trimestrielle',
    desc: 'Indicateurs clés du trimestre puis un rapport détaillé par sujet.',
    icon: 'chart',
    sections: ['kpi', 'report'],
    paletteKey: 'ocean',
  },
};

export function createStarterState(templateKey: string): EditorState | null {
  const tmpl = PRESENTATION_TEMPLATES[templateKey];
  if (!tmpl) return null;
  const state = createEmptyState() as EditorState;
  // No source file to pull a stylesheet from — same reasoning as
  // createBlankStartState's identical line. A template can additionally
  // name one of the curated palettes to start from something other than
  // the generic stylesheet's default (violet) colors.
  const palette = tmpl.paletteKey ? THEME_PALETTES.find((p) => p.key === tmpl.paletteKey) : null;
  state.meta.styleBlock = palette ? applyThemePalette(GENERIC_STYLE_BLOCK, palette) : GENERIC_STYLE_BLOCK;
  tmpl.sections.forEach((sectionTemplateKey, i) => {
    const built = buildSectionFromTemplate(sectionTemplateKey, i);
    if (!built) return;
    state.sections.push(built.section);
    built.slides.forEach((s) => {
      state.slidesById[s.id] = s;
    });
    built.scenes.forEach((sc) => {
      state.scenesById[sc.id] = sc;
    });
  });
  const firstSlideId = state.sections[0]?.slideIds[0] ?? null;
  state.selectedSlideId = firstSlideId;
  // Built directly (not through the ADD_SLIDE reducer action, which is
  // what splices edges in for a mid-session insert) — this *is* the whole
  // deck, so the synthesized linear chain over every section/slide it just
  // built is exactly the right starting graph, same as any other
  // freshly-imported/blank deck gets.
  state.edges = synthesizeLinearEdges(state);
  return state;
}
