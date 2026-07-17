// A picked background color is stored purely as *data* — a hidden marker
// element carrying the color in its own attribute value, never rendering
// anything itself. Painting happens separately, at render time, as a
// sibling element positioned *behind* the slide's blurred logo watermark
// (z-index:-1, sibling of .detail-content — see buildSlideDoc() in
// canvasEditing.js and the export tail patch in exportPresentation.js).
//
// This two-step split matters: content pushed into `.detail-page` ends up
// nested inside `.detail-content`, which the deck's own stylesheet gives
// `position:relative; z-index:1`. That establishes a stacking context, so
// *anything* inside it — however it's positioned or z-indexed internally —
// is composited as a single unit above `.slide::before` (the watermark,
// z-index:0). There is no z-index trick from inside that subtree that can
// escape it; painting behind the watermark requires a real sibling of
// .detail-content, which only the two render sites above can produce.
const MARK_ATTR = 'data-slide-bg-layer';

export function readBgColorFromHtml(html) {
  if (!html) return null;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const first = holder.firstElementChild;
  if (first && first.hasAttribute(MARK_ATTR)) {
    return first.getAttribute(MARK_ATTR) || null;
  }
  return null;
}

export function applyBgColorToHtml(html, color) {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  const first = holder.firstElementChild;
  const hasLayer = first && first.hasAttribute(MARK_ATTR);
  if (!color) {
    if (hasLayer) first.remove();
    return holder.innerHTML;
  }
  if (hasLayer) {
    first.setAttribute(MARK_ATTR, color);
  } else {
    const marker = document.createElement('div');
    marker.setAttribute(MARK_ATTR, color);
    marker.style.display = 'none';
    holder.insertBefore(marker, holder.firstChild);
  }
  return holder.innerHTML;
}

// --- Milestone 4: structured background (Scene.background) -----------
//
// Same "paint behind the watermark via a sibling marker div" trick as
// above (see the file-level comment), generalized to color/gradient/image
// and to *any* scene — not just ones with a legacy-html object to hide the
// marker inside. `renderScene()` prepends `encodeBackgroundMarker()`'s
// output as a literal sibling ahead of the scene's own content whenever an
// effective background is resolved (slide -> section -> deck cascade, see
// `resolveEffectiveBackground`); `findBackgroundInHtml()` is what recovers
// it again, on both the live canvas (lib/canvasEditing.js's buildSlideDoc)
// and export (exportPresentation.ts's BG_LAYER_INJECTION tail-patch) —
// searched anywhere in the string, not just as the first child, which also
// fixes a latent bug in the *old* single-page marker: once Milestone 1
// started wrapping every object in its own `data-object-id` div, the old
// marker was no longer literally `holder.firstElementChild` in edit mode,
// so `readBgColorFromHtml` silently stopped finding it there (export still
// worked, since its own tail-patch already did a full-string regex scan —
// only the live *editor preview* was affected).
const NEW_MARK_ATTR = 'data-slide-bg';

export function backgroundToCss(bg) {
  if (!bg) return '';
  if (bg.kind === 'color') return bg.value;
  if (bg.kind === 'gradient') return bg.value;
  if (bg.kind === 'image') return `url('${bg.value}') center/cover no-repeat`;
  return '';
}

export function encodeBackgroundMarker(bg) {
  if (!bg) return '';
  const payload = JSON.stringify(bg).replace(/'/g, '&#39;');
  return `<div ${NEW_MARK_ATTR}='${payload}' style="display:none"></div>`;
}

// Structured marker takes priority; the old plain-color marker is still
// recognized as a fallback so a background set before this milestone (or
// re-imported from a file saved back then) keeps rendering correctly.
export function findBackgroundInHtml(html) {
  if (!html) return null;
  const newMatch = /<div[^>]*data-slide-bg='([^']*)'/.exec(html);
  if (newMatch) {
    try {
      return JSON.parse(newMatch[1].replace(/&#39;/g, "'"));
    } catch {
      /* malformed marker — fall through to the old-format check */
    }
  }
  const oldMatch = /<div[^>]*data-slide-bg-layer="([^"]*)"/.exec(html);
  if (oldMatch) return { kind: 'color', value: oldMatch[1] };
  return null;
}

// Slide's own background wins; falls back to its section's default, then
// the deck-wide default; null (the deck's own default CSS) if none are set.
export function resolveEffectiveBackground(scene, section, meta) {
  return (scene && scene.background) || (section && section.defaultBackground) || (meta && meta.defaultBackground) || null;
}
