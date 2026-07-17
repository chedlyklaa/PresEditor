import { GENERIC_HEAD, GENERIC_TAIL } from './genericTemplate';
import { renderScene, type RenderContext } from '../scene/renderScene';
import { resolveEffectiveBackground } from './slideBackground';
import { resolveEffectiveMaster, buildComponentsMap } from '../scene/renderContext';
import { ensureAnimationCss } from './animationCss';
import { ensurePresenterCss, injectPresenterMode } from './presenterMode';
import { ensurePrintCss } from './printMode';
import { injectEdgeGraphSupport } from './edgeGraph';
import type { EditorState, Slide, SectionMeta } from '../types/state';
import type { Scene } from '../types/scene';

function jsStr(str: string | null | undefined): string {
  return JSON.stringify(str == null ? '' : str);
}

// A resolved slide/section/deck background (Milestone 4 — see
// lib/slideBackground.js's resolveEffectiveBackground/encodeBackgroundMarker)
// is stored as a hidden JSON data marker in the rendered page HTML rather
// than as a separate field, so it round-trips through import/export with
// zero schema changes. But *painting* it requires a sibling of
// .detail-content — content inside .detail-content is a stacking context
// that always composites above the watermark, however it's z-indexed
// internally (see that file's comment for the full explanation). The
// standalone deck's own slide-rendering code (in its tail <script>,
// preserved byte-for-byte from the original file we're re-exporting, or
// reused verbatim from GENERIC_TAIL for a from-scratch deck) has no
// knowledge of that marker, so this patches a small self-contained lookup
// into the one spot both versions share — right where each
// <section class="slide …"> is built — rather than rewriting the tail's
// slide-rendering logic wholesale. This still works unchanged now that
// pages render through renderScene(): a pure-legacy scene's rendered HTML
// *is* the original marker-bearing HTML verbatim, and even inside a mixed
// scene the marker is still findable by this same plain substring scan,
// wherever it's nested. The old plain-color-only marker (data-slide-bg-layer,
// predating this milestone) is still recognized as a fallback, so a
// background set before this milestone keeps rendering correctly.
const BG_LAYER_INJECTION = `\${(function(){
var src=(s.pages||[s.html])[0]||'';
var css='';
var nm=/<div[^>]*data-slide-bg='([^']*)'/.exec(src);
if(nm){
  try{
    var bg=JSON.parse(nm[1].replace(/&#39;/g,"'"));
    if(bg.kind==='color')css=bg.value;
    else if(bg.kind==='gradient')css=bg.value;
    else if(bg.kind==='image')css="url('"+bg.value+"') center/cover no-repeat";
  }catch(e){}
}
if(!css){
  var om=/<div[^>]*data-slide-bg-layer="([^"]*)"/.exec(src);
  if(om)css=om[1];
}
return css ? ('<div style="position:absolute;inset:0;z-index:-1;background:'+css+';pointer-events:none;"></div>') : '';
})()}`;

function injectBgLayerSupport(tailText: string): string {
  return tailText.replace(
    /(\$\{nodeFaceHtml\}\s*)(<div class="detail-content">)/,
    (_match, before, after) => `${before}${BG_LAYER_INJECTION}\n    ${after}`
  );
}

interface RenderedSlide {
  cls: string;
  pages: string[];
  notes: string;
}

function buildPushLines(slides: RenderedSlide[], varName: string): string {
  return slides
    .map((s) => {
      // Milestone 10: `notes` is a *real* field on the pushed object now,
      // not just the trailing `/*@notes:...*/` comment below — a JS comment
      // is invisible to the running deck's own code, so the presenter-mode
      // notes overlay (lib/presenterMode.ts) needs actual runtime-readable
      // data to show `ALL_SLIDES[current].notes`. The comment stays
      // untouched and is still what importPresentation.ts's regex-based
      // extraction reads for the editor round-trip — this is a new,
      // parallel copy for the exported deck's own runtime, not a
      // replacement of the existing mechanism.
      const obj =
        s.pages.length > 1
          ? `{cls:${jsStr(s.cls)}, pages:[${s.pages.map(jsStr).join(', ')}], notes:${jsStr(s.notes)}}`
          : `{cls:${jsStr(s.cls)}, html:${jsStr(s.pages[0])}, notes:${jsStr(s.notes)}}`;
      let line = `${varName}.push(${obj});`;
      if (s.notes && s.notes.trim()) {
        line += `/*@notes:${btoa(unescape(encodeURIComponent(s.notes)))}*/`;
      }
      return line;
    })
    .join('\n');
}

// Resolves a Slide's `pages` (Scene ids) into actual HTML via the single
// renderScene() function — the same one the editor canvas uses — so export
// can never draw content that looks different from what was just edited.
// `section` (null for Q&A slides, which aren't in a section) feeds the same
// slide -> section -> deck background/master cascade Canvas.tsx resolves
// for the live preview (Milestones 4 & 5 — see scene/renderContext.ts).
// `componentsMap` is built once for the whole deck by the caller rather
// than per-slide, since it doesn't vary slide to slide. `pageNumber`/
// `pageCount` are likewise precomputed once by the caller (Milestone 10 —
// see buildExportHtml's own comment) rather than each slide calling
// renderContext.ts's mainSlideIndex/mainSlideCount, which re-flatten and
// linear-scan the whole section list on every call — fine for Canvas.tsx's
// single-slide-per-render use, but O(n^2) across a full-deck export loop.
function renderSlide(
  state: EditorState,
  slide: Slide,
  section: SectionMeta | null,
  componentsMap: Record<string, Scene>,
  pageNumber: number | null,
  pageCount: number
): RenderedSlide {
  const ctx: RenderContext = {
    master: resolveEffectiveMaster(state, section),
    pageNumber,
    pageCount,
    components: componentsMap,
    assets: state.assetsById,
  };
  return {
    cls: slide.cls,
    notes: slide.notes,
    pages: slide.pages.map((sceneId) => {
      const scene = state.scenesById[sceneId];
      if (!scene) return '';
      return renderScene(scene, 'export', { ...ctx, background: resolveEffectiveBackground(scene, section, state.meta) });
    }),
  };
}

// Flattens the normalized editor state (sections + slidesById map, with
// each slide's pages resolved from scenesById) back into the S / QA_SLIDES
// / NODE_META / CLUSTERS shape the presentation engine expects, then
// either splices it into the originally imported source text (preserving
// byte-for-byte fidelity for everything the editor doesn't touch) or drops
// it into the generic standalone template when no source file was ever
// imported.
export function buildExportHtml(state: EditorState): string {
  const componentsMap = buildComponentsMap(state);
  // Milestone 10: precomputed once for the whole deck instead of re-deriving
  // per slide — see renderSlide's doc comment above.
  const flatMainIds = state.sections.flatMap((sec) => sec.slideIds);
  const pageNumberById = new Map<string, number>();
  flatMainIds.forEach((id, i) => pageNumberById.set(id, i + 1));
  const pageCount = flatMainIds.length;

  const flatMain: RenderedSlide[] = [];
  state.sections.forEach((sec) =>
    sec.slideIds.forEach((id) =>
      flatMain.push(renderSlide(state, state.slidesById[id], sec, componentsMap, pageNumberById.get(id) ?? null, pageCount))
    )
  );
  const flatQA: RenderedSlide[] = state.qaSlideIds.map((id) =>
    renderSlide(state, state.slidesById[id], null, componentsMap, null, pageCount)
  );

  const slidesBlock =
    'const S = [];\n' +
    buildPushLines(flatMain, 'S') +
    '\n\nconst QA_SLIDES = [];\n' +
    buildPushLines(flatQA, 'QA_SLIDES') +
    '\n';

  let idx = 0;
  const nodeMetaEntries: string[] = [];
  const clusterEntries: string[] = [];
  state.sections.forEach((sec) => {
    const startIdx = idx;
    sec.slideIds.forEach((id) => {
      const sl = state.slidesById[id];
      nodeMetaEntries.push(
        `  {icon:${jsStr(sl.nodeIcon || 'clipboard')}, label:${jsStr(sl.nodeLabel || 'Diapositive')}},`
      );
      idx += 1;
    });
    const range: number[] = [];
    for (let i = startIdx; i < idx; i += 1) range.push(i);
    clusterEntries.push(
      `  {key:${jsStr(sec.id)}, label:${jsStr(sec.label)}, slides:[${range.join(',')}], color:${jsStr(
        sec.color
      )}, tint:${jsStr(sec.tint)}, border:${jsStr(sec.border)}},`
    );
  });
  // Milestone D: resolve state.edges (Slide-id pairs) into the 0-based
  // global indices the tail script's nodePos array uses — reusing the same
  // pageNumberById map built above (its value is 1-based page number, so
  // -1 gives the 0-based node index) rather than building a second lookup.
  // Edges referencing a slide that isn't a main-deck slide (shouldn't
  // happen — reducer.ts's ADD_EDGE/REDIRECT_EDGE validate this — but
  // defensively skipped rather than crashing export) are dropped.
  const edgePairs: string[] = [];
  state.edges.forEach((edge) => {
    const fromIdx = pageNumberById.get(edge.from);
    const toIdx = pageNumberById.get(edge.to);
    if (fromIdx == null || toIdx == null) return;
    edgePairs.push(`[${fromIdx - 1},${toIdx - 1}]`);
  });
  const nodeMetaBlock =
    '/* ============================================================\n' +
    '   NODE METADATA + CLUSTER LAYOUT (the "graph")\n' +
    '   ============================================================ */\n' +
    'const NODE_META = [\n' +
    nodeMetaEntries.join('\n') +
    '\n];\n\n' +
    'const CLUSTERS = [\n' +
    clusterEntries.join('\n') +
    '\n];\n\n' +
    `const EDGES = [${edgePairs.join(',')}];\n\n`;

  // Milestone 8's entrance/emphasis preset CSS (lib/animationCss.js),
  // Milestone 10's presenter-mode overlay CSS (lib/presenterMode.ts), and
  // Milestone 11's print/PDF layout (lib/printMode.ts) are all applied on
  // the fly here, same reasoning as theme tokens above: never persisted
  // into state.meta.styleBlock itself, just merged into whatever gets
  // written into the exported <style> block.
  const effectiveStyleBlock = ensurePrintCss(ensurePresenterCss(ensureAnimationCss(state.meta.styleBlock)));

  if (state.meta.originalText) {
    const text = state.meta.originalText;
    const sIdx = text.indexOf('const S = []');
    const stageIdx = text.indexOf('const STAGE_W');
    if (sIdx > -1 && stageIdx > -1) {
      const head = withCurrentTitle(withCurrentStyleBlock(text.slice(0, sIdx), effectiveStyleBlock), state.meta.title);
      const tail = injectEdgeGraphSupport(injectPresenterMode(injectBgLayerSupport(text.slice(stageIdx))));
      return head + slidesBlock + '\n' + nodeMetaBlock + tail;
    }
  }
  const head = withCurrentTitle(withCurrentStyleBlock(GENERIC_HEAD, effectiveStyleBlock), state.meta.title);
  return head + slidesBlock + '\n' + nodeMetaBlock + injectEdgeGraphSupport(injectPresenterMode(injectBgLayerSupport(GENERIC_TAIL)));
}

// Theme-token edits (Milestone 4) only ever touch state.meta.styleBlock —
// the copy importPresentation.ts extracted for the *live editor's* iframe
// rendering (Canvas.tsx/buildSlideDoc). Without this, export would keep
// splicing the original document's own untouched <style> block (or the
// static GENERIC_HEAD for a from-scratch deck) and every theme change
// would silently vanish on export despite looking correct in the editor.
function withCurrentStyleBlock(head: string, styleBlock: string): string {
  if (!/<style>[\s\S]*?<\/style>/.test(head)) return head;
  return head.replace(/<style>[\s\S]*?<\/style>/, `<style>${styleBlock}</style>`);
}

// Milestone C (v2): same reasoning as withCurrentStyleBlock, one tag over —
// `state.meta.title` is itself seeded from the original file's own <title>
// on import (importPresentation.ts), so this is a no-op (writes back the
// same text) for any deck the user hasn't renamed, and correctly reflects
// a rename otherwise. Without this, a title typed into TopBar.jsx's input
// (or set once at creation via NewPresentationModal) only ever showed up
// in the editor UI and the downloaded filename — never in the exported
// file's own <title> tag or browser-tab text.
function withCurrentTitle(head: string, title: string): string {
  if (!/<title>[\s\S]*?<\/title>/.test(head)) return head;
  const escaped = (title || 'Présentation').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return head.replace(/<title>[\s\S]*?<\/title>/, `<title>${escaped}</title>`);
}

// Milestone 11: generalized so lib/projectFile.ts's JSON project save can
// reuse the exact same download mechanics instead of duplicating them for
// a second mime type.
export function downloadBlob(name: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadFile(name: string, content: string): void {
  downloadBlob(name, content, 'text/html');
}

export function exportPresentation(state: EditorState): void {
  const html = buildExportHtml(state);
  const name = `${(state.meta.title || 'presentation').replace(/[^a-z0-9\-_]+/gi, '_')}.html`;
  downloadFile(name, html);
}

// Opens the live deck in a new tab without writing a file to disk — same
// buildExportHtml() output as Export, just handed straight to a window
// instead of a download. Deliberately uses document.write() rather than a
// blob: URL: a blob: URL has no hierarchical path, so the deck's relative
// image/video references (e.g. "vid1.mp4") can't resolve against it. A
// window opened with an empty URL and written into inherits the opener's
// location as its base URL, so those relative paths resolve exactly like
// they do in the editor itself.
//
// Milestone B (v2, two-window presenter mode): `presenterView` marks the
// opened window as the presenter tab rather than the audience tab —
// lib/presenterMode.ts's injected script reads this flag at load to decide
// which layout to render. Both tabs are built from the exact same
// buildExportHtml() output; only this one flag differs. The flag can't
// travel via a URL query string the way it would for the *downloaded* file
// (window.open('', ...) never navigates to a real URL, so location.search
// stays empty no matter what), so it's stamped as a literal inline
// <script> at the very start of <head> instead — evaluated before
// presenterMode.ts's own injected IIFE runs later in the document, which is
// all that's required since that IIFE only reads the flag once, on load.
export function presentPresentation(state: EditorState, opts: { presenterView?: boolean } = {}): void {
  let html = buildExportHtml(state);
  if (opts.presenterView) {
    html = html.replace('<head>', '<head><script>window.__presStudioPresenterView = true;</script>');
  }
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Fenêtre bloquée par le navigateur : autorisez les pop-ups pour ce site puis réessayez.');
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
