import { createLegacyHtmlObject, createScene } from './objectDefaults';
import { PAGE_WIDTH, PAGE_HEIGHT } from './geometry';
import type { Scene } from '../types/scene';

// The backward-compatibility seam (see the Presentation Studio plan's
// "central tension" section). An imported slide page's raw HTML becomes a
// Scene containing exactly one full-bleed legacy-html object.
export function wrapHtmlAsScene(html: string): Scene {
  return createScene([createLegacyHtmlObject(html)]);
}

// The inverse: if a scene is *still* in that exact untouched shape — one
// full-bleed, unrotated, fully-opaque, visible legacy-html object and
// nothing else — return its raw HTML so renderScene() can emit it
// completely unwrapped, byte-identical to the original import. Returns
// null the moment the scene has been genuinely edited (a second object
// added, or the legacy object moved/resized/rotated/faded/hidden), which
// is also correctly the point where "this is no longer just the original
// slide" becomes true.
export function unwrapIfPureLegacy(scene: Scene): string | null {
  if (scene.objectOrder.length !== 1) return null;
  const obj = scene.objectsById[scene.objectOrder[0]];
  if (!obj || obj.type !== 'legacy-html') return null;
  const isFullBleed =
    obj.x === 0 &&
    obj.y === 0 &&
    obj.width === PAGE_WIDTH &&
    obj.height === PAGE_HEIGHT &&
    obj.rotation === 0 &&
    obj.opacity === 1 &&
    !obj.hidden;
  return isFullBleed ? obj.data.html : null;
}
