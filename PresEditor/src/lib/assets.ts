// Milestone 9 (Asset library): the dedup mechanism behind types/state.ts's
// Asset store. Dedup is by exact data: URL string equality, not a hash —
// at the realistic scale of a single presentation's asset library (tens to
// low hundreds of images, not thousands), a plain equality scan is both
// simpler and has zero collision risk, unlike a fixed-width content hash.
// This only runs on explicit "add photo" actions, never per-render.
import { uid } from './id';
import type { Asset } from '../types/state';

export function findDuplicateAsset(assetsById: Record<string, Asset>, dataUrl: string): Asset | null {
  for (const id of Object.keys(assetsById)) {
    if (assetsById[id].dataUrl === dataUrl) return assetsById[id];
  }
  return null;
}

// Decoded (not base64-encoded) byte size estimate, for the library UI —
// base64 inflates size by ~4/3, so this undoes that rather than showing the
// wire size of the string itself.
function approxDecodedBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  return Math.floor((b64.length * 3) / 4);
}

export function createAsset(dataUrl: string, kind: Asset['kind'], name: string): Asset {
  return {
    id: uid('asset'),
    kind,
    name,
    dataUrl,
    size: approxDecodedBytes(dataUrl),
    addedAt: Date.now(),
  };
}
