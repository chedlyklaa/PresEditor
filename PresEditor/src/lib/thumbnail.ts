// Presentation library dashboard (Milestone C): renders the deck's first
// slide through the exact same renderScene() export path exportPresentation.ts
// uses — no headless browser, no screenshot service — then rasterizes that
// HTML into a small PNG data URL for a dashboard card.
//
// The one non-obvious piece: <foreignObject> content inside an SVG must be
// well-formed XML, but this app's rendered slide HTML is ordinary
// (sometimes hand-authored-origin) HTML with unclosed void tags (<br>,
// <img>), which breaks a naive string-concat-into-SVG approach. The fix —
// the same trick html-to-image-style libraries use — is to let the
// browser's own lenient HTML parser (DOMParser) build a real DOM tree first,
// then re-serialize *that* via XMLSerializer, which always emits
// well-formed XML regardless of how messy the source markup was.
import { renderScene, type RenderContext } from '../scene/renderScene';
import { resolveEffectiveBackground } from './slideBackground';
import { resolveEffectiveMaster, buildComponentsMap } from '../scene/renderContext';
import { buildSlideDoc } from './canvasEditing';
import type { EditorState, Slide, SectionMeta } from '../types/state';

const THUMB_W = 1280;
const THUMB_H = 720;

function firstSlideAndSection(state: EditorState): { slide: Slide; section: SectionMeta } | null {
  for (const section of state.sections) {
    if (section.slideIds.length === 0) continue;
    const slide = state.slidesById[section.slideIds[0]];
    if (slide) return { slide, section };
  }
  return null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

function docToForeignObjectSvgDataUrl(docHtml: string, width: number, height: number): string {
  const parsed = new DOMParser().parseFromString(docHtml, 'text/html');
  const htmlEl = parsed.documentElement;
  htmlEl.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const serialized = new XMLSerializer().serializeToString(htmlEl);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Returns null when the deck has no content yet (nothing sensible to
// thumbnail). Never throws — a rendering failure falls back to the SVG data
// URL itself (still a perfectly valid <img src>, just not flattened to a
// PNG) rather than losing the thumbnail entirely.
export async function renderThumbnail(state: EditorState): Promise<string | null> {
  const found = firstSlideAndSection(state);
  if (!found) return null;
  const { slide, section } = found;
  const sceneId = slide.pages[0];
  const scene = sceneId ? state.scenesById[sceneId] : null;
  if (!scene) return null;

  const ctx: RenderContext = {
    master: resolveEffectiveMaster(state, section),
    components: buildComponentsMap(state),
    assets: state.assetsById,
    background: resolveEffectiveBackground(scene, section, state.meta),
  };
  const html = renderScene(scene, 'export', ctx);
  // firstSlideAndSection always picks the first non-empty section, so this
  // is always index 0 — passed explicitly rather than hardcoded so this
  // stays correct if that helper's selection logic ever changes.
  const sectionIndex = state.sections.indexOf(section);
  const doc = buildSlideDoc({ cls: slide.cls, pages: [html] }, 0, state.meta.styleBlock, sectionIndex === -1 ? null : sectionIndex);
  const svgDataUrl = docToForeignObjectSvgDataUrl(doc, THUMB_W, THUMB_H);

  try {
    const img = await loadImage(svgDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    const c2d = canvas.getContext('2d');
    if (!c2d) return svgDataUrl;
    c2d.drawImage(img, 0, 0, THUMB_W, THUMB_H);
    return canvas.toDataURL('image/png');
  } catch {
    // Canvas tainting or a foreignObject-in-<img> quirk in some browser —
    // the raw SVG data URL still renders fine as an <img src> on its own.
    return svgDataUrl;
  }
}
