// Milestone A (editor usability overhaul): a real zoom/pan system, built as
// a drop-in replacement for Canvas.tsx's old `fitScaler` — same technique
// (write `transform` on `.ed-canvas-scaler` directly via a ref, no React
// re-render per tick), extended with a user-controlled zoom level, panning,
// and Ctrl/Cmd+scroll-toward-cursor.
//
// Why this never touches sceneEditing.ts's drag/resize/rotate/marquee math:
// those handlers read `MouseEvent.clientX/clientY` from listeners bound
// *inside* the canvas iframe's own document, and a same-origin iframe
// always reports pointer coordinates in its own internal layout space —
// the browser itself resolves any CSS `transform: scale()` on the iframe
// (or its ancestors, i.e. `.ed-canvas-scaler` below) before dispatching the
// event, as part of normal hit-testing through a transformed nested
// browsing context. So as long as zoom is applied purely as an outer CSS
// transform (never by resizing the iframe's own width/height), every one
// of those handlers keeps working completely unmodified — this is already
// proven true today, since `fitScaler` already shrinks the canvas on small
// screens and dragging/resizing already works correctly.
//
// The one place zoom *does* need to be known outside the reducer/scene
// math is converting iframe-local coordinates (wheel/pan gestures that
// start while the cursor is over the slide content, forwarded out via
// sceneEditing.ts's callbacks — keydown/wheel/mousedown on an iframe's own
// document never bubble to the parent window, so those gestures need
// explicit forwarding, the same reason sceneEditing.ts already duplicates
// undo/redo/select-all/escape/delete handling for when focus is inside the
// iframe) back into on-screen pixels, so the resulting pan/zoom lands in
// the same visual place the cursor was. `iframeToScreen` below is that one
// conversion point.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { PAGE_WIDTH, PAGE_HEIGHT, clamp } from '../scene/geometry';
import { isTypingContext } from './useKeyboardShortcuts';

export const ZOOM_MIN = 10;
export const ZOOM_MAX = 400;
// Discrete stops for the +/- buttons and Ctrl/Cmd+Plus/Minus — continuous
// (non-stepped) zoom is reserved for the smoother Ctrl/Cmd+scroll gesture.
const ZOOM_STEPS = [10, 25, 50, 75, 100, 125, 150, 200, 300, 400];
const FIT_PADDING = 40;

export type ZoomAction = 'in' | 'out' | 'fit' | 'actual';

export interface CanvasZoomApi {
  zoomPercent: number;
  isFit: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
  zoomToActual: () => void;
  // Wired straight into wireSceneObjects()'s callbacks object — see
  // sceneEditing.ts's SceneEditingCallbacks for why these forward raw
  // iframe-local coordinates rather than pre-converted deltas.
  onIframeZoomShortcut: (action: ZoomAction) => void;
  onIframeWheelZoom: (deltaY: number, clientX: number, clientY: number) => void;
  // Exposed for Canvas.tsx's right-click context menu, which needs to
  // position a *parent-document* React element at the same point a
  // right-click landed inside the iframe — the one place outside this
  // hook that legitimately needs this conversion (it's positioning UI
  // chrome, not doing scene/object math).
  iframeToScreen: (clientX: number, clientY: number) => { x: number; y: number };
  // The shared Space-held ref's read/write pair — see spaceHeldRef's own
  // comment above for why this must be shared, not tracked independently
  // per document.
  isSpaceHeld: () => boolean;
  setSpaceHeld: (held: boolean) => void;
  onIframePanStart: () => void;
  onIframePanMove: (movementX: number, movementY: number) => void;
  onIframePanEnd: () => void;
}

export function useCanvasZoom(
  stageRef: RefObject<HTMLDivElement | null>,
  scalerRef: RefObject<HTMLDivElement | null>,
  frameRef: RefObject<HTMLIFrameElement | null>,
  refitDeps: unknown[] = []
): CanvasZoomApi {
  const [zoomPercent, setZoomPercent] = useState(100);
  const [isFit, setIsFit] = useState(true);
  const zoomRef = useRef(100);
  const zoomModeRef = useRef<'fit' | 'manual'>('fit');
  const panRef = useRef({ x: 0, y: 0 });
  const displayFrameRef = useRef<number | null>(null);
  // Whether the pan modifier (Space) is currently held — a single shared
  // ref rather than one tracked independently per document. A same-origin
  // iframe has its own separate keydown/keyup target: if this were tracked
  // separately in the parent window and inside sceneEditing.ts's iframe
  // document, a Space-keydown caught by whichever document *doesn't*
  // currently have focus would never update the other's copy — e.g. the
  // user clicks a toolbar button (parent-document focus), then holds Space
  // and drags starting over the canvas (iframe-document mousedown): the
  // iframe's own local tracking would never have seen that keydown. Both
  // sceneEditing.ts's own keydown/keyup listener (for focus-inside-iframe)
  // and this hook's window-level one (for focus-in-chrome) write to this
  // *same* ref object — same-origin frames can synchronously share a plain
  // object reference, so whichever document's listener fires first, both
  // sides see the update immediately, no postMessage/polling needed.
  const spaceHeldRef = useRef(false);

  const applyTransform = useCallback(() => {
    const scaler = scalerRef.current;
    if (!scaler) return;
    const { x, y } = panRef.current;
    scaler.style.transform = `translate(${x}px, ${y}px) scale(${zoomRef.current / 100})`;
  }, [scalerRef]);

  // Batches the (purely cosmetic) React state used by ZoomControls' % label
  // and button states — the transform itself is written synchronously above
  // regardless, so a fast wheel-zoom gesture never visually lags even though
  // the displayed percentage updates once per frame.
  const scheduleDisplayUpdate = useCallback(() => {
    if (displayFrameRef.current != null) return;
    displayFrameRef.current = requestAnimationFrame(() => {
      displayFrameRef.current = null;
      setZoomPercent(Math.round(zoomRef.current));
      setIsFit(zoomModeRef.current === 'fit');
    });
  }, []);

  const computeFitPercent = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return 100;
    const scale = Math.min(
      (stage.clientWidth - FIT_PADDING) / PAGE_WIDTH,
      (stage.clientHeight - FIT_PADDING) / PAGE_HEIGHT,
      1
    );
    return clamp(Math.round(Math.max(scale, ZOOM_MIN / 100) * 100), ZOOM_MIN, ZOOM_MAX);
  }, [stageRef]);

  const setZoom = useCallback(
    (percent: number, mode: 'fit' | 'manual', opts?: { resetPan?: boolean }) => {
      zoomRef.current = clamp(percent, ZOOM_MIN, ZOOM_MAX);
      zoomModeRef.current = mode;
      if (opts?.resetPan) panRef.current = { x: 0, y: 0 };
      applyTransform();
      scheduleDisplayUpdate();
    },
    [applyTransform, scheduleDisplayUpdate]
  );

  const zoomToFit = useCallback(() => {
    setZoom(computeFitPercent(), 'fit', { resetPan: true });
  }, [computeFitPercent, setZoom]);

  const zoomToActual = useCallback(() => {
    setZoom(100, 'manual', { resetPan: true });
  }, [setZoom]);

  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      const current = zoomRef.current;
      const next =
        dir === 1
          ? ZOOM_STEPS.find((s) => s > current + 0.5) ?? ZOOM_MAX
          : [...ZOOM_STEPS].reverse().find((s) => s < current - 0.5) ?? ZOOM_MIN;
      setZoom(next, 'manual');
    },
    [setZoom]
  );

  const zoomIn = useCallback(() => stepZoom(1), [stepZoom]);
  const zoomOut = useCallback(() => stepZoom(-1), [stepZoom]);

  // Standard "zoom toward point" formula: keep the stage-space point under
  // the cursor fixed while the zoom factor changes.
  const zoomTowardScreenPoint = useCallback(
    (deltaY: number, screenX: number, screenY: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const cursorOffsetX = screenX - (rect.left + rect.width / 2);
      const cursorOffsetY = screenY - (rect.top + rect.height / 2);
      const oldZoom = zoomRef.current;
      const factor = Math.exp(-deltaY * 0.0015);
      const newZoom = clamp(oldZoom * factor, ZOOM_MIN, ZOOM_MAX);
      const ratio = newZoom / oldZoom;
      panRef.current = {
        x: cursorOffsetX - (cursorOffsetX - panRef.current.x) * ratio,
        y: cursorOffsetY - (cursorOffsetY - panRef.current.y) * ratio,
      };
      zoomRef.current = newZoom;
      zoomModeRef.current = 'manual';
      applyTransform();
      scheduleDisplayUpdate();
    },
    [applyTransform, scheduleDisplayUpdate, stageRef]
  );

  // Applies a pan gesture's incremental movement directly — see this
  // function's callers for why a *delta* (MouseEvent.movementX/Y) is used
  // rather than diffing successive clientX/clientY positions. Shared by
  // both the stage-level (parent-document, pasteboard-margin) and
  // iframe-forwarded (over-the-slide) pan paths below: once expressed as
  // movementX/Y, both are the exact same operation.
  const applyPanDelta = useCallback(
    (movementX: number, movementY: number) => {
      panRef.current = { x: panRef.current.x + movementX, y: panRef.current.y + movementY };
      applyTransform();
    },
    [applyTransform]
  );

  const beginPan = useCallback(() => {
    if (stageRef.current) stageRef.current.style.cursor = 'grabbing';
  }, [stageRef]);

  const endPan = useCallback(() => {
    if (stageRef.current) stageRef.current.style.cursor = '';
  }, [stageRef]);

  // Converts an iframe-local point (what sceneEditing.ts's handlers see)
  // into on-screen page coordinates — see this file's top comment for why.
  const iframeToScreen = useCallback(
    (clientX: number, clientY: number) => {
      const frame = frameRef.current;
      if (!frame) return { x: clientX, y: clientY };
      const rect = frame.getBoundingClientRect();
      const zf = zoomRef.current / 100;
      return { x: rect.left + clientX * zf, y: rect.top + clientY * zf };
    },
    [frameRef]
  );

  const onIframeZoomShortcut = useCallback(
    (action: ZoomAction) => {
      if (action === 'in') zoomIn();
      else if (action === 'out') zoomOut();
      else if (action === 'fit') zoomToFit();
      else zoomToActual();
    },
    [zoomIn, zoomOut, zoomToFit, zoomToActual]
  );

  const onIframeWheelZoom = useCallback(
    (deltaY: number, clientX: number, clientY: number) => {
      const { x, y } = iframeToScreen(clientX, clientY);
      zoomTowardScreenPoint(deltaY, x, y);
    },
    [iframeToScreen, zoomTowardScreenPoint]
  );

  // Panning is tracked differently from the one-shot conversions above:
  // `iframeToScreen` re-reads the iframe's *live* getBoundingClientRect()
  // every call — correct for a single point-in-time conversion (wheel-zoom,
  // below), but NOT used for panning: sceneEditing.ts forwards
  // movementX/movementY for pan moves precisely so this file never needs to
  // touch the iframe's (constantly-changing-during-a-pan) bounding rect at
  // all for that gesture — see onPanMouseDown's comment in sceneEditing.ts
  // for the moving-reference-frame problem that caused when this used to
  // convert an iframe-local *position* on every move instead.
  const onIframePanStart = beginPan;
  const onIframePanMove = applyPanDelta;

  const isSpaceHeld = useCallback(() => spaceHeldRef.current, []);
  const setSpaceHeld = useCallback((held: boolean) => {
    spaceHeldRef.current = held;
  }, []);

  // ---- fit-on-resize (only while zoomMode==='fit' — a manual zoom level
  // survives window resizes and panel collapses untouched) ----
  useEffect(() => {
    function refit() {
      if (zoomModeRef.current !== 'fit') return;
      setZoom(computeFitPercent(), 'fit');
    }
    refit();
    window.addEventListener('resize', refit);
    const ro = new ResizeObserver(refit);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => {
      window.removeEventListener('resize', refit);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computeFitPercent, setZoom, stageRef, ...refitDeps]);

  // ---- stage-level (parent document) wheel-zoom + space/middle-drag pan —
  // covers the pasteboard margin around the slide; the iframe-forwarded
  // versions above cover gestures starting over the slide itself ----
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    function onWindowKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && !isTypingContext()) spaceHeldRef.current = true;
    }
    function onWindowKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') spaceHeldRef.current = false;
    }
    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('keyup', onWindowKeyUp);

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTowardScreenPoint(e.deltaY, e.clientX, e.clientY);
    }
    stage.addEventListener('wheel', onWheel, { passive: false });

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 1 && !(e.button === 0 && spaceHeldRef.current)) return;
      e.preventDefault();
      beginPan();
      function onMove(ev: MouseEvent) {
        applyPanDelta(ev.movementX, ev.movementY);
      }
      function onUp() {
        endPan();
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    stage.addEventListener('mousedown', onMouseDown);

    return () => {
      window.removeEventListener('keydown', onWindowKeyDown);
      window.removeEventListener('keyup', onWindowKeyUp);
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('mousedown', onMouseDown);
    };
  }, [stageRef, zoomTowardScreenPoint, beginPan, applyPanDelta, endPan]);

  // ---- global (parent-document) keyboard shortcuts: Ctrl/Cmd +/-/0/1 ----
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta || isTypingContext()) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        zoomToFit();
      } else if (e.key === '1') {
        e.preventDefault();
        zoomToActual();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomIn, zoomOut, zoomToFit, zoomToActual]);

  return {
    zoomPercent,
    isFit,
    zoomIn,
    zoomOut,
    zoomToFit,
    zoomToActual,
    onIframeZoomShortcut,
    onIframeWheelZoom,
    iframeToScreen,
    isSpaceHeld,
    setSpaceHeld,
    onIframePanStart,
    onIframePanMove,
    onIframePanEnd: endPan,
  };
}
