import { unwrapIfPureLegacy } from './legacyHtmlAdapter';
import { EI } from '../lib/icons';
import { encodeBackgroundMarker } from '../lib/slideBackground';
import { rectCenter, clipPointToRect, degToRad } from './geometry';
import type {
  BackgroundSpec,
  BaseSceneObject,
  LegacyHtmlObject,
  ObjectStyle,
  Scene,
  SceneObject,
  TextObject,
  ShapeObject,
  IconObject,
  ImageObject,
  ComponentInstanceObject,
  DiagramNodeObject,
  ConnectorObject,
  ChartObject,
  TableObject,
} from '../types/scene';
import type { Asset } from '../types/state';

export type RenderMode = 'edit' | 'export';

// Milestone 5: everything renderScene needs that isn't on the Scene itself
// — all resolved by the caller (Canvas.tsx / exportPresentation.ts) via
// scene/renderContext.ts, since renderScene has no access to sections,
// other slides, or deck-level meta. `background` keeps Milestone 4's
// "undefined means fall back to scene.background" convention; the rest
// default to "off" when omitted.
export interface RenderContext {
  background?: BackgroundSpec | null;
  // The already-resolved section -> deck master cascade result (see
  // resolveEffectiveMaster) — its objects are painted as a read-only
  // overlay on top of the scene's own content.
  master?: Scene | null;
  pageNumber?: number | null;
  pageCount?: number | null;
  // Every reusable component definition a component-instance object in
  // this scene (or in the active master) might reference, keyed by the
  // component's slide id (see types/scene.ts's ComponentInstanceObject).
  components?: Record<string, Scene>;
  // Milestone 9: the deck-wide dedup'd asset store (types/state.ts's
  // EditorState.assetsById), passed straight through unchanged — unlike
  // `components`, nothing here needs resolving per-scene, so callers just
  // hand over `state.assetsById` as-is.
  assets?: Record<string, Asset>;
}

// The single scene->HTML renderer. Both the editor canvas (Canvas.tsx,
// mode:'edit') and the standalone-file export (exportPresentation.ts,
// mode:'export') call this exact function — see the Presentation Studio
// plan's "central tension" resolution. `mode` only toggles whether
// editor-only instrumentation (data-object-id / data-object-type / the
// `scene-object` selection hook class) is emitted; the visual DOM
// structure is identical either way, so there is no way for the editor's
// preview and the exported file to drift apart.
//
// The one deliberate exception: the byte-identical "pure legacy" fast path
// (see legacyHtmlAdapter.ts) only applies in 'export' mode. It returns the
// slide's raw HTML completely unwrapped — no data-object-id, no wrapper —
// which is exactly what byte-identical export needs, but it's also exactly
// the markup the *editor* needs in order to find and wire up an object at
// all (canvasEditing.js's makeEditable/wireImageSlots, and
// sceneEditing.ts's select/drag/resize, both scope themselves to
// `[data-object-id]`/`.legacy-content`). So 'edit' mode always wraps, even
// for an untouched single-object scene, and 'export' mode reapplies the
// fast path — this is the only asymmetry between the two modes.
//
// `objectOrder` is the single source of truth for paint/z order (back to
// front) — there is no independent numeric sort here. An object's
// `zIndex` field is a display-only mirror of its position in that array
// (see reducer.ts's `withSyncedZIndex`), never read by the renderer, so
// there is exactly one place "what's on top" can ever be decided.
//
// `ctx.background` (Milestone 4) is the already-resolved slide -> section ->
// deck cascade result (see lib/slideBackground.js's resolveEffectiveBackground)
// — renderScene itself doesn't know about sections or deck-level meta, so
// callers resolve the cascade and pass the answer in. When set, it's
// prepended as a hidden marker div (same behind-the-watermark sibling trick
// the old per-slide bg-color feature used) *and* it disables the
// byte-identical fast path, since that path's whole point is returning
// content with nothing added — `ctx.master` disables it the same way.
export function renderScene(scene: Scene, mode: RenderMode, ctx: RenderContext = {}): string {
  const bg = ctx.background !== undefined ? ctx.background : scene.background ?? null;

  if (mode === 'export' && !bg && !ctx.master) {
    const pureLegacyHtml = unwrapIfPureLegacy(scene);
    if (pureLegacyHtml !== null) return pureLegacyHtml;
  }

  const objects = scene.objectOrder
    .map((id) => scene.objectsById[id])
    .filter((obj): obj is SceneObject => !!obj && !obj.hidden);

  const mainHtml = objects.map((obj) => renderObject(obj, mode, ctx, 0, scene.objectsById)).join('');
  const masterHtml = ctx.master ? renderMasterOverlay(ctx.master, ctx) : '';
  const bgHtml = bg ? encodeBackgroundMarker(bg) : '';
  return bgHtml + mainHtml + masterHtml;
}

// `depth` guards against a component-instance cycle (component A contains
// an instance of component B, which contains an instance of A) recursing
// forever — nothing upstream prevents creating one (INSERT_COMPONENT_INSTANCE
// works on any scene, including a component's own definition), so the
// renderer itself is the backstop. A real deck nesting components this
// deep is vanishingly unlikely; this only ever fires on an actual cycle.
const MAX_COMPONENT_DEPTH = 6;

// `localObjectsById` is whichever object collection `obj` itself lives in
// (the main scene, the active master, or a component definition) — a
// connector resolves its fromId/toId against *that* collection, never
// reaching across scenes, so a connector inside a master only ever
// connects two other master objects, same for a component's own definition.
function renderObject(
  obj: SceneObject,
  mode: RenderMode,
  ctx: RenderContext,
  depth = 0,
  localObjectsById: Record<string, SceneObject> = {}
): string {
  switch (obj.type) {
    case 'legacy-html':
      return renderLegacyHtmlObject(obj, mode);
    case 'text':
      return renderTextObject(obj, mode, ctx);
    case 'shape':
      return renderShapeObject(obj, mode);
    case 'icon':
      return renderIconObject(obj, mode);
    case 'image':
      return renderImageObject(obj, mode, ctx);
    case 'component-instance':
      return renderComponentInstanceObject(obj, mode, ctx, depth);
    case 'diagram-node':
      return renderDiagramNodeObject(obj, mode);
    case 'connector':
      return renderConnectorObject(obj, mode, localObjectsById);
    case 'chart':
      return renderChartObject(obj, mode);
    case 'table':
      return renderTableObject(obj, mode);
    default:
      return '';
  }
}

// A master's own objects are always rendered in 'export' shape (no
// data-object-id / scene-object class) regardless of the outer mode, and
// wrapped in a pointer-events:none layer — a master overlay is a read-only
// reference on every *consuming* slide; editing it happens by selecting
// the master slide itself (just an ordinary Slide — see types/state.ts),
// where it's rendered the normal interactive way like any other scene.
function renderMasterOverlay(master: Scene, ctx: RenderContext): string {
  const objects = master.objectOrder
    .map((id) => master.objectsById[id])
    .filter((obj): obj is SceneObject => !!obj && !obj.hidden);
  const inner = objects.map((obj) => renderObject(obj, 'export', ctx, 0, master.objectsById)).join('');
  return `<div class="scene-master-overlay" style="position:absolute; inset:0; pointer-events:none;">${inner}</div>`;
}

// No explicit CSS z-index: objects are emitted in `objectOrder` (back to
// front), and position:absolute siblings with no z-index naturally stack
// by DOM order — one fewer thing that could disagree with objectOrder.
//
// Known limitation (Milestone 8): a rotated object's `transform:rotate()`
// is set inline here, which — being an inline style — always wins over the
// stylesheet-level `transform` an entrance/emphasis preset needs to
// animate (lib/animationCss.js). A rotated object's *opacity*-based
// presets (fade, flash) still work fine since those never touch
// `transform`; only the motion component of the others is suppressed.
// Properly combining the two would mean driving rotation through the same
// CSS-var mechanism the presets use, touching sceneEditing.ts's rotate
// gesture too — judged out of scope for this pass.
//
// Opacity is the same story, one level worse: an *always*-present inline
// `opacity:` would permanently override lib/animationCss.js's
// `[data-anim]`/`[data-emphasis]` rules' own opacity control (again,
// inline beats stylesheet regardless of specificity) — meaning the fade
// component of every entrance/emphasis preset would silently never play,
// on *any* object, not just rotated ones. Every object factory defaults
// `opacity` to 1 (scene/objectDefaults.ts), and 1 is also the CSS initial
// value, so omitting the inline declaration whenever it's exactly 1 costs
// nothing for the overwhelmingly common case and leaves the stylesheet
// rules free to animate it — only an object with both a *non-default*
// opacity and a fade-based preset hits the same narrower limitation
// rotation does.
function positionStyle(obj: BaseSceneObject): string {
  const transform = obj.rotation ? ` transform:rotate(${obj.rotation}deg);` : '';
  const opacity = obj.opacity !== 1 ? ` opacity:${obj.opacity};` : '';
  return (
    `position:absolute; left:${obj.x}px; top:${obj.y}px; width:${obj.width}px; height:${obj.height}px;` +
    `${opacity}${transform}${animationCssVars(obj)}`
  );
}

// Milestone 8: `--d`/`--ed` feed lib/animationCss.js's injected preset
// rules (and the engine's own original `[data-anim]` rule for `--d`) —
// the step unit (70ms) matches that rule's existing `calc(var(--d,0) *
// 70ms)` convention exactly, so entrance delay stays consistent with
// whatever stagger an imported deck's own hand-set `--d` values already use.
function animationCssVars(obj: BaseSceneObject): string {
  const entrance = obj.animations?.find((a) => a.kind === 'entrance');
  const emphasis = obj.animations?.find((a) => a.kind === 'emphasis');
  let vars = '';
  if (entrance) vars += ` --d:${Math.max(0, Math.round((entrance.delayMs ?? 0) / 70))};`;
  if (emphasis) vars += ` --ed:${Math.max(0, Math.round((emphasis.delayMs ?? 0) / 70))};`;
  return vars;
}

// Milestone 8: data-anim/data-anim-preset/data-emphasis are *functional*
// markup the real engine's CSS needs to actually animate, unlike
// data-object-id/data-object-type/scene-object (pure editor
// instrumentation, stripped in 'export' mode) — so these are emitted
// regardless of `mode`.
function animationAttrs(obj: BaseSceneObject): string {
  const entrance = obj.animations?.find((a) => a.kind === 'entrance');
  const emphasis = obj.animations?.find((a) => a.kind === 'emphasis');
  let attrs = '';
  if (entrance) attrs += ` data-anim="1" data-anim-preset="${entrance.preset}"`;
  if (emphasis) attrs += ` data-emphasis="${emphasis.preset}"`;
  return attrs;
}

function editAttrs(obj: BaseSceneObject, mode: RenderMode, extraClass: string): string {
  const anim = animationAttrs(obj);
  if (mode !== 'edit') return ` class="scene-object ${extraClass}"${anim}`;
  const groupAttr = obj.groupId ? ` data-group-id="${obj.groupId}"` : '';
  return ` data-object-id="${obj.id}" data-object-type="${obj.type}"${groupAttr} class="scene-object ${extraClass}"${anim}`;
}

function renderLegacyHtmlObject(obj: LegacyHtmlObject, mode: RenderMode): string {
  const style = `${positionStyle(obj)} overflow:hidden;`;
  return (
    `<div${editAttrs(obj, mode, 'scene-legacy')} style="${style}">` +
    `<div class="legacy-content" style="position:relative; width:100%; height:100%;">${obj.data.html}</div>` +
    `</div>`
  );
}

function objectStyleToCss(style?: ObjectStyle): string {
  if (!style) return '';
  const parts: string[] = [];
  if (style.color) parts.push(`color:${style.color}`);
  if (style.fontFamily) parts.push(`font-family:${style.fontFamily}`);
  if (style.fontSize != null) parts.push(`font-size:${style.fontSize}px`);
  if (style.fontWeight != null) parts.push(`font-weight:${style.fontWeight}`);
  if (style.textAlign) parts.push(`text-align:${style.textAlign}`);
  if (style.lineHeight != null) parts.push(`line-height:${style.lineHeight}`);
  if (style.letterSpacing != null) parts.push(`letter-spacing:${style.letterSpacing}px`);
  if (style.fill) parts.push(`background:${style.fill}`);
  if (style.stroke) parts.push(`border:${style.strokeWidth ?? 1}px solid ${style.stroke}`);
  if (style.radius != null) parts.push(`border-radius:${style.radius}px`);
  if (style.shadow) parts.push(`box-shadow:${style.shadow}`);
  return parts.length ? `${parts.join('; ')};` : '';
}

// `dynamicField` (Milestone 5) computes the displayed text from the
// render-time page position instead of the stored `html` — used for master
// slides' page-number/count regions. Falls back to the stored html when the
// context doesn't carry a page position (e.g. previewing a master slide on
// its own, outside any consuming slide's cascade).
function renderTextObject(obj: TextObject, mode: RenderMode, ctx: RenderContext): string {
  const style = `${positionStyle(obj)} ${objectStyleToCss(obj.style)}`;
  let html = obj.data.html;
  if (obj.data.dynamicField === 'pageNumber' && ctx.pageNumber != null) html = String(ctx.pageNumber);
  else if (obj.data.dynamicField === 'pageCount' && ctx.pageCount != null) html = String(ctx.pageCount);
  return `<div${editAttrs(obj, mode, 'scene-text')} style="${style}">${html}</div>`;
}

// Ellipse is expressed purely as border-radius:50% on a rect box — no
// separate SVG/clip-path needed, and it still resizes/rotates exactly like
// every other object since it's the same absolutely-positioned div.
function renderShapeObject(obj: ShapeObject, mode: RenderMode): string {
  const radius = obj.data.shape === 'ellipse' ? '50%' : obj.style?.radius != null ? `${obj.style.radius}px` : '0';
  const style = `${positionStyle(obj)} ${objectStyleToCss(obj.style)} border-radius:${radius};`;
  return `<div${editAttrs(obj, mode, 'scene-shape')} style="${style}"></div>`;
}

// Icons are inlined as SVG (from the same lib/icons.js set used for the
// node-icon picker elsewhere) rather than referencing an icon font or
// sprite sheet, so the exported file stays a single dependency-free HTML
// document. `color` cascades to the SVG's `currentColor` strokes/fills.
function renderIconObject(obj: IconObject, mode: RenderMode): string {
  const raw = (EI as Record<string, string>)[obj.data.icon] || EI.sitemap;
  // Icon strings have no width/height of their own (they're sized by CSS
  // classes in the editor chrome, which don't exist inside slide content),
  // so the <svg> tag gets one injected directly — otherwise it would fall
  // back to the browser's intrinsic replaced-element size instead of
  // filling the object's box.
  const svg = raw.replace('<svg ', '<svg width="100%" height="100%" ');
  const style = `${positionStyle(obj)} ${objectStyleToCss(obj.style)} display:flex; align-items:center; justify-content:center;`;
  return `<div${editAttrs(obj, mode, 'scene-icon')} style="${style}">${svg}</div>`;
}

// Milestone 9: `assetId` (when set) resolves against ctx.assets — the
// deck-wide dedup'd store — before falling back to the object's own `src`.
// A missing asset (deleted from the library while still referenced) falls
// back to an empty src rather than throwing, same "degrade, don't crash"
// choice renderConnectorObject makes for a missing endpoint.
function resolveImageSrc(obj: ImageObject, ctx: RenderContext): string {
  if (obj.data.assetId) return ctx.assets?.[obj.data.assetId]?.dataUrl ?? '';
  return obj.data.src ?? '';
}

function renderImageObject(obj: ImageObject, mode: RenderMode, ctx: RenderContext): string {
  const radius = obj.style?.radius != null ? `${obj.style.radius}px` : '0';
  const style = `${positionStyle(obj)} overflow:hidden; border-radius:${radius};`;
  const imgStyle = `width:100%; height:100%; object-fit:${obj.data.fit}; display:block;`;
  const src = resolveImageSrc(obj, ctx);
  return `<div${editAttrs(obj, mode, 'scene-image')} style="${style}"><img src="${src}" style="${imgStyle}" alt="" /></div>`;
}

// Milestone 5: an instance renders the *live* component definition's
// objects (resolved via ctx.components — see scene/renderContext.ts),
// translated so the definition's own bounding box lands at the instance's
// position. The instance's own width/height are set to that natural bbox
// size at insert time (reducer.ts's INSERT_COMPONENT_INSTANCE) and not
// otherwise kept in sync — resizing an instance isn't supported yet (its
// resize handle is hidden in sceneEditing.ts), so this never needs to
// scale, only translate. Internal objects render in 'export' shape (not
// individually selectable) for the same reason a master's overlay does:
// editing happens by selecting the component's own slide, not by reaching
// into an instance.
function renderComponentInstanceObject(obj: ComponentInstanceObject, mode: RenderMode, ctx: RenderContext, depth: number): string {
  const wrapStyle = `${positionStyle(obj)} overflow:visible;`;
  if (depth >= MAX_COMPONENT_DEPTH) return `<div${editAttrs(obj, mode, 'scene-component')} style="${wrapStyle}"></div>`;
  const comp = ctx.components?.[obj.data.componentSlideId];
  if (!comp) return `<div${editAttrs(obj, mode, 'scene-component')} style="${wrapStyle}"></div>`;

  const objects = comp.objectOrder
    .map((id) => comp.objectsById[id])
    .filter((o): o is SceneObject => !!o && !o.hidden);
  if (!objects.length) return `<div${editAttrs(obj, mode, 'scene-component')} style="${wrapStyle}"></div>`;

  const minX = Math.min(...objects.map((o) => o.x));
  const minY = Math.min(...objects.map((o) => o.y));
  // Translated once into its own map (not just mapped inline) so a
  // connector among these objects resolves its endpoints against the same
  // shifted coordinates its siblings are actually rendered at — otherwise
  // it would compute its path from the *untranslated* definition positions
  // while everything around it moved.
  const translated: Record<string, SceneObject> = {};
  objects.forEach((o) => {
    translated[o.id] = { ...o, x: o.x - minX, y: o.y - minY };
  });
  const inner = objects.map((o) => renderObject(translated[o.id], 'export', ctx, depth + 1, translated)).join('');
  return `<div${editAttrs(obj, mode, 'scene-component')} style="${wrapStyle}">${inner}</div>`;
}

// Milestone 6: a flowchart box — shape + baked-in label in one flex
// container, same styling mechanism ShapeObject/ObjectStyle already
// provide (fill/stroke -> background/border, plus the text-ish properties
// objectStyleToCss also emits). Diamond uses a CSS clip-path rather than a
// real polygon shape, so its border is only approximately diamond-shaped —
// an accepted simplification, see the type's own doc comment.
function renderDiagramNodeObject(obj: DiagramNodeObject, mode: RenderMode): string {
  let radius = '0';
  let clipPath = '';
  if (obj.data.shape === 'ellipse') radius = '50%';
  else if (obj.data.shape === 'rect') radius = obj.style?.radius != null ? `${obj.style.radius}px` : '8px';
  else if (obj.data.shape === 'diamond') clipPath = ' clip-path:polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);';
  const style =
    `${positionStyle(obj)} ${objectStyleToCss(obj.style)} border-radius:${radius};${clipPath} ` +
    `display:flex; align-items:center; justify-content:center; text-align:center; padding:10px; box-sizing:border-box;`;
  return `<div${editAttrs(obj, mode, 'scene-diagram-node')} style="${style}"><div style="pointer-events:none;">${obj.data.label}</div></div>`;
}

// Milestone 6: geometry is derived fresh every render from the *current*
// fromId/toId objects' rects (clipPointToRect), never stored — see
// types/scene.ts's ConnectorObject doc comment. The wrapping div's own
// pointer-events:none plus the <line>'s pointer-events:stroke means only
// the visible line itself is clickable, not the whole (padded, often
// mostly-empty) bounding box a naive div hit-test would otherwise use —
// pointer-events:none on an ancestor blocks it from being a hit-test
// target but not from receiving a bubbled event a descendant did catch, so
// sceneEditing.ts's mousedown listener on this div still fires normally.
function renderConnectorObject(obj: ConnectorObject, mode: RenderMode, localObjectsById: Record<string, SceneObject>): string {
  const from = localObjectsById[obj.data.fromId];
  const to = localObjectsById[obj.data.toId];
  if (!from || !to) {
    return `<div${editAttrs(obj, mode, 'scene-connector')} style="position:absolute; left:0; top:0; width:0; height:0; pointer-events:none;"></div>`;
  }

  const fromCenter = rectCenter(from);
  const toCenter = rectCenter(to);
  const p1 = clipPointToRect(from, toCenter.cx, toCenter.cy);
  const p2 = clipPointToRect(to, fromCenter.cx, fromCenter.cy);

  const pad = 14; // room for stroke width + arrowhead marker
  const minX = Math.min(p1.x, p2.x) - pad;
  const minY = Math.min(p1.y, p2.y) - pad;
  const width = Math.max(1, Math.max(p1.x, p2.x) + pad - minX);
  const height = Math.max(1, Math.max(p1.y, p2.y) + pad - minY);
  const lx1 = p1.x - minX;
  const ly1 = p1.y - minY;
  const lx2 = p2.x - minX;
  const ly2 = p2.y - minY;

  const stroke = obj.style?.stroke || '#4b0976';
  const strokeWidth = obj.style?.strokeWidth ?? 2;
  const markerId = `arrow-${obj.id}`;
  // A single marker definition, referenced by both marker-start and
  // marker-end when needed: `orient="auto-start-reverse"` (SVG2) already
  // flips the arrowhead correctly for whichever end it's attached to, so
  // there's no need for two separate marker defs.
  const needsMarker = obj.data.arrowEnd || obj.data.arrowStart;
  const marker = needsMarker
    ? `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${stroke}"></path></marker></defs>`
    : '';
  const markerAttr =
    (obj.data.arrowEnd ? ` marker-end="url(#${markerId})"` : '') +
    (obj.data.arrowStart ? ` marker-start="url(#${markerId})"` : '');
  const dashAttr = obj.data.dash ? ' stroke-dasharray="6 5"' : '';

  // Milestone A (v2): `routing` picks the path shape; geometry (p1/p2, the
  // clipped endpoint rects) stays identical either way — only how the two
  // points connect changes.
  const midX = (lx1 + lx2) / 2;
  const midY = (ly1 + ly2) / 2;
  let d: string;
  if (obj.data.routing === 'elbow') {
    d = `M${lx1},${ly1} L${midX},${ly1} L${midX},${ly2} L${lx2},${ly2}`;
  } else if (obj.data.routing === 'curved') {
    d = `M${lx1},${ly1} Q${midX},${midY} ${lx2},${ly2}`;
  } else {
    d = `M${lx1},${ly1} L${lx2},${ly2}`;
  }

  const label = obj.data.label
    ? `<div style="position:absolute; left:${midX - 45}px; top:${midY - 10}px; width:90px; text-align:center; font-size:11px; color:${stroke}; pointer-events:none;">${escapeHtml(obj.data.label)}</div>`
    : '';

  const wrapStyle = `position:absolute; left:${minX}px; top:${minY}px; width:${width}px; height:${height}px; opacity:${obj.opacity}; overflow:visible; pointer-events:none;`;
  const svg =
    `<svg width="${width}" height="${height}" style="position:absolute; left:0; top:0; overflow:visible;">${marker}` +
    `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr}${markerAttr} style="pointer-events:stroke;"></path></svg>`;
  return `<div${editAttrs(obj, mode, 'scene-connector')} style="${wrapStyle}">${svg}${label}</div>`;
}

// Milestone 7: user-entered plain text (chart labels/titles, table cells)
// gets escaped before being embedded — unlike TextObject's `data.html`,
// which is deliberately raw/rich-formatted HTML by design, these fields
// are plain strings from Inspector inputs, not markup a user authored.
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Exported so ObjectInspector.tsx's per-row color swatch can show the
// *actual* resolved color for a row that hasn't been given an explicit
// override yet (matching seriesColor()'s own fallback below), instead of
// a swatch that starts blank/arbitrary until the user first touches it.
export const CHART_PALETTE = ['#4b0976', '#f4c10b', '#8c6aa3', '#2a9d8f', '#e76f51', '#264653', '#e9c46a'];

// Simple sRGB relative-luminance check (no gamma-correct precision needed,
// just "is this dark enough that white text reads better than black") —
// used to pick pie-slice label color per slice, since a mixed palette
// means no single label color reads on every slice.
function isDarkColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.6;
}

function seriesColor(s: { color?: string }, i: number, palette: string[]): string {
  return s.color || palette[i % palette.length];
}

// Milestone 7 (extended): hand-rolled SVG, not a chart library — the
// export must stay a single dependency-free file, so nothing here can
// lean on a runtime that wouldn't also have to ship in that file. A title
// (if set) is drawn as an SVG <text> inside the same viewBox rather than a
// separate DOM element, so there's no second layout system (flexbox
// height splitting) to keep in sync with the chart's own coordinate math
// below. `showValues` defaults to true when unset so every chart created
// before that field existed keeps rendering exactly as it did.
function renderChartObject(obj: ChartObject, mode: RenderMode): string {
  const { kind, series, title } = obj.data;
  const width = obj.width;
  const height = obj.height;
  const topPad = title ? 22 : 0;
  const palette = obj.style?.fill ? [obj.style.fill, ...CHART_PALETTE] : CHART_PALETTE;
  const titleColor = obj.style?.color || '#241130';
  const showValues = obj.data.showValues !== false;
  const titleSvg = title
    ? `<text x="${width / 2}" y="15" font-size="13" font-weight="700" text-anchor="middle" fill="${titleColor}">${escapeHtml(title)}</text>`
    : '';
  let inner = '';
  if (!series.length) {
    inner = '';
  } else if (kind === 'pie') {
    inner = renderPieChartSvg(series, width, height - topPad, palette, showValues, !!obj.data.donut);
  } else if (kind === 'line' || kind === 'area') {
    inner = renderLineChartSvg(series, width, height - topPad, palette, showValues, kind === 'area');
  } else {
    inner = renderBarChartSvg(series, width, height - topPad, palette, showValues, obj.style?.radius);
  }
  const style = `${positionStyle(obj)} ${objectStyleToCss(obj.style)}`;
  const svg =
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;">` +
    `${titleSvg}<g transform="translate(0,${topPad})">${inner}</g></svg>`;
  return `<div${editAttrs(obj, mode, 'scene-chart')} style="${style}">${svg}</div>`;
}

function renderBarChartSvg(
  series: ChartObject['data']['series'],
  width: number,
  height: number,
  palette: string[],
  showValues: boolean,
  radius: number | undefined
): string {
  const padLeft = 8;
  const padBottom = 20;
  const padTop = 18;
  const chartW = Math.max(1, width - padLeft * 2);
  const chartH = Math.max(1, height - padBottom - padTop);
  const maxVal = Math.max(...series.map((s) => s.value), 1);
  const gap = 8;
  const barW = Math.max(1, (chartW - gap * (series.length - 1)) / series.length);
  const rx = radius ?? 3;
  return series
    .map((s, i) => {
      const barH = Math.max(0, (Math.max(s.value, 0) / maxVal) * chartH);
      const x = padLeft + i * (barW + gap);
      const y = padTop + (chartH - barH);
      const valueLabel = showValues
        ? `<text x="${x + barW / 2}" y="${Math.max(11, y - 4)}" font-size="10" text-anchor="middle" fill="#333">${s.value}</text>`
        : '';
      return (
        `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${seriesColor(s, i, palette)}" rx="${rx}"></rect>` +
        `<text x="${x + barW / 2}" y="${height - 6}" font-size="10" text-anchor="middle" fill="#555">${escapeHtml(s.label)}</text>` +
        valueLabel
      );
    })
    .join('');
}

// `filled` (the "Aire" chart kind) draws a translucent fill from the line
// down to the baseline before the line/dots/labels — same point layout as
// a plain line chart, so the two kinds share every bit of this function
// except that one extra shape.
function renderLineChartSvg(
  series: ChartObject['data']['series'],
  width: number,
  height: number,
  palette: string[],
  showValues: boolean,
  filled: boolean
): string {
  const pad = 20;
  const chartW = Math.max(1, width - pad * 2);
  const chartH = Math.max(1, height - pad * 2);
  const baselineY = pad + chartH;
  const maxVal = Math.max(...series.map((s) => s.value), 1);
  const stepX = series.length > 1 ? chartW / (series.length - 1) : 0;
  const points = series.map((s, i) => ({
    x: pad + i * stepX,
    y: pad + (chartH - (Math.max(s.value, 0) / maxVal) * chartH),
  }));
  const lineColor = palette[0];
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area =
    filled && points.length
      ? `<path d="${path} L${points[points.length - 1].x},${baselineY} L${points[0].x},${baselineY} Z" fill="${lineColor}" opacity="0.22" stroke="none"></path>`
      : '';
  const dots = points
    .map((p, i) => {
      const valueLabel = showValues
        ? `<text x="${p.x}" y="${Math.max(11, p.y - 8)}" font-size="10" text-anchor="middle" fill="#333">${series[i].value}</text>`
        : '';
      return (
        `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${seriesColor(series[i], i, palette)}"></circle>` +
        valueLabel +
        `<text x="${p.x}" y="${height - 4}" font-size="10" text-anchor="middle" fill="#555">${escapeHtml(series[i].label)}</text>`
      );
    })
    .join('');
  return `${area}<path d="${path}" fill="none" stroke="${lineColor}" stroke-width="2"></path>${dots}`;
}

// `donut` draws each slice as an annulus (outer arc forward, inner arc
// back) instead of a full wedge from center — the hole is genuine
// transparency (not a same-color circle painted over the middle), so it
// looks right over any slide background. Percentage labels are placed at
// the mid-radius of the (donut or full) slice and skipped below an angle
// threshold, since text wider than a thin sliver just overlaps its
// neighbors; label color picks black/white per slice for contrast rather
// than one fixed color, since a mixed palette has no single color that
// reads on every slice.
function renderPieChartSvg(
  series: ChartObject['data']['series'],
  width: number,
  height: number,
  palette: string[],
  showValues: boolean,
  donut: boolean
): string {
  const total = series.reduce((sum, s) => sum + Math.max(s.value, 0), 0);
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.max(1, Math.min(width, height) / 2 - 8);
  const rInner = donut ? r * 0.55 : 0;
  if (total <= 0) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#e5e0ea"></circle>`;
  const pt = (angle: number, radius: number) => ({ x: cx + radius * Math.cos(degToRad(angle)), y: cy + radius * Math.sin(degToRad(angle)) });
  let angle = -90;
  return series
    .map((s, i) => {
      const value = Math.max(s.value, 0);
      const sliceAngle = (value / total) * 360;
      const startAngle = angle;
      const endAngle = angle + sliceAngle;
      angle = endAngle;
      if (sliceAngle <= 0) return '';
      const fill = seriesColor(s, i, palette);
      const largeArc = sliceAngle > 180 ? 1 : 0;
      let shape: string;
      if (sliceAngle >= 359.99) {
        // A single 100%-share slice: full outer circle with the inner
        // circle cut out via evenodd fill (two subpaths wound the same
        // way — SVG's evenodd rule punches the hole regardless of the
        // literal sweep direction of either).
        shape = donut
          ? `<path d="M${cx - r},${cy} A${r},${r} 0 1 1 ${cx + r},${cy} A${r},${r} 0 1 1 ${cx - r},${cy}Z M${cx - rInner},${cy} A${rInner},${rInner} 0 1 1 ${cx + rInner},${cy} A${rInner},${rInner} 0 1 1 ${cx - rInner},${cy}Z" fill="${fill}" fill-rule="evenodd"></path>`
          : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"></circle>`;
      } else if (donut) {
        const oStart = pt(startAngle, r);
        const oEnd = pt(endAngle, r);
        const iStart = pt(endAngle, rInner);
        const iEnd = pt(startAngle, rInner);
        shape =
          `<path d="M${oStart.x},${oStart.y} A${r},${r} 0 ${largeArc} 1 ${oEnd.x},${oEnd.y} ` +
          `L${iStart.x},${iStart.y} A${rInner},${rInner} 0 ${largeArc} 0 ${iEnd.x},${iEnd.y} Z" fill="${fill}"></path>`;
      } else {
        const p1 = pt(startAngle, r);
        const p2 = pt(endAngle, r);
        shape = `<path d="M${cx},${cy} L${p1.x},${p1.y} A${r},${r} 0 ${largeArc} 1 ${p2.x},${p2.y} Z" fill="${fill}"></path>`;
      }
      let label = '';
      if (showValues && sliceAngle >= 14) {
        const midAngle = startAngle + sliceAngle / 2;
        const labelR = donut ? (r + rInner) / 2 : r * 0.62;
        const lp = pt(midAngle, labelR);
        const pct = Math.round((value / total) * 100);
        const labelColor = isDarkColor(fill) ? '#fff' : '#241130';
        label = `<text x="${lp.x}" y="${lp.y}" font-size="10" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="${labelColor}">${pct}%</text>`;
      }
      return shape + label;
    })
    .join('');
}

function renderTableObject(obj: TableObject, mode: RenderMode): string {
  const style = `${positionStyle(obj)} overflow:auto;`;
  const rows = obj.data.rows;
  const headerFill = obj.style?.fill || '#4b0976';
  const textColor = obj.style?.color || '#241130';
  const borderColor = obj.style?.stroke || 'rgba(75,9,118,.25)';
  const fontSize = obj.style?.fontSize ?? 12;
  const rowsHtml = rows
    .map((row, ri) => {
      const cellTag = ri === 0 ? 'th' : 'td';
      const cellStyle =
        ri === 0
          ? `background:${headerFill}; color:#fff; font-weight:700; padding:6px 10px; border:1px solid ${borderColor}; font-size:${fontSize}px; text-align:left;`
          : `color:${textColor}; padding:6px 10px; border:1px solid ${borderColor}; font-size:${fontSize}px;`;
      return `<tr>${row.map((cell) => `<${cellTag} style="${cellStyle}">${escapeHtml(cell)}</${cellTag}>`).join('')}</tr>`;
    })
    .join('');
  return (
    `<div${editAttrs(obj, mode, 'scene-table')} style="${style}">` +
    `<table style="border-collapse:collapse; width:100%; height:100%;">${rowsHtml}</table></div>`
  );
}
