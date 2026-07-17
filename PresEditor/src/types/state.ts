// The editor's normalized store shape. Mirrors the existing patterns in
// lib/emptyState.js and state/reducer.js (id-map + order-array
// normalization for sections/slides) applied one level deeper: a slide's
// `pages` are now Scene ids, not raw HTML strings — see types/scene.ts.

import type { ObjectId, Scene, BackgroundSpec } from './scene';

// Milestone 9: a dedup'd store for user-uploaded media. An ImageObject
// references one of these by id (types/scene.ts's ImageObject.data.assetId)
// instead of embedding its own copy of the data: URL, so inserting the same
// file (or the same image asset) onto multiple slides costs storage once,
// not once per placement — see lib/assets.ts's findDuplicateAsset, the
// content-equality check that makes this actually dedup'd rather than just
// "centralized". Kept as a flat id-map + order array, same normalization
// shape as every other collection in this state (sections, slides, scenes).
export interface Asset {
  id: string;
  kind: 'image';
  name: string;
  dataUrl: string;
  size: number; // approx decoded byte size, for the library UI — see lib/assets.ts
  addedAt: number;
}

export interface SectionMeta {
  id: string;
  label: string;
  color: string;
  tint: string;
  border: string;
  collapsed: boolean;
  slideIds: string[];
  // Milestone 4: falls between the deck default and a slide's own
  // scene.background in the cascade — see renderScene.ts's
  // resolveEffectiveBackground.
  defaultBackground?: BackgroundSpec | null;
  // Milestone 5: falls between the deck default and "no master" — a slide
  // has no per-slide master override (only slide/section/deck exists for
  // backgrounds; masters cascade at just section/deck, one level less,
  // since a slide *is* free to just not use its section's master's regions
  // by not leaving room for them). Points into EditorState.masterSlideIds.
  masterSlideId?: string | null;
}

export interface Slide {
  id: string;
  cls: 'slide-light' | 'slide-dark';
  pages: string[]; // Scene ids, in page order — was string[] of raw HTML pre-Studio
  notes: string;
  nodeIcon: string | null;
  nodeLabel: string | null;
}

// Milestone D (v2, editable overview graph): the overview map's edges were
// never independent data before this — the engine drew a curve between
// every pair of *consecutive* main-deck slide indices, implicitly, with no
// stored representation at all (see lib/genericTemplate.js's GENERIC_TAIL,
// the `for(i<NODE_META.length-1)` loop). Making edges editable (redirect to
// a non-adjacent node, delete one, add a new one) requires them to be real
// state. `from`/`to` are Slide ids, not array indices — indices shift on
// every reorder/insert/delete, so an index-keyed edge would silently point
// at the wrong node the moment anything moves; ids are exactly what
// `Slide.nodeIcon`/`nodeLabel` editing already keys off. Both ends must
// always be a *main* slide (one that's actually inside `sections`, i.e. has
// a NODE_META entry) — see lib/edgeGraph.ts and reducer.ts's ADD_EDGE.
export interface Edge {
  id: string;
  from: string; // Slide.id
  to: string; // Slide.id
}

export interface EditorMeta {
  title: string;
  loadedFrom: string | null;
  originalText: string | null;
  styleBlock: string;
  // Milestone 4: deck-wide fallback background — lowest priority in the
  // slide/section/deck cascade (see renderScene.ts).
  defaultBackground?: BackgroundSpec | null;
  // Milestone 5: deck-wide fallback master — lowest priority in the
  // section/deck cascade. Points into EditorState.masterSlideIds.
  defaultMasterSlideId?: string | null;
  // Presentation library (v2): stable id this document is saved under in
  // lib/presentationLibrary.ts's per-doc storage, distinct from the
  // single-slot session autosave (lib/storage.js) that predates it. Stamped
  // once (EditorContext's boot effect) the first time a document is
  // created/imported/resumed without one; never regenerated afterwards, so
  // re-saving the same document always updates its existing library entry
  // instead of forking a duplicate.
  libraryId?: string | null;
}

// Which object(s), in which scene, are currently selected. Scoped to a
// single scene: selection never spans multiple slides/pages at once.
export interface Selection {
  sceneId: string;
  objectIds: ObjectId[];
}

export interface EditorState {
  meta: EditorMeta;
  sections: SectionMeta[];
  qaSlideIds: string[];
  qaCollapsed: boolean;
  slidesById: Record<string, Slide>;
  scenesById: Record<string, Scene>;
  selectedSlideId: string | null;
  selectedPage: number;
  selection: Selection | null;
  notesOpen: boolean;
  // Milestone 5: master slides and reusable components are both just
  // ordinary Slides (so they're fully browsable/editable with the exact
  // same Canvas/Inspector/Layers UI as any other slide) that live outside
  // `sections`/`qaSlideIds` — findLocation, totalSlideCount, and export's
  // S/QA_SLIDES flattening all only look at those two, so a slide living
  // in either list here is automatically excluded from the real deck and
  // never gets exported as a regular slide.
  masterSlideIds: string[];
  componentSlideIds: string[];
  // Milestone 9: see the Asset doc comment above.
  assetsById: Record<string, Asset>;
  assetOrder: string[];
  // Milestone D: see the Edge doc comment above.
  edges: Edge[];
}
