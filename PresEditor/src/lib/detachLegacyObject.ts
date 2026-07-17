import { createTextObject, createImageObject } from '../scene/objectDefaults';
import type { SceneObject } from '../types/scene';

// A legacy-html object (any imported slide's content on day one — see
// scene/legacyHtmlAdapter.ts) and a text object both bundle everything
// inside them as one opaque `data.html` blob: one Layers-panel row, one
// draggable box for a title + paragraph + bullet list + image that a user
// would expect to move/resize/delete independently. "Détacher en objets"
// (LayersPanel.tsx) turns that blob into several native scene objects —
// this is the pure part: given the *live* rendered container element,
// decide what the pieces are and where each one currently sits.
//
// Descends through single-element-child wrapper chains (the common `.pad`
// container every built-in slide layout in lib/layouts.js uses, and the
// equivalent in most hand-authored decks) until reaching a node with
// either zero or >=2 element children, then treats that node's own
// children (or the node itself, if it turns out to be a leaf with no
// element children at all) as the pieces to pull out.
function pickExtractionTargets(container: HTMLElement): HTMLElement[] {
  let node = container;
  while (node.children.length === 1) {
    node = node.children[0] as HTMLElement;
  }
  if (node.children.length === 0) return [node];
  return Array.from(node.children) as HTMLElement[];
}

// `containerEl` must be a live element inside the canvas iframe (the
// object's own `.legacy-content` wrapper, or the object's wrapper itself
// for a text object — see EditorContext.tsx's detachObject). Within that
// iframe's own document, clientX/clientY — and therefore
// getBoundingClientRect() — are already scene-space pixels 1:1 regardless
// of the outer canvas's current zoom/pan (the same invariant
// sceneEditing.ts's drag/resize handlers rely on), so each extracted
// piece lands at exactly its current on-screen position: the split is
// visually a no-op at the moment it happens, only *afterward* can each
// piece be moved independently.
//
// Returns null when there's nothing meaningful to split (the content
// boils down to a single leaf element) — the caller treats that as a
// no-op rather than replacing one object with a second, identical one.
export function detachHtmlIntoObjects(containerEl: HTMLElement, zIndexBase: number): SceneObject[] | null {
  const targets = pickExtractionTargets(containerEl);
  if (targets.length < 2) return null;

  const win = containerEl.ownerDocument.defaultView || window;
  return targets.map((el, i) => {
    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left);
    const y = Math.round(rect.top);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const zIndex = zIndexBase + i;

    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') || '';
      // Preserve the original's object-fit when it was deliberately set to
      // 'contain' (a photo meant to be seen whole rather than cropped) —
      // ImageObject only models the two fits the Inspector itself exposes.
      const fit = win.getComputedStyle(el).objectFit === 'contain' ? 'contain' : 'cover';
      return createImageObject(src, { x, y, width, height, data: { src, fit } }, zIndex);
    }
    return createTextObject({ x, y, width, height, data: { html: el.outerHTML } }, zIndex);
  });
}
