// Rect/rotation math shared by renderScene() and sceneEditing.ts, so the
// two never compute overlapping geometry two different ways.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PAGE_WIDTH = 1280;
export const PAGE_HEIGHT = 720;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function rectCenter(rect: Rect): { cx: number; cy: number } {
  return { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2 };
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

// Angle (degrees, 0 = pointing up) from a rect's center to a point —
// used by the rotate handle to turn pointer position into a rotation value.
export function angleFromCenterToPoint(rect: Rect, px: number, py: number): number {
  const { cx, cy } = rectCenter(rect);
  const deg = radToDeg(Math.atan2(px - cx, -(py - cy)));
  return (deg + 360) % 360;
}

export function clampToPage(rect: Rect): Rect {
  return {
    x: clamp(rect.x, 0, Math.max(0, PAGE_WIDTH - rect.width)),
    y: clamp(rect.y, 0, Math.max(0, PAGE_HEIGHT - rect.height)),
    width: rect.width,
    height: rect.height,
  };
}

// Milestone 6 (diagram connectors): where a ray from `rect`'s center
// toward (towardX, towardY) crosses `rect`'s boundary — i.e. the point a
// connector line should actually touch, instead of running straight into
// the box and stopping at its center. Uses `rect`'s axis-aligned bounding
// box regardless of the object's true shape (ellipse/diamond), a
// deliberate simplification: the clipped point lands slightly outside an
// ellipse's or diamond's actual visual outline on a diagonal connection,
// which is close enough to look intentional without needing per-shape
// boundary math for a first pass.
export function clipPointToRect(rect: Rect, towardX: number, towardY: number): { x: number; y: number } {
  const { cx, cy } = rectCenter(rect);
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}
