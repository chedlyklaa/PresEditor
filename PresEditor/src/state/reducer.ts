import { A } from './actionTypes';
import { uid } from '../lib/id';
import { createSection } from '../lib/emptyState';
import { createSlideFromLayout } from '../lib/layouts';
import { nextPaletteColor } from '../lib/palette';
import { applyBgColorToHtml } from '../lib/slideBackground';
import { setThemeTokenInStyleBlock } from '../lib/paletteFromCss';
import { wrapHtmlAsScene } from '../scene/legacyHtmlAdapter';
import { DIAGRAM_TEMPLATES } from '../lib/diagramTemplates';
import { buildSectionFromTemplate } from '../lib/sectionTemplates';
import { spliceNodeIntoEdges, removeNodeFromEdges } from '../lib/edgeGraph';
import {
  createTextObject,
  createShapeObject,
  createIconObject,
  createImageObject,
  createComponentInstanceObject,
  createDiagramNodeObject,
  createConnectorObject,
  createChartObject,
  createTableObject,
  createScene,
} from '../scene/objectDefaults';
import type { EditorState, SectionMeta, Slide, Edge } from '../types/state';
import type { LegacyHtmlObject, Scene, SceneObject, BackgroundSpec, ComponentInstanceObject } from '../types/scene';

function findLocation(state: EditorState, slideId: string) {
  for (const sec of state.sections) {
    const i = sec.slideIds.indexOf(slideId);
    if (i > -1) return { kind: 'section' as const, sectionId: sec.id, index: i };
  }
  const qi = state.qaSlideIds.indexOf(slideId);
  if (qi > -1) return { kind: 'qa' as const, index: qi };
  return null;
}

function flattenAllSlideIds(state: EditorState): string[] {
  return state.sections.flatMap((s) => s.slideIds).concat(state.qaSlideIds);
}

function firstSlideId(state: EditorState): string | null {
  return state.sections.flatMap((s) => s.slideIds)[0] || state.qaSlideIds[0] || null;
}

// Deep-clones a scene with fresh scene *and* object ids — used whenever a
// slide (and therefore its pages/scenes) is duplicated, so the copy never
// shares a scene reference with the original (editing one would otherwise
// silently mutate the other, since both would point at the same entry in
// scenesById).
function cloneScene(scene: Scene): Scene {
  const objectsById: Record<string, SceneObject> = {};
  const objectOrder: string[] = [];
  scene.objectOrder.forEach((oldId) => {
    const obj = scene.objectsById[oldId];
    if (!obj) return;
    const newId = uid('obj');
    objectsById[newId] = { ...obj, id: newId, data: { ...obj.data } } as SceneObject;
    objectOrder.push(newId);
  });
  return { id: uid('scene'), objectsById, objectOrder, background: scene.background ?? null };
}

// zIndex is a display-only mirror of an object's position in objectOrder
// (the single source of truth for paint order — see renderScene.ts).
// Called after any mutation that changes objectOrder, so the inspector's
// "layer position" and future layers-panel numbering stay meaningful
// without a second authoritative ordering to keep in sync by hand.
function withSyncedZIndex(scene: Scene): Scene {
  const objectsById: Record<string, SceneObject> = { ...scene.objectsById };
  scene.objectOrder.forEach((id, i) => {
    const obj = objectsById[id];
    if (obj && obj.zIndex !== i) objectsById[id] = { ...obj, zIndex: i };
  });
  return { ...scene, objectsById };
}

function findLegacyObjectId(scene: Scene | undefined): string | null {
  if (!scene) return null;
  return scene.objectOrder.find((id) => scene.objectsById[id]?.type === 'legacy-html') ?? null;
}

// Every branch below returns a *new* state object/array — the store is the
// single source of truth and nothing here mutates the previous state
// in place, so React only re-renders the parts of the tree whose slice of
// state actually changed.
export function editorReducer(state: EditorState, action: any): EditorState {
  switch (action.type) {
    case A.IMPORT_STATE:
      return action.payload;

    case A.SET_TITLE:
      return { ...state, meta: { ...state.meta, title: action.title } };

    case A.ADD_SECTION: {
      const section = createSection('Nouvelle section', state.sections.length);
      return { ...state, sections: [...state.sections, section] };
    }

    case A.RENAME_SECTION: {
      return {
        ...state,
        sections: state.sections.map((s) => (s.id === action.sectionId ? { ...s, label: action.label } : s)),
      };
    }

    case A.CYCLE_SECTION_COLOR: {
      return {
        ...state,
        sections: state.sections.map((s) => {
          if (s.id !== action.sectionId) return s;
          const next = nextPaletteColor(s.color);
          return { ...s, color: next.color, tint: next.tint, border: next.border };
        }),
      };
    }

    case A.TOGGLE_SECTION_COLLAPSE: {
      return {
        ...state,
        sections: state.sections.map((s) => (s.id === action.sectionId ? { ...s, collapsed: !s.collapsed } : s)),
      };
    }

    case A.MOVE_SECTION: {
      const i = state.sections.findIndex((s) => s.id === action.sectionId);
      if (i === -1) return state;
      const to = i + action.dir;
      if (to < 0 || to >= state.sections.length) return state;
      const sections = state.sections.slice();
      const [sec] = sections.splice(i, 1);
      sections.splice(to, 0, sec);
      return { ...state, sections };
    }

    case A.DELETE_SECTION: {
      const section = state.sections.find((s: SectionMeta) => s.id === action.sectionId);
      if (!section) return state;
      const slidesById = { ...state.slidesById };
      const scenesById = { ...state.scenesById };
      section.slideIds.forEach((id: string) => {
        slidesById[id]?.pages.forEach((sceneId) => delete scenesById[sceneId]);
        delete slidesById[id];
      });
      const sections = state.sections.filter((s) => s.id !== action.sectionId);
      let selectedSlideId = state.selectedSlideId;
      if (selectedSlideId && section.slideIds.includes(selectedSlideId)) {
        selectedSlideId = sections.flatMap((s) => s.slideIds)[0] || state.qaSlideIds[0] || null;
      }
      // Milestone D: one deleted node at a time so the "exactly 1 in/1 out"
      // auto-heal (removeNodeFromEdges) can still reconnect a surviving
      // chain around a contiguous deleted range, same as deleting several
      // slides individually would.
      const edges = section.slideIds.reduce((acc, id) => removeNodeFromEdges(acc, id), state.edges);
      return { ...state, sections, slidesById, scenesById, selectedSlideId, selectedPage: 0, selection: null, edges };
    }

    case A.TOGGLE_QA_COLLAPSE:
      return { ...state, qaCollapsed: !state.qaCollapsed };

    case A.ADD_SLIDE: {
      const layout = createSlideFromLayout(action.layoutKey);
      const scene = wrapHtmlAsScene(layout.pages[0]);
      const id = uid('slide');
      const slide: Slide = { id, cls: layout.cls, pages: [scene.id], notes: layout.notes, nodeIcon: layout.nodeIcon, nodeLabel: layout.nodeLabel };
      const slidesById = { ...state.slidesById, [id]: slide };
      const scenesById = { ...state.scenesById, [scene.id]: scene };
      if (action.targetSectionId === '__qa__') {
        const qaSlideIds = state.qaSlideIds.slice();
        const at = action.atIndex == null ? qaSlideIds.length : action.atIndex;
        qaSlideIds.splice(at, 0, id);
        return { ...state, slidesById, scenesById, qaSlideIds, selectedSlideId: id, selectedPage: 0, selection: null };
      }
      let targetSectionId = action.targetSectionId;
      let sections = state.sections;
      if (!sections.find((s) => s.id === targetSectionId)) {
        if (sections.length === 0) {
          const section = createSection('Section 1', 0);
          sections = [section];
          targetSectionId = section.id;
        } else {
          targetSectionId = sections[0].id;
        }
      }
      sections = sections.map((s) => {
        if (s.id !== targetSectionId) return s;
        const slideIds = s.slideIds.slice();
        const at = action.atIndex == null ? slideIds.length : action.atIndex;
        slideIds.splice(at, 0, id);
        return { ...s, slideIds };
      });
      // Milestone D: splice the new node into the chain at its actual
      // flattened (cross-section) insertion point, exactly reproducing what
      // the old implicit i,i+1 edge model did automatically.
      const flatAfterAdd = sections.flatMap((s) => s.slideIds);
      const insertedAt = flatAfterAdd.indexOf(id);
      const edges = spliceNodeIntoEdges(
        state.edges,
        insertedAt > 0 ? flatAfterAdd[insertedAt - 1] : null,
        id,
        insertedAt < flatAfterAdd.length - 1 ? flatAfterAdd[insertedAt + 1] : null
      );
      return { ...state, sections, slidesById, scenesById, selectedSlideId: id, selectedPage: 0, selection: null, edges };
    }

    case A.DUPLICATE_SLIDE: {
      const loc = findLocation(state, action.slideId);
      if (!loc) return state;
      const orig = state.slidesById[action.slideId];
      const scenesById = { ...state.scenesById };
      const newPages = orig.pages.map((sceneId) => {
        const cloned = cloneScene(state.scenesById[sceneId]);
        scenesById[cloned.id] = cloned;
        return cloned.id;
      });
      const copyId = uid('slide');
      const copy: Slide = { ...orig, id: copyId, pages: newPages };
      const slidesById = { ...state.slidesById, [copyId]: copy };
      if (loc.kind === 'qa') {
        const qaSlideIds = state.qaSlideIds.slice();
        qaSlideIds.splice(loc.index + 1, 0, copyId);
        return { ...state, slidesById, scenesById, qaSlideIds, selectedSlideId: copyId, selectedPage: 0, selection: null };
      }
      const sections = state.sections.map((s) => {
        if (s.id !== loc.sectionId) return s;
        const slideIds = s.slideIds.slice();
        slideIds.splice(loc.index + 1, 0, copyId);
        return { ...s, slideIds };
      });
      // Milestone D: same splice-into-the-flattened-chain reasoning as
      // ADD_SLIDE above.
      const flatAfterDup = sections.flatMap((s) => s.slideIds);
      const dupAt = flatAfterDup.indexOf(copyId);
      const edges = spliceNodeIntoEdges(
        state.edges,
        dupAt > 0 ? flatAfterDup[dupAt - 1] : null,
        copyId,
        dupAt < flatAfterDup.length - 1 ? flatAfterDup[dupAt + 1] : null
      );
      return { ...state, sections, slidesById, scenesById, selectedSlideId: copyId, selectedPage: 0, selection: null, edges };
    }

    case A.DELETE_SLIDE: {
      const loc = findLocation(state, action.slideId);
      if (!loc) return state;
      const slidesById = { ...state.slidesById };
      const scenesById = { ...state.scenesById };
      slidesById[action.slideId]?.pages.forEach((sceneId) => delete scenesById[sceneId]);
      delete slidesById[action.slideId];
      let sections = state.sections;
      let qaSlideIds = state.qaSlideIds;
      if (loc.kind === 'qa') {
        qaSlideIds = qaSlideIds.filter((id) => id !== action.slideId);
      } else {
        sections = sections.map((s) =>
          s.id === loc.sectionId ? { ...s, slideIds: s.slideIds.filter((id) => id !== action.slideId) } : s
        );
      }
      let selectedSlideId = state.selectedSlideId;
      let selectedPage = state.selectedPage;
      let selection = state.selection;
      if (selectedSlideId === action.slideId) {
        selectedSlideId = sections.flatMap((s) => s.slideIds)[0] || qaSlideIds[0] || null;
        selectedPage = 0;
        selection = null;
      }
      // Milestone D: QA slides never have edges (they're not in NODE_META),
      // so only a main-deck deletion touches the graph.
      const edges = loc.kind === 'qa' ? state.edges : removeNodeFromEdges(state.edges, action.slideId);
      return { ...state, sections, qaSlideIds, slidesById, scenesById, selectedSlideId, selectedPage, selection, edges };
    }

    case A.MOVE_SLIDE: {
      const loc = findLocation(state, action.slideId);
      if (!loc) return state;
      if (loc.kind === 'qa') {
        const to = loc.index + action.dir;
        if (to < 0 || to >= state.qaSlideIds.length) return state;
        const qaSlideIds = state.qaSlideIds.slice();
        const [it] = qaSlideIds.splice(loc.index, 1);
        qaSlideIds.splice(to, 0, it);
        return { ...state, qaSlideIds };
      }
      const sections = state.sections.map((s) => {
        if (s.id !== loc.sectionId) return s;
        const to = loc.index + action.dir;
        if (to < 0 || to >= s.slideIds.length) return s;
        const slideIds = s.slideIds.slice();
        const [it] = slideIds.splice(loc.index, 1);
        slideIds.splice(to, 0, it);
        return { ...s, slideIds };
      });
      return { ...state, sections };
    }

    case A.RELOCATE_SLIDE: {
      const loc = findLocation(state, action.slideId);
      if (!loc) return state;
      let sections = state.sections;
      let qaSlideIds = state.qaSlideIds;

      if (loc.kind === 'qa') qaSlideIds = qaSlideIds.filter((id) => id !== action.slideId);
      else
        sections = sections.map((s) =>
          s.id === loc.sectionId ? { ...s, slideIds: s.slideIds.filter((id) => id !== action.slideId) } : s
        );

      if (action.targetSectionId === '__qa__') {
        qaSlideIds = qaSlideIds.slice();
        const at = action.targetIndex == null ? qaSlideIds.length : Math.min(action.targetIndex, qaSlideIds.length);
        qaSlideIds.splice(at, 0, action.slideId);
      } else {
        sections = sections.map((s) => {
          if (s.id !== action.targetSectionId) return s;
          const slideIds = s.slideIds.slice();
          const at = action.targetIndex == null ? slideIds.length : Math.min(action.targetIndex, slideIds.length);
          slideIds.splice(at, 0, action.slideId);
          return { ...s, slideIds };
        });
      }

      const slide = state.slidesById[action.slideId];
      let slidesById = state.slidesById;
      if (action.targetSectionId === '__qa__') {
        slidesById = { ...slidesById, [action.slideId]: { ...slide, nodeIcon: null, nodeLabel: null } };
      } else if (!slide.nodeIcon) {
        slidesById = {
          ...slidesById,
          [action.slideId]: { ...slide, nodeIcon: 'clipboard', nodeLabel: slide.nodeLabel || 'Diapositive' },
        };
      }

      // Milestone D: relocating *within* the main deck (any section to any
      // section/index) deliberately leaves edges untouched — decoupling
      // graph position from graph topology is the entire point of this
      // milestone, so dragging a node in the new overview editor must never
      // silently rewire what it's connected to. Only leaving the main deck
      // entirely (into '__qa__') removes it from the graph, same as
      // DELETE_SLIDE — a slide moving *into* a section from QA is left
      // edge-less (an isolated node) rather than guessed into a position in
      // the chain, since unlike ADD_SLIDE there's no "old implicit
      // behavior" to reproduce for a slide that never had graph edges.
      const edges =
        action.targetSectionId === '__qa__' && loc.kind !== 'qa' ? removeNodeFromEdges(state.edges, action.slideId) : state.edges;

      return { ...state, sections, qaSlideIds, slidesById, edges };
    }

    case A.SELECT_SLIDE:
      return { ...state, selectedSlideId: action.slideId, selectedPage: action.page || 0, selection: null };

    case A.SELECT_PAGE:
      return { ...state, selectedPage: action.page, selection: null };

    case A.ADD_PAGE: {
      const slide = state.slidesById[action.slideId];
      if (!slide) return state;
      const scene = wrapHtmlAsScene(createSlideFromLayout('blank').pages[0]);
      const pages = [...slide.pages, scene.id];
      return {
        ...state,
        slidesById: { ...state.slidesById, [action.slideId]: { ...slide, pages } },
        scenesById: { ...state.scenesById, [scene.id]: scene },
        selectedPage: pages.length - 1,
        selection: null,
      };
    }

    case A.DELETE_PAGE: {
      const slide = state.slidesById[action.slideId];
      if (!slide || slide.pages.length <= 1) return state;
      const removedSceneId = slide.pages[action.pageIndex];
      const pages = slide.pages.filter((_, i) => i !== action.pageIndex);
      const scenesById = { ...state.scenesById };
      delete scenesById[removedSceneId];
      return {
        ...state,
        slidesById: { ...state.slidesById, [action.slideId]: { ...slide, pages } },
        scenesById,
        selectedPage: Math.max(0, Math.min(state.selectedPage, pages.length - 1)),
        selection: null,
      };
    }

    case A.UPDATE_SLIDE_NOTES: {
      const slide = state.slidesById[action.slideId];
      if (!slide) return state;
      return { ...state, slidesById: { ...state.slidesById, [action.slideId]: { ...slide, notes: action.notes } } };
    }

    case A.UPDATE_SLIDE_BG: {
      const slide = state.slidesById[action.slideId];
      if (!slide) return state;
      return { ...state, slidesById: { ...state.slidesById, [action.slideId]: { ...slide, cls: action.cls } } };
    }

    case A.UPDATE_SLIDE_BG_COLOR: {
      // The color isn't a separate field — it's baked into the legacy
      // object's own HTML (see lib/slideBackground.js) so there's exactly
      // one source of truth for what a slide looks like, and it survives
      // export/reimport without the engine needing to know about it. Each
      // page's scene carries its own legacy object, so the color is
      // applied per-page, same as before scenes existed.
      const slide = state.slidesById[action.slideId];
      if (!slide) return state;
      let scenesById = state.scenesById;
      slide.pages.forEach((sceneId) => {
        const scene = scenesById[sceneId];
        const legacyId = findLegacyObjectId(scene);
        if (!scene || !legacyId) return;
        const obj = scene.objectsById[legacyId] as LegacyHtmlObject;
        const html = applyBgColorToHtml(obj.data.html, action.color);
        scenesById = {
          ...scenesById,
          [sceneId]: { ...scene, objectsById: { ...scene.objectsById, [legacyId]: { ...obj, data: { html } } } },
        };
      });
      return { ...state, scenesById };
    }

    case A.UPDATE_SLIDE_NODE_ICON: {
      const slide = state.slidesById[action.slideId];
      if (!slide) return state;
      return {
        ...state,
        slidesById: { ...state.slidesById, [action.slideId]: { ...slide, nodeIcon: action.icon } },
      };
    }

    case A.UPDATE_SLIDE_NODE_LABEL: {
      const slide = state.slidesById[action.slideId];
      if (!slide) return state;
      return {
        ...state,
        slidesById: { ...state.slidesById, [action.slideId]: { ...slide, nodeLabel: action.label } },
      };
    }

    case A.TOGGLE_NOTES:
      return { ...state, notesOpen: !state.notesOpen };

    // ---- Scene/object actions (Presentation Studio, Milestone 1) ----

    case A.SET_SELECTION:
      return { ...state, selection: action.objectIds.length ? { sceneId: action.sceneId, objectIds: action.objectIds } : null };

    case A.ADD_OBJECT: {
      const scene = state.scenesById[action.sceneId];
      if (!scene) return state;
      const z = scene.objectOrder.length;
      let obj: SceneObject | null = null;
      if (action.objectType === 'text') obj = createTextObject(action.partial, z);
      else if (action.objectType === 'shape') obj = createShapeObject(action.partial, z);
      else if (action.objectType === 'icon') obj = createIconObject(action.partial, z);
      else if (action.objectType === 'image') obj = createImageObject(action.partial?.data?.src || '', action.partial, z);
      else if (action.objectType === 'diagram-node') obj = createDiagramNodeObject(action.partial, z);
      else if (action.objectType === 'chart') obj = createChartObject(action.partial, z);
      else if (action.objectType === 'table') obj = createTableObject(action.partial, z);
      if (!obj) return state;
      const updated = withSyncedZIndex({
        ...scene,
        objectsById: { ...scene.objectsById, [obj.id]: obj },
        objectOrder: [...scene.objectOrder, obj.id],
      });
      return {
        ...state,
        scenesById: { ...state.scenesById, [action.sceneId]: updated },
        selection: { sceneId: action.sceneId, objectIds: [obj.id] },
      };
    }

    case A.DELETE_OBJECT: {
      const scene = state.scenesById[action.sceneId];
      if (!scene || !scene.objectsById[action.objectId]) return state;
      const objectsById = { ...scene.objectsById };
      delete objectsById[action.objectId];
      const objectOrder = scene.objectOrder.filter((id) => id !== action.objectId);
      const updated = withSyncedZIndex({ ...scene, objectsById, objectOrder });
      const currentSelection = state.selection;
      const selection =
        currentSelection && currentSelection.sceneId === action.sceneId
          ? { sceneId: action.sceneId, objectIds: currentSelection.objectIds.filter((id) => id !== action.objectId) }
          : currentSelection;
      return {
        ...state,
        scenesById: { ...state.scenesById, [action.sceneId]: updated },
        selection: selection && selection.objectIds.length ? selection : null,
      };
    }

    case A.DUPLICATE_OBJECT: {
      const scene = state.scenesById[action.sceneId];
      const obj = scene?.objectsById[action.objectId];
      if (!scene || !obj) return state;
      const newId = uid('obj');
      // groupId cleared: a single duplicated-out object becomes standalone
      // rather than silently rejoining the original group (see
      // DUPLICATE_OBJECTS below for the multi-select case, which *does*
      // preserve grouping — duplicating a whole group forms its own new
      // group, which is a different, deliberate behavior).
      const copy = { ...obj, id: newId, x: obj.x + 16, y: obj.y + 16, groupId: null, data: { ...obj.data } } as SceneObject;
      const updated = withSyncedZIndex({
        ...scene,
        objectsById: { ...scene.objectsById, [newId]: copy },
        objectOrder: [...scene.objectOrder, newId],
      });
      return {
        ...state,
        scenesById: { ...state.scenesById, [action.sceneId]: updated },
        selection: { sceneId: action.sceneId, objectIds: [newId] },
      };
    }

    // "Détacher en objets" (LayersPanel.tsx): replaces one legacy-html/text
    // object with several native objects the caller already built by
    // measuring the *live* rendered DOM (lib/detachLegacyObject.ts —
    // reducer.ts has no DOM access, so `action.objects` arrives pre-built).
    // Takes the removed object's slot in objectOrder so z-order among
    // whatever's left doesn't otherwise shuffle — same pattern
    // CREATE_COMPONENT_FROM_SELECTION uses below.
    case A.DETACH_OBJECT: {
      const scene = state.scenesById[action.sceneId];
      const obj = scene?.objectsById[action.objectId];
      if (!scene || !obj || (obj.type !== 'legacy-html' && obj.type !== 'text')) return state;
      const newObjects = action.objects as SceneObject[];
      if (!newObjects || newObjects.length < 2) return state;
      const idx = scene.objectOrder.indexOf(action.objectId);
      const objectsById = { ...scene.objectsById };
      delete objectsById[action.objectId];
      newObjects.forEach((o) => {
        objectsById[o.id] = o;
      });
      const objectOrder = scene.objectOrder.filter((id) => id !== action.objectId);
      objectOrder.splice(idx, 0, ...newObjects.map((o) => o.id));
      const updated = withSyncedZIndex({ ...scene, objectsById, objectOrder });
      return {
        ...state,
        scenesById: { ...state.scenesById, [action.sceneId]: updated },
        selection: { sceneId: action.sceneId, objectIds: newObjects.map((o) => o.id) },
      };
    }

    case A.UPDATE_OBJECT_TRANSFORM: {
      const scene = state.scenesById[action.sceneId];
      const obj = scene?.objectsById[action.objectId];
      if (!scene || !obj) return state;
      const updatedObj = { ...obj, ...action.patch };
      return {
        ...state,
        scenesById: {
          ...state.scenesById,
          [action.sceneId]: { ...scene, objectsById: { ...scene.objectsById, [action.objectId]: updatedObj } },
        },
      };
    }

    case A.UPDATE_OBJECT_DATA: {
      const scene = state.scenesById[action.sceneId];
      const obj = scene?.objectsById[action.objectId];
      if (!scene || !obj) return state;
      const updatedObj = { ...obj, data: { ...obj.data, ...action.dataPatch } };
      return {
        ...state,
        scenesById: {
          ...state.scenesById,
          [action.sceneId]: { ...scene, objectsById: { ...scene.objectsById, [action.objectId]: updatedObj } },
        },
      };
    }

    case A.REORDER_OBJECT_Z: {
      const scene = state.scenesById[action.sceneId];
      if (!scene) return state;
      const i = scene.objectOrder.indexOf(action.objectId);
      if (i === -1) return state;
      const to = action.toFront ? scene.objectOrder.length - 1 : action.toBack ? 0 : i + action.dir;
      if (to < 0 || to >= scene.objectOrder.length || to === i) return state;
      const objectOrder = scene.objectOrder.slice();
      const [id] = objectOrder.splice(i, 1);
      objectOrder.splice(to, 0, id);
      const updated = withSyncedZIndex({ ...scene, objectOrder });
      return { ...state, scenesById: { ...state.scenesById, [action.sceneId]: updated } };
    }

    // ---- Multi-object actions (Presentation Studio, Milestone 2) ----

    case A.UPDATE_OBJECTS_TRANSFORM: {
      const scene = state.scenesById[action.sceneId];
      if (!scene) return state;
      const objectsById = { ...scene.objectsById };
      let changed = false;
      Object.entries(action.patches as Record<string, object>).forEach(([id, patch]) => {
        const obj = objectsById[id];
        if (obj) {
          objectsById[id] = { ...obj, ...patch };
          changed = true;
        }
      });
      if (!changed) return state;
      return { ...state, scenesById: { ...state.scenesById, [action.sceneId]: { ...scene, objectsById } } };
    }

    case A.DELETE_OBJECTS: {
      const scene = state.scenesById[action.sceneId];
      if (!scene) return state;
      const idSet = new Set<string>(action.objectIds);
      const objectsById = { ...scene.objectsById };
      let changed = false;
      action.objectIds.forEach((id: string) => {
        if (objectsById[id]) {
          delete objectsById[id];
          changed = true;
        }
      });
      if (!changed) return state;
      const objectOrder = scene.objectOrder.filter((id) => !idSet.has(id));
      const updated = withSyncedZIndex({ ...scene, objectsById, objectOrder });
      const currentSelection = state.selection;
      const selection =
        currentSelection && currentSelection.sceneId === action.sceneId
          ? { sceneId: action.sceneId, objectIds: currentSelection.objectIds.filter((id) => !idSet.has(id)) }
          : currentSelection;
      return {
        ...state,
        scenesById: { ...state.scenesById, [action.sceneId]: updated },
        selection: selection && selection.objectIds.length ? selection : null,
      };
    }

    case A.DUPLICATE_OBJECTS: {
      const scene = state.scenesById[action.sceneId];
      if (!scene) return state;
      const objectsById = { ...scene.objectsById };
      const objectOrder = scene.objectOrder.slice();
      const newIds: string[] = [];
      // A duplicated set that shares a common group forms its own new
      // group (remapped, not rejoining the original) — see the note on
      // the single-object DUPLICATE_OBJECT above for why this differs
      // from that case.
      const groupRemap = new Map<string, string>();
      const positionOverrides = (action.positionOverrides ?? {}) as Record<string, { x: number; y: number }>;
      (action.objectIds as string[]).forEach((oldId) => {
        const obj = scene.objectsById[oldId];
        if (!obj) return;
        const newId = uid('obj');
        let newGroupId: string | null = null;
        if (obj.groupId) {
          if (!groupRemap.has(obj.groupId)) groupRemap.set(obj.groupId, uid('group'));
          newGroupId = groupRemap.get(obj.groupId)!;
        }
        const override = positionOverrides[oldId];
        const copy = {
          ...obj,
          id: newId,
          groupId: newGroupId,
          x: override ? override.x : obj.x + 16,
          y: override ? override.y : obj.y + 16,
          data: { ...obj.data },
        } as SceneObject;
        objectsById[newId] = copy;
        objectOrder.push(newId);
        newIds.push(newId);
      });
      if (newIds.length === 0) return state;
      const updated = withSyncedZIndex({ ...scene, objectsById, objectOrder });
      return {
        ...state,
        scenesById: { ...state.scenesById, [action.sceneId]: updated },
        selection: { sceneId: action.sceneId, objectIds: newIds },
      };
    }

    case A.GROUP_OBJECTS: {
      const scene = state.scenesById[action.sceneId];
      const ids = (action.objectIds as string[]).filter((id) => scene?.objectsById[id]);
      if (!scene || ids.length < 2) return state;
      const groupId = uid('group');
      const objectsById = { ...scene.objectsById };
      ids.forEach((id) => {
        objectsById[id] = { ...objectsById[id], groupId };
      });
      return {
        ...state,
        scenesById: { ...state.scenesById, [action.sceneId]: { ...scene, objectsById } },
        selection: { sceneId: action.sceneId, objectIds: ids },
      };
    }

    case A.UNGROUP_OBJECTS: {
      const scene = state.scenesById[action.sceneId];
      if (!scene) return state;
      const objectsById = { ...scene.objectsById };
      const memberIds: string[] = [];
      scene.objectOrder.forEach((id) => {
        const obj = objectsById[id];
        if (obj && obj.groupId === action.groupId) {
          objectsById[id] = { ...obj, groupId: null };
          memberIds.push(id);
        }
      });
      if (memberIds.length === 0) return state;
      return {
        ...state,
        scenesById: { ...state.scenesById, [action.sceneId]: { ...scene, objectsById } },
        selection: { sceneId: action.sceneId, objectIds: memberIds },
      };
    }

    case A.ALIGN_OBJECTS: {
      const scene = state.scenesById[action.sceneId];
      if (!scene) return state;
      const objs = (action.objectIds as string[]).map((id) => scene.objectsById[id]).filter(Boolean) as SceneObject[];
      if (objs.length < 2) return state;
      const minX = Math.min(...objs.map((o) => o.x));
      const maxX = Math.max(...objs.map((o) => o.x + o.width));
      const minY = Math.min(...objs.map((o) => o.y));
      const maxY = Math.max(...objs.map((o) => o.y + o.height));
      const objectsById = { ...scene.objectsById };
      objs.forEach((obj) => {
        let patch: Partial<{ x: number; y: number }> = {};
        switch (action.edge) {
          case 'left':
            patch = { x: minX };
            break;
          case 'centerX':
            patch = { x: minX + (maxX - minX) / 2 - obj.width / 2 };
            break;
          case 'right':
            patch = { x: maxX - obj.width };
            break;
          case 'top':
            patch = { y: minY };
            break;
          case 'centerY':
            patch = { y: minY + (maxY - minY) / 2 - obj.height / 2 };
            break;
          case 'bottom':
            patch = { y: maxY - obj.height };
            break;
          default:
            return;
        }
        objectsById[obj.id] = { ...obj, ...patch };
      });
      return { ...state, scenesById: { ...state.scenesById, [action.sceneId]: { ...scene, objectsById } } };
    }

    case A.DISTRIBUTE_OBJECTS: {
      const scene = state.scenesById[action.sceneId];
      if (!scene) return state;
      const objs = (action.objectIds as string[]).map((id) => scene.objectsById[id]).filter(Boolean) as SceneObject[];
      if (objs.length < 3) return state;
      const isH = action.axis === 'horizontal';
      const sorted = objs.slice().sort((a, b) => (isH ? a.x - b.x : a.y - b.y));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = isH ? last.x + last.width - first.x : last.y + last.height - first.y;
      const totalSize = sorted.reduce((sum, o) => sum + (isH ? o.width : o.height), 0);
      const gap = (totalSpan - totalSize) / (sorted.length - 1);
      if (!Number.isFinite(gap)) return state;
      const objectsById = { ...scene.objectsById };
      let cursor = isH ? first.x : first.y;
      sorted.forEach((obj, i) => {
        const size = isH ? obj.width : obj.height;
        if (i > 0 && i < sorted.length - 1) {
          objectsById[obj.id] = isH ? { ...obj, x: cursor } : { ...obj, y: cursor };
        }
        cursor += size + gap;
      });
      return { ...state, scenesById: { ...state.scenesById, [action.sceneId]: { ...scene, objectsById } } };
    }

    // ---- Backgrounds & theme (Presentation Studio, Milestone 4) ----

    case A.UPDATE_SCENE_BACKGROUND: {
      const scene = state.scenesById[action.sceneId];
      if (!scene) return state;
      const background = action.background as BackgroundSpec | null;
      return { ...state, scenesById: { ...state.scenesById, [action.sceneId]: { ...scene, background } } };
    }

    case A.UPDATE_SECTION_BACKGROUND: {
      const background = action.background as BackgroundSpec | null;
      return {
        ...state,
        sections: state.sections.map((s) => (s.id === action.sectionId ? { ...s, defaultBackground: background } : s)),
      };
    }

    case A.UPDATE_DECK_BACKGROUND: {
      const background = action.background as BackgroundSpec | null;
      return { ...state, meta: { ...state.meta, defaultBackground: background } };
    }

    case A.UPDATE_THEME_TOKEN: {
      const styleBlock = setThemeTokenInStyleBlock(state.meta.styleBlock, action.varName, action.value);
      return { ...state, meta: { ...state.meta, styleBlock } };
    }

    // ---- Master slides & reusable components (Presentation Studio, Milestone 5) ----
    // Both are ordinary Slide+Scene pairs living in masterSlideIds/
    // componentSlideIds instead of a section's slideIds or qaSlideIds —
    // see types/state.ts's EditorState doc comment for why that's enough
    // to keep them out of the real deck/export automatically.

    case A.ADD_MASTER_SLIDE: {
      const scene = createScene([]);
      const id = uid('slide');
      const slide: Slide = { id, cls: 'slide-light', pages: [scene.id], notes: '', nodeIcon: null, nodeLabel: 'Nouveau modèle' };
      return {
        ...state,
        slidesById: { ...state.slidesById, [id]: slide },
        scenesById: { ...state.scenesById, [scene.id]: scene },
        masterSlideIds: [...state.masterSlideIds, id],
        selectedSlideId: id,
        selectedPage: 0,
        selection: null,
      };
    }

    case A.DELETE_MASTER_SLIDE: {
      const id = action.masterSlideId as string;
      if (!state.masterSlideIds.includes(id)) return state;
      const slide = state.slidesById[id];
      const slidesById = { ...state.slidesById };
      const scenesById = { ...state.scenesById };
      slide?.pages.forEach((sceneId) => delete scenesById[sceneId]);
      delete slidesById[id];
      const masterSlideIds = state.masterSlideIds.filter((mid) => mid !== id);
      const sections = state.sections.map((s) => (s.masterSlideId === id ? { ...s, masterSlideId: null } : s));
      const meta = state.meta.defaultMasterSlideId === id ? { ...state.meta, defaultMasterSlideId: null } : state.meta;
      let selectedSlideId = state.selectedSlideId;
      let selection = state.selection;
      if (selectedSlideId === id) {
        selectedSlideId = firstSlideId(state);
        selection = null;
      }
      return { ...state, slidesById, scenesById, masterSlideIds, sections, meta, selectedSlideId, selection };
    }

    case A.SET_SECTION_MASTER: {
      const masterSlideId = action.masterSlideId as string | null;
      return {
        ...state,
        sections: state.sections.map((s) => (s.id === action.sectionId ? { ...s, masterSlideId } : s)),
      };
    }

    case A.SET_DECK_MASTER: {
      return { ...state, meta: { ...state.meta, defaultMasterSlideId: action.masterSlideId as string | null } };
    }

    case A.ADD_COMPONENT: {
      const scene = createScene([]);
      const id = uid('slide');
      const slide: Slide = { id, cls: 'slide-light', pages: [scene.id], notes: '', nodeIcon: null, nodeLabel: 'Nouveau composant' };
      return {
        ...state,
        slidesById: { ...state.slidesById, [id]: slide },
        scenesById: { ...state.scenesById, [scene.id]: scene },
        componentSlideIds: [...state.componentSlideIds, id],
        selectedSlideId: id,
        selectedPage: 0,
        selection: null,
      };
    }

    case A.DELETE_COMPONENT: {
      // Instances of this component still on other slides aren't scrubbed
      // — they simply render nothing (see renderScene.ts's
      // renderComponentInstanceObject's `!comp` fallback) rather than the
      // deck-wide sweep a full cleanup would need. A known, disclosed
      // limitation of this first pass.
      const id = action.componentSlideId as string;
      if (!state.componentSlideIds.includes(id)) return state;
      const slide = state.slidesById[id];
      const slidesById = { ...state.slidesById };
      const scenesById = { ...state.scenesById };
      slide?.pages.forEach((sceneId) => delete scenesById[sceneId]);
      delete slidesById[id];
      const componentSlideIds = state.componentSlideIds.filter((cid) => cid !== id);
      let selectedSlideId = state.selectedSlideId;
      let selection = state.selection;
      if (selectedSlideId === id) {
        selectedSlideId = firstSlideId(state);
        selection = null;
      }
      return { ...state, slidesById, scenesById, componentSlideIds, selectedSlideId, selection };
    }

    case A.INSERT_COMPONENT_INSTANCE: {
      const scene = state.scenesById[action.sceneId];
      const compSlide = state.slidesById[action.componentSlideId];
      const compScene = compSlide ? state.scenesById[compSlide.pages[0]] : null;
      if (!scene || !compScene) return state;
      const compObjects = compScene.objectOrder.map((id) => compScene.objectsById[id]).filter(Boolean) as SceneObject[];
      let rect = { x: 460, y: 300, width: 300, height: 200 };
      if (compObjects.length) {
        const minX = Math.min(...compObjects.map((o) => o.x));
        const minY = Math.min(...compObjects.map((o) => o.y));
        const maxX = Math.max(...compObjects.map((o) => o.x + o.width));
        const maxY = Math.max(...compObjects.map((o) => o.y + o.height));
        rect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      }
      const instance = createComponentInstanceObject(action.componentSlideId, rect, scene.objectOrder.length);
      const updated = withSyncedZIndex({
        ...scene,
        objectsById: { ...scene.objectsById, [instance.id]: instance },
        objectOrder: [...scene.objectOrder, instance.id],
      });
      return {
        ...state,
        scenesById: { ...state.scenesById, [action.sceneId]: updated },
        selection: { sceneId: action.sceneId, objectIds: [instance.id] },
      };
    }

    case A.CREATE_COMPONENT_FROM_SELECTION: {
      const scene = state.scenesById[action.sceneId];
      if (!scene) return state;
      const ids = (action.objectIds as string[]).filter((id) => scene.objectsById[id]);
      if (ids.length === 0) return state;

      const compObjectsById: Record<string, SceneObject> = {};
      const compObjectOrder: string[] = [];
      scene.objectOrder.forEach((id) => {
        if (ids.includes(id)) {
          compObjectsById[id] = scene.objectsById[id];
          compObjectOrder.push(id);
        }
      });
      const compScene: Scene = { id: uid('scene'), objectsById: compObjectsById, objectOrder: compObjectOrder, background: null };
      const compSlideId = uid('slide');
      const compSlide: Slide = {
        id: compSlideId,
        cls: 'slide-light',
        pages: [compScene.id],
        notes: '',
        nodeIcon: null,
        nodeLabel: (action.name as string) || 'Nouveau composant',
      };

      const compObjects = compObjectOrder.map((id) => compObjectsById[id]);
      const minX = Math.min(...compObjects.map((o) => o.x));
      const minY = Math.min(...compObjects.map((o) => o.y));
      const maxX = Math.max(...compObjects.map((o) => o.x + o.width));
      const maxY = Math.max(...compObjects.map((o) => o.y + o.height));
      const instance: ComponentInstanceObject = {
        id: uid('obj'),
        type: 'component-instance',
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        rotation: 0,
        zIndex: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        groupId: null,
        data: { componentSlideId: compSlideId },
      };

      // Instance takes the first removed object's slot, so z-order among
      // whatever's left doesn't otherwise shuffle.
      const firstIdx = scene.objectOrder.findIndex((id) => ids.includes(id));
      const objectsById = { ...scene.objectsById };
      ids.forEach((id) => delete objectsById[id]);
      objectsById[instance.id] = instance;
      const objectOrder = scene.objectOrder.filter((id) => !ids.includes(id));
      objectOrder.splice(firstIdx, 0, instance.id);
      const updatedHostScene = withSyncedZIndex({ ...scene, objectsById, objectOrder });

      return {
        ...state,
        scenesById: { ...state.scenesById, [action.sceneId]: updatedHostScene, [compScene.id]: compScene },
        slidesById: { ...state.slidesById, [compSlideId]: compSlide },
        componentSlideIds: [...state.componentSlideIds, compSlideId],
        selection: { sceneId: action.sceneId, objectIds: [instance.id] },
      };
    }

    // ---- Diagram builder (Presentation Studio, Milestone 6) ----

    case A.CREATE_CONNECTOR: {
      const scene = state.scenesById[action.sceneId];
      if (!scene) return state;
      const fromId = action.fromId as string;
      const toId = action.toId as string;
      if (fromId === toId || !scene.objectsById[fromId] || !scene.objectsById[toId]) return state;
      const connector = createConnectorObject(fromId, toId, scene.objectOrder.length);
      const updated = withSyncedZIndex({
        ...scene,
        objectsById: { ...scene.objectsById, [connector.id]: connector },
        objectOrder: [...scene.objectOrder, connector.id],
      });
      return {
        ...state,
        scenesById: { ...state.scenesById, [action.sceneId]: updated },
        selection: { sceneId: action.sceneId, objectIds: [connector.id] },
      };
    }

    case A.INSERT_DIAGRAM_TEMPLATE: {
      const scene = state.scenesById[action.sceneId];
      const template = (DIAGRAM_TEMPLATES as Record<string, { build: () => SceneObject[] }>)[action.templateKey as string];
      if (!scene || !template) return state;
      const newObjects = template.build();
      const objectsById = { ...scene.objectsById };
      const objectOrder = scene.objectOrder.slice();
      newObjects.forEach((obj) => {
        objectsById[obj.id] = obj;
        objectOrder.push(obj.id);
      });
      const updated = withSyncedZIndex({ ...scene, objectsById, objectOrder });
      return {
        ...state,
        scenesById: { ...state.scenesById, [action.sceneId]: updated },
        selection: { sceneId: action.sceneId, objectIds: newObjects.map((o) => o.id) },
      };
    }

    // ---- Asset library & presentation templates (Presentation Studio, Milestone 9) ----

    // The dedup decision (does an asset with this exact data: URL already
    // exist?) is made by the caller — EditorContext.tsx's registerAsset,
    // which reads current state synchronously to resolve the id *before*
    // dispatching, since the very next dispatch (ADD_OBJECT) needs that id
    // already in hand. This case is a plain, idempotent append.
    case A.ADD_ASSET: {
      const asset = action.asset;
      if (!asset || state.assetsById[asset.id]) return state;
      return {
        ...state,
        assetsById: { ...state.assetsById, [asset.id]: asset },
        assetOrder: [...state.assetOrder, asset.id],
      };
    }

    case A.DELETE_ASSET: {
      const id = action.assetId as string;
      if (!state.assetsById[id]) return state;
      const assetsById = { ...state.assetsById };
      delete assetsById[id];
      return { ...state, assetsById, assetOrder: state.assetOrder.filter((aid) => aid !== id) };
    }

    case A.ADD_SECTION_FROM_TEMPLATE: {
      const built = buildSectionFromTemplate(action.templateKey, state.sections.length);
      if (!built) return state;
      const slidesById = { ...state.slidesById };
      const scenesById = { ...state.scenesById };
      built.slides.forEach((s) => {
        slidesById[s.id] = s;
      });
      built.scenes.forEach((sc) => {
        scenesById[sc.id] = sc;
      });
      // Milestone D: chain the new section's own slides linearly, plus one
      // edge from the previously-last main slide into this section's first
      // — mirrors ADD_SLIDE's splice, just for N new nodes appended at the
      // very end of the flattened order in one go rather than one node
      // inserted mid-chain.
      const prevLastId = state.sections.flatMap((s) => s.slideIds).slice(-1)[0] ?? null;
      const newIds = built.slides.map((s) => s.id);
      const chainEdges: Edge[] = [];
      if (prevLastId && newIds.length) chainEdges.push({ id: uid('edge'), from: prevLastId, to: newIds[0] });
      for (let i = 0; i < newIds.length - 1; i++) {
        chainEdges.push({ id: uid('edge'), from: newIds[i], to: newIds[i + 1] });
      }
      return { ...state, sections: [...state.sections, built.section], slidesById, scenesById, edges: [...state.edges, ...chainEdges] };
    }

    // ---- Editable overview graph (Presentation Studio v2, Milestone D) ----
    // Both endpoints must be *main* slides (findLocation kind==='section' —
    // i.e. actually have a NODE_META entry) — a QA/master/component slide
    // isn't part of the exported graph at all, so an edge touching one
    // would be unrenderable. This is the *only* validation layer — unlike
    // deleteSlide's confirm-dialog pattern, EditorContext.tsx's
    // addEdge/redirectEdge are plain dispatch wrappers with nothing to
    // pre-check, so all of it lives here (same single-source-of-truth
    // shape CREATE_CONNECTOR, Milestone 6, already uses for its own
    // from/to validation).
    case A.ADD_EDGE: {
      const fromLoc = findLocation(state, action.fromSlideId);
      const toLoc = findLocation(state, action.toSlideId);
      if (!fromLoc || fromLoc.kind !== 'section' || !toLoc || toLoc.kind !== 'section') return state;
      if (action.fromSlideId === action.toSlideId) return state;
      if (state.edges.some((e) => e.from === action.fromSlideId && e.to === action.toSlideId)) return state;
      const edge: Edge = { id: uid('edge'), from: action.fromSlideId, to: action.toSlideId };
      return { ...state, edges: [...state.edges, edge] };
    }

    case A.DELETE_EDGE: {
      return { ...state, edges: state.edges.filter((e) => e.id !== action.edgeId) };
    }

    case A.REDIRECT_EDGE: {
      const newLoc = findLocation(state, action.newSlideId);
      if (!newLoc || newLoc.kind !== 'section') return state;
      const endpoint = action.endpoint as 'from' | 'to';
      return {
        ...state,
        edges: state.edges.map((e) => {
          if (e.id !== action.edgeId) return e;
          const updated: Edge = { ...e, [endpoint]: action.newSlideId };
          return updated.from === updated.to ? e : updated; // no self-loop
        }),
      };
    }

    default:
      return state;
  }
}

export function totalSlideCount(state: EditorState): number {
  return state.sections.reduce((n, s) => n + s.slideIds.length, 0) + state.qaSlideIds.length;
}

export { findLocation, flattenAllSlideIds, firstSlideId, findLegacyObjectId };
