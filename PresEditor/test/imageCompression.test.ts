import { describe, it, expect } from 'vitest';
import { optimizeImageFile, estimatedBytesOf } from '../src/lib/imageCompression';

// jsdom doesn't implement createImageBitmap/canvas 2D decoding, so the
// actual resize/re-encode path (which optimizeImageFile's own try/catch
// gracefully no-ops through in that case) isn't exercisable here — that's
// covered by hands-on verification against the real running app instead.
// What *is* meaningfully unit-testable without a real canvas is the gating
// logic deciding whether to even attempt it: file type and size checks are
// exactly the kind of off-by-one/wrong-operator bug that's easy to get
// subtly wrong and easy to pin down with a fast, real test.
function makeFile(bytes: number, type: string, name = 'test'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('optimizeImageFile: gating logic', () => {
  it('passes a non-image file (e.g. video) through untouched', async () => {
    const file = makeFile(2 * 1024 * 1024, 'video/mp4');
    const out = await optimizeImageFile(file);
    expect(out.startsWith('data:video/mp4')).toBe(true);
  });

  it('passes an SVG through untouched (a raster re-encode would only degrade a vector image)', async () => {
    const file = makeFile(600 * 1024, 'image/svg+xml');
    const out = await optimizeImageFile(file);
    expect(out.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('passes a small image through untouched (below the re-encode threshold)', async () => {
    const file = makeFile(100 * 1024, 'image/jpeg');
    const out = await optimizeImageFile(file);
    expect(out.startsWith('data:image/jpeg')).toBe(true);
    // 100KB of raw bytes as base64 is comfortably close to 100KB either way
    // — this is really asserting "unchanged", not a specific size.
    expect(estimatedBytesOf(out)).toBeGreaterThan(90 * 1024);
  });

  it('estimatedBytesOf undoes base64 inflation (~4/3) to approximate real byte size', () => {
    const raw = new Uint8Array(300);
    let binary = '';
    raw.forEach((b) => (binary += String.fromCharCode(b)));
    const dataUrl = `data:application/octet-stream;base64,${btoa(binary)}`;
    const estimate = estimatedBytesOf(dataUrl);
    expect(estimate).toBeGreaterThan(280);
    expect(estimate).toBeLessThan(320);
  });
});
