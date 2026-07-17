// The scene/object model — the foundation of the Presentation Studio rewrite.
//
// A slide "page" (previously an opaque HTML string — see lib/layouts.js and
// the old Slide.pages shape) is now a `Scene`: an ordered list of
// independent, absolutely-positioned `SceneObject`s. This is what makes the
// editor a scene editor (select/drag/resize/rotate/group any object)
// instead of a content editor (walk hand-authored HTML looking for text to
// make contenteditable).
//
// `SceneObjectType` documents the *full* intended type space up front (see
// the Presentation Studio milestone roadmap), but `SceneObject` — the
// actual discriminated union components/renderers switch on — only lists
// the types implemented so far. Each milestone adds its new type(s) to
// both the interface below and the union, rather than stubbing out empty
// interfaces for types with no behavior yet.

export type ObjectId = string;

export type SceneObjectType =
  | 'legacy-html'
  | 'text'
  | 'image'
  | 'video'
  | 'icon'
  | 'shape'
  | 'group'
  | 'diagram-node'
  | 'connector'
  | 'chart'
  | 'table'
  | 'code'
  | 'quote'
  | 'timeline'
  | 'component-instance';

// Deliberately loose/open — grows per object type as each one is built.
// Not every field applies to every type; renderers read only what they need.
export interface ObjectStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  shadow?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  letterSpacing?: number;
}

// Milestone 8: an object's `animations` array holds at most one 'entrance'
// and one 'emphasis' spec (the Inspector manages them as two named slots,
// not an open-ended list — see ObjectInspector.tsx's AnimationControls).
// Both map onto the presentation engine's existing `[data-anim]`/
// `.slide.content-in` primitive (lib/genericTemplate.js) via a handful of
// *additive* CSS rules (lib/animationCss.js) — zero engine JS changes.
// `kind: 'exit'` is reserved but not exposed in the UI: the engine has no
// "wait for an exit animation before actually navigating away" mechanic,
// and faking one would mean the invasive engine change this milestone was
// scoped to avoid — see lib/animationCss.js's own comment for the full
// reasoning. `durationMs` is reserved too: the base primitive's transition
// duration is fixed in the engine's own CSS (not parameterized by a CSS
// var the way delay already is via --d), and safely parameterizing it for
// an arbitrary *imported* deck's stylesheet — not just the generic
// template — was judged out of scope for this pass.
export interface AnimationSpec {
  kind: 'entrance' | 'emphasis' | 'exit';
  preset: string;
  delayMs?: number;
  durationMs?: number;
}

// Reserved for Milestone 4 (Backgrounds & theme). Unused by renderScene()
// until then; a Scene's `background` field is typed now so state shape
// doesn't need to change again later.
export interface BackgroundSpec {
  kind: 'color' | 'gradient' | 'image' | 'video' | 'pattern';
  value: string;
  opacity?: number;
  blur?: number;
  overlay?: string;
}

export interface BaseSceneObject {
  id: ObjectId;
  type: SceneObjectType;
  name?: string; // layers-panel label override; falls back to a type-based default
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  zIndex: number;
  opacity: number; // 0..1
  locked: boolean;
  hidden: boolean;
  groupId?: ObjectId | null;
  style?: ObjectStyle;
  animations?: AnimationSpec[];
}

// Wraps an existing hand-authored HTML fragment verbatim — the backward-
// compatibility seam. See scene/legacyHtmlAdapter.ts for how imported
// slides become one of these, and scene/renderScene.ts for the
// byte-identical fast path that makes an untouched import->export round
// trip produce exactly the original HTML.
export interface LegacyHtmlObject extends BaseSceneObject {
  type: 'legacy-html';
  data: { html: string };
}

// Intentionally minimal for Milestone 1: a single contenteditable HTML
// fragment. The structured rich-text model + formatting toolbar (fonts,
// lists, links, etc.) is Milestone 3 — this exists now so the scene
// canvas/selection/drag/resize/inspector/undo infrastructure has a second,
// genuinely-native object type to prove itself against, beyond the
// legacy-html escape hatch.
export interface TextObject extends BaseSceneObject {
  type: 'text';
  // `dynamicField` (Milestone 5): when set, the rendered text is computed
  // from the current slide's page position instead of `html` — the
  // mechanism behind master-slide page-number/count regions. `html` is
  // still kept up to date (e.g. "3") so the object behaves like normal text
  // everywhere else (Layers panel label, non-master contexts, etc.).
  data: { html: string; dynamicField?: 'pageNumber' | 'pageCount' };
}

// Milestone 3: a fill/stroke/radius/shadow rectangle or ellipse. Purely
// data + the existing `style` field — no new style properties needed since
// ObjectStyle already carries everything a shape uses.
export interface ShapeObject extends BaseSceneObject {
  type: 'shape';
  data: { shape: 'rect' | 'ellipse' };
}

// Milestone 3: one entry from the existing editor icon set (lib/icons.js's
// `EI`), inlined as SVG at render time — same set used for node-icon
// pickers elsewhere, so the export stays a single dependency-free file.
export interface IconObject extends BaseSceneObject {
  type: 'icon';
  data: { icon: string };
}

// Milestone 3: a native, freely-positioned image — distinct from the
// legacy-html escape hatch's free-media blocks (lib/canvasEditing.js's
// insertFreeMedia), which remain for compositing onto imported content.
//
// Milestone 9: `assetId` (preferred, when set) points into the deck-wide
// dedup'd store (types/state.ts's EditorState.assetsById) instead of `src`
// carrying its own embedded copy of the data: URL — see lib/assets.ts.
// `src` stays as the resolution fallback (and the only field used) for
// images created before Milestone 9 existed, so no migration is needed:
// renderScene.ts's resolveImageSrc tries `assetId` first, then `src`.
export interface ImageObject extends BaseSceneObject {
  type: 'image';
  data: { src?: string; assetId?: string; fit: 'cover' | 'contain' };
}

// Milestone 5: a reference to a reusable component definition — itself
// just a Scene, stored the same way a master slide is (see types/state.ts's
// EditorState.componentSlideIds): a slide living outside the normal
// sections/Q&A flow, purely as a vessel other slides' instances point at.
// Editing the definition (by selecting that slide like any other) updates
// every instance, since none of them copy its objects — they just resolve
// this id at render time (scene/renderScene.ts).
export interface ComponentInstanceObject extends BaseSceneObject {
  type: 'component-instance';
  data: { componentSlideId: string };
}

// Milestone 6: a flowchart/diagram box — a shape with a baked-in text
// label, edited via the Inspector (not double-click-on-canvas like
// TextObject — see ObjectInspector.tsx's DiagramNodeStyleControls) so
// sceneEditing.ts's contenteditable wiring doesn't need a third variant.
// Connectors attach to a node by its object id, not to fixed anchor
// points, so a node behaves like any other draggable/resizable object —
// moving it just re-derives every attached connector's geometry at render
// time (see renderScene.ts's renderConnectorObject).
export interface DiagramNodeObject extends BaseSceneObject {
  type: 'diagram-node';
  data: { shape: 'rect' | 'ellipse' | 'diamond'; label: string };
}

// Milestone 6: stores *intent* (which two objects, roughly which side of
// each) rather than literal coordinates — deliberately, per the
// Presentation Studio plan's original design for this milestone. A
// connector's own x/y/width/height are unused for rendering (kept only so
// it has a plausible Inspector value); the real path, clipped to each
// endpoint's current rectangle, is computed fresh on every render from the
// live fromId/toId objects (scene/geometry.ts's clipPointToRect) — so
// there's no separate synced copy of connector geometry that can ever go
// stale relative to a node the user just dragged.
// v2 diagram-builder milestone: `routing`/`dash`/`arrowStart` are all
// optional and default to the original Milestone 6 behavior (straight
// line, solid, arrow on the end only) — an existing connector with none of
// these fields set renders exactly as it always did, no migration needed.
export interface ConnectorObject extends BaseSceneObject {
  type: 'connector';
  data: {
    fromId: ObjectId;
    toId: ObjectId;
    arrowEnd: boolean;
    arrowStart?: boolean;
    routing?: 'straight' | 'elbow' | 'curved';
    dash?: boolean;
    label?: string;
  };
}

// Milestone 7: rendered to static SVG at render time (scene/renderScene.ts)
// — no chart runtime/library ships in the export, per the plan's "single
// dependency-free HTML file" requirement. `series` doubles as both the
// data model and what the Inspector's row editor / CSV-paste importer
// manipulate directly; there's no separate "chart config" object.
// `series[i].color` (optional) overrides the palette color that slice/
// bar/point would otherwise get by index — lets a user recolor one item
// without needing a second "palette" concept; `showValues` (default true
// when unset, so existing charts render unchanged) toggles the value/
// percentage labels every chart kind now draws; `donut` (pie only) draws
// an annulus instead of a full disc.
export interface ChartObject extends BaseSceneObject {
  type: 'chart';
  data: {
    kind: 'bar' | 'line' | 'area' | 'pie';
    series: Array<{ label: string; value: number; color?: string }>;
    title?: string;
    showValues?: boolean;
    donut?: boolean;
  };
}

// Milestone 7: edited via the Inspector's cell grid (not double-click cells
// on canvas — same reasoning as DiagramNodeObject's label: one fewer
// contenteditable variant for sceneEditing.ts to special-case). `rows[0]`
// is always the header row.
export interface TableObject extends BaseSceneObject {
  type: 'table';
  data: { rows: string[][] };
}

export type SceneObject =
  | LegacyHtmlObject
  | TextObject
  | ShapeObject
  | IconObject
  | ImageObject
  | ComponentInstanceObject
  | DiagramNodeObject
  | ConnectorObject
  | ChartObject
  | TableObject;

export interface Scene {
  id: string;
  objectsById: Record<ObjectId, SceneObject>;
  objectOrder: ObjectId[]; // paint/z order source of truth, back-to-front
  background?: BackgroundSpec | null;
}
