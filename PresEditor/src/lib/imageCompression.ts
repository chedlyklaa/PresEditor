// Every image a user adds — a photo object, a legacy-content image slot, a
// background picker, an asset-library upload — ends up embedded as a
// data: URL directly in the project JSON and, eventually, the exported
// single-file HTML (see lib/assets.ts's own comment on why: dedup is by
// exact string equality, no separate media hosting exists). An unmodified
// phone photo is routinely 4000px+ on a side and several MB — multiplied
// across a deck's worth of images, that's what actually produces the "large
// file" warnings this app already had (Canvas.tsx's warnIfLarge). Shrinking
// on the way in, once, here, is far cheaper than every later consumer
// (autosave payload size, export file size, MongoDB document size) paying
// for an oversized original forever.
const MAX_DIMENSION = 1920; // long-edge cap — comfortably above anything a 1280x720-based slide needs, even zoomed in
const JPEG_QUALITY = 0.85;
// Below this, skip touching the file entirely — not worth a quality
// trade-off (JPEG) or re-encode risk (PNG) for something already small.
const SKIP_THRESHOLD_BYTES = 400 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Decoded (not base64-encoded) byte size estimate — base64 inflates size by
// ~4/3, so this undoes that. Shared with lib/assets.ts's own copy of this
// same estimate (kept as two small copies rather than a new cross-import,
// since both are simple one-liners derived independently from the data URL
// they already have on hand).
function approxDecodedBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  return Math.floor((b64.length * 3) / 4);
}

// Resizes/re-encodes an image file to a data: URL, shrinking it when doing
// so actually helps. Non-image files (video) and SVG (a vector format a
// raster re-encode would only degrade) pass through untouched. Never
// throws — any decode/canvas failure falls back to the plain, unmodified
// data: URL, so a corrupt or unusually-encoded file still uploads instead
// of blocking the user.
export async function optimizeImageFile(file: File): Promise<string> {
  const original = await fileToDataUrl(file);
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.size <= SKIP_THRESHOLD_BYTES) {
    return original;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const lossless = file.type === 'image/png' || file.type === 'image/gif';

    if (scale >= 1 && !lossless) {
      // Already within the dimension cap, and re-encoding a same-size JPEG
      // at a fixed quality would just be a lossy no-op with no size win to
      // show for it.
      bitmap.close?.();
      return original;
    }

    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return original;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const optimized = lossless ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    // Guard against the rare case a re-encode comes out *larger* than the
    // original (can happen for an already-tiny/simple PNG) — never embed a
    // "optimized" file that's actually worse.
    return optimized.length < original.length ? optimized : original;
  } catch {
    return original;
  }
}

export function estimatedBytesOf(dataUrl: string): number {
  return approxDecodedBytes(dataUrl);
}
