// Milestone 5: pure helpers that turn EditorState into the pieces
// scene/renderScene.ts's RenderContext needs — resolving the section/deck
// master cascade, building the componentSlideId -> Scene lookup table, and
// computing a slide's page position. Shared by Canvas.tsx (live preview)
// and exportPresentation.ts (standalone file), so the two can never resolve
// a master/component/page-number differently.

import type { EditorState, SectionMeta, EditorMeta } from '../types/state';
import type { Scene } from '../types/scene';

// Section's own master wins; falls back to the deck-wide default; null if
// neither is set (no master applied to the slide).
export function resolveEffectiveMasterSlideId(section: SectionMeta | null, meta: EditorMeta): string | null {
  return (section && section.masterSlideId) || meta.defaultMasterSlideId || null;
}

export function resolveEffectiveMaster(state: EditorState, section: SectionMeta | null): Scene | null {
  const masterSlideId = resolveEffectiveMasterSlideId(section, state.meta);
  if (!masterSlideId) return null;
  const slide = state.slidesById[masterSlideId];
  return slide ? state.scenesById[slide.pages[0]] ?? null : null;
}

export function buildComponentsMap(state: EditorState): Record<string, Scene> {
  const map: Record<string, Scene> = {};
  state.componentSlideIds.forEach((id) => {
    const slide = state.slidesById[id];
    const scene = slide ? state.scenesById[slide.pages[0]] : undefined;
    if (scene) map[id] = scene;
  });
  return map;
}

// 1-based position among the deck's *main* (sectioned) slides only — the
// Q&A deck is hidden from the overview map and, per the same reasoning,
// excluded from page numbering. null if the slide isn't a main slide at
// all (a Q&A slide, or a master/component slide being edited on its own).
export function mainSlideIndex(state: EditorState, slideId: string): number | null {
  const flat = state.sections.flatMap((s) => s.slideIds);
  const i = flat.indexOf(slideId);
  return i === -1 ? null : i + 1;
}

export function mainSlideCount(state: EditorState): number {
  return state.sections.reduce((n, s) => n + s.slideIds.length, 0);
}
