import { wrapHtmlAsScene } from '../scene/legacyHtmlAdapter';
import { synthesizeLinearEdges } from './edgeGraph';

const LS_KEY = 'presEditor_state_v1';

// Before the Presentation Studio rewrite, `slide.pages` held raw HTML
// strings; it now holds Scene ids (see importPresentation.ts's
// wrapPagesAsScenes, which does the same migration on file import). A
// session saved to localStorage under the old shape still has raw HTML
// sitting in `pages`, and loading it verbatim makes Canvas/LayersPanel/
// ObjectInspector look it up in `scenesById` as if it were an id — which
// throws deep in React instead of failing where the mismatch actually is.
function migrateLegacyPages(state) {
  if (!state || !state.slidesById) return state;
  const scenesById = { ...(state.scenesById || {}) };
  const slidesById = { ...state.slidesById };
  let migrated = false;
  for (const slideId of Object.keys(slidesById)) {
    const slide = slidesById[slideId];
    if (!slide || !Array.isArray(slide.pages)) continue;
    let slideChanged = false;
    const pages = slide.pages.map((entry) => {
      if (typeof entry === 'string' && scenesById[entry]) return entry;
      const scene = wrapHtmlAsScene(typeof entry === 'string' ? entry : '');
      scenesById[scene.id] = scene;
      slideChanged = true;
      return scene.id;
    });
    if (slideChanged) {
      slidesById[slideId] = { ...slide, pages };
      migrated = true;
    }
  }
  return migrated ? { ...state, slidesById, scenesById } : state;
}

// A session saved before Milestone 5 has no masterSlideIds/componentSlideIds
// arrays at all — same class of stale-shape problem migrateLegacyPages
// guards against above, just for the two new top-level lists instead of
// per-slide pages. Milestone 9 adds assetsById/assetOrder to the same list.
// Milestone D adds `edges` — synthesized (not just defaulted to []) from
// the state's own current section/slide order, so a deck saved before this
// milestone keeps rendering its overview graph exactly as it always did
// (see lib/edgeGraph.ts's synthesizeLinearEdges doc comment) the moment it
// loads, rather than losing every edge until the user manually re-adds them.
function migrateMissingCollections(state) {
  if (!state) return state;
  const patch = {};
  if (!Array.isArray(state.masterSlideIds)) patch.masterSlideIds = [];
  if (!Array.isArray(state.componentSlideIds)) patch.componentSlideIds = [];
  if (!state.assetsById || typeof state.assetsById !== 'object') patch.assetsById = {};
  if (!Array.isArray(state.assetOrder)) patch.assetOrder = [];
  if (!Array.isArray(state.edges)) patch.edges = synthesizeLinearEdges(state);
  return Object.keys(patch).length ? { ...state, ...patch } : state;
}

// Milestone 11: exported so lib/projectFile.ts's JSON project loader runs
// state parsed from a *file* (rather than localStorage) through the exact
// same stale-shape migrations — a project file saved before some earlier
// milestone is just as likely to need them as an old localStorage session.
export function migrateState(state) {
  return migrateMissingCollections(migrateLegacyPages(state));
}

export function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return migrateState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}
