import { uid } from './id';
import { paletteAt } from './palette';
import { createSlideFromLayout } from './layouts';
import { GENERIC_STYLE_BLOCK } from './genericTemplate';
import { wrapHtmlAsScene } from '../scene/legacyHtmlAdapter';

export function createSection(label, colorIndex) {
  const p = paletteAt(colorIndex);
  return {
    id: uid('sec'),
    label,
    color: p.color,
    tint: p.tint,
    border: p.border,
    collapsed: false,
    slideIds: [],
    defaultBackground: null,
    masterSlideId: null,
  };
}

export function createEmptyState() {
  return {
    meta: {
      title: 'Ma présentation',
      loadedFrom: null,
      originalText: null,
      styleBlock: '',
      defaultBackground: null,
      defaultMasterSlideId: null,
      libraryId: null,
    },
    sections: [],
    qaSlideIds: [],
    qaCollapsed: false,
    slidesById: {},
    scenesById: {},
    selectedSlideId: null,
    selectedPage: 0,
    selection: null,
    notesOpen: false,
    masterSlideIds: [],
    componentSlideIds: [],
    assetsById: {},
    assetOrder: [],
    edges: [],
  };
}

export function createBlankStartState() {
  const state = createEmptyState();
  // No source file to pull a stylesheet from — reuse the same CSS the
  // generic export template ships, so blank slides (and the background
  // palette picker) aren't left unstyled.
  state.meta.styleBlock = GENERIC_STYLE_BLOCK;
  const section = createSection('Introduction', 0);
  const layout = createSlideFromLayout('title');
  const scene = wrapHtmlAsScene(layout.pages[0]);
  const id = uid('slide');
  state.slidesById[id] = { id, cls: layout.cls, pages: [scene.id], notes: layout.notes, nodeIcon: layout.nodeIcon, nodeLabel: layout.nodeLabel };
  state.scenesById[scene.id] = scene;
  section.slideIds.push(id);
  state.sections.push(section);
  state.selectedSlideId = id;
  return state;
}
