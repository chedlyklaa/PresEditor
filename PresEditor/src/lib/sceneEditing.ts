// Generalized select/drag/resize/rotate for scene objects inside the
// canvas iframe. Modeled directly on canvasEditing.js's wireFreeBlock
// pattern (mutate the element's inline style on every mousemove inside the
// iframe's own document, commit to React state only on mouseup) — but
// object-type-agnostic, and layered with a proper selection overlay
// (handles as a sibling layer, never nested inside an object's own
// content) so a native object's `data.html` never needs artifact-stripping
// the way legacy-html content does.
//
// Milestone 2 additions: shift-click / marquee multi-select, group-aware
// clicks (clicking any member of a `data-group-id` selects the whole
// group), multi-object drag, smart snap guides, alt-drag-duplicate, and
// shift-constrained axis drag. Resize/rotate remain single-object-only —
// deliberately out of scope for M2 (see the Presentation Studio plan).

import { clamp, degToRad, angleFromCenterToPoint, PAGE_WIDTH, PAGE_HEIGHT, type Rect } from '../scene/geometry';

export interface TransformPatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
}

export interface SceneEditingCallbacks {
  onSelect: (objectIds: string[]) => void;
  onCommitTransform: (objectId: string, patch: TransformPatch) => void;
  onCommitTransforms: (patches: Record<string, TransformPatch>) => void;
  onCommitText: (objectId: string, html: string) => void;
  onDeleteSelected: (objectIds: string[]) => void;
  onDuplicateSelected: (objectIds: string[], positionOverrides: Record<string, { x: number; y: number }>) => void;
  onUndo: () => void;
  onRedo: () => void;
  // Milestone A (v2 diagram builder): dragging from an object's hover
  // handle onto another object's body creates a connector between them.
  onCreateConnector: (fromId: string, toId: string) => void;
  // Dragging from a handle and releasing over empty canvas instead spawns a
  // brand-new default diagram node at the drop point, already connected to
  // the object the drag started from.
  onCreateConnectedNode: (fromId: string, x: number, y: number) => void;
  // A plain double-click on empty canvas (not on any object) — the caller
  // decides what to do with it (Canvas.tsx only acts on this while its own
  // "diagram mode" toggle is on), so this file stays free of any concept
  // of editing "modes".
  onEmptyCanvasDoubleClick: (x: number, y: number) => void;
  // Milestone A (editor usability overhaul): keydown/wheel/mousedown inside
  // this iframe's own document never reach the parent window (same reason
  // undo/redo/select-all/escape/delete are duplicated in this file's own
  // onKeyDown below) — these four forward the raw gesture out to
  // useCanvasZoom.ts, which owns the actual zoom/pan state and does the
  // iframe-local -> on-screen coordinate conversion. This file only ever
  // decides *whether* a gesture is zoom/pan (Ctrl+wheel, middle-drag,
  // space+drag) — it never computes a scale factor or touches any object's
  // geometry for it.
  onZoomShortcut: (action: 'in' | 'out' | 'fit' | 'actual') => void;
  onWheelZoom: (deltaY: number, clientX: number, clientY: number) => void;
  // Shared with useCanvasZoom.ts's own parent-document Space tracking (see
  // its spaceHeldRef doc comment) — this file still needs its own
  // keydown/keyup listeners below (a same-origin iframe never sees a
  // keydown dispatched to the parent document), but reads/writes the same
  // underlying ref via these two rather than keeping an independent local
  // flag that could desync from the parent's.
  isPanModifierHeld: () => boolean;
  setPanModifierHeld: (held: boolean) => void;
  onPanStart: () => void;
  // movementX/Y, not absolute clientX/Y — see onPanMouseDown's own comment
  // for why an iframe-local *position* is unusable for this once the
  // gesture itself starts moving the iframe.
  onPanMove: (movementX: number, movementY: number) => void;
  onPanEnd: () => void;
  // Milestone B (editor usability overhaul): right-click on an object or
  // on empty canvas. `objectId` is null for empty canvas. Selection is
  // already updated (to the clicked object's group, if it wasn't already
  // part of the current selection) by the time this fires, matching how
  // right-click behaves in every other editor — the menu always acts on
  // whatever's selected, never on a stale prior selection.
  onContextMenu: (clientX: number, clientY: number, objectId: string | null) => void;
}

export interface SceneEditingController {
  setSelectedObjectIds: (objectIds: string[]) => void;
  destroy: () => void;
}

const MIN_SIZE = 40;
const SNAP_THRESHOLD = 6;

function readRect(el: HTMLElement): Rect {
  return {
    x: parseFloat(el.style.left) || 0,
    y: parseFloat(el.style.top) || 0,
    width: parseFloat(el.style.width) || el.offsetWidth,
    height: parseFloat(el.style.height) || el.offsetHeight,
  };
}

function readRotation(el: HTMLElement): number {
  const match = /rotate\(([-\d.]+)deg\)/.exec(el.style.transform || '');
  return match ? parseFloat(match[1]) : 0;
}

function applyRotation(el: HTMLElement, rotation: number) {
  el.style.transform = rotation ? `rotate(${rotation}deg)` : '';
}

function unionRect(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((x) => setA.has(x));
}

// Every editor-chrome element sceneEditing.ts manages (overlays, guides,
// the text toolbar) gets this same z-index. Imported legacy-html content
// can carry its own arbitrary z-index values (decorative badges, layered
// cards, ...); without an explicit, deliberately-huge value here, plain
// DOM-order stacking isn't reliably enough to keep editor chrome above
// whatever a slide's own content happens to declare — the text-formatting
// toolbar in particular has been caught behind a legacy image element this
// way.
const CHROME_Z_INDEX = 100000;

export function wireSceneObjects(root: HTMLElement, doc: Document, callbacks: SceneEditingCallbacks): SceneEditingController {
  // Single-object overlay: box + resize/rotate handles (M1 behavior,
  // unchanged — only ever shown when exactly one object is selected).
  const overlay = doc.createElement('div');
  overlay.className = 'scene-overlay';
  overlay.style.cssText = `position:absolute; display:none; pointer-events:none; z-index:${CHROME_Z_INDEX};`;
  const moveHandleZone = doc.createElement('div');
  moveHandleZone.className = 'scene-overlay-box';
  const resizeHandle = doc.createElement('span');
  resizeHandle.className = 'scene-handle scene-handle-resize';
  const rotateHandle = doc.createElement('span');
  rotateHandle.className = 'scene-handle scene-handle-rotate';
  overlay.append(moveHandleZone, resizeHandle, rotateHandle);

  // Multi-select overlay: plain bounding-box outline, no handles.
  const multiOverlay = doc.createElement('div');
  multiOverlay.className = 'scene-multi-overlay';
  multiOverlay.style.cssText = `position:absolute; display:none; pointer-events:none; z-index:${CHROME_Z_INDEX};`;

  // Marquee (rubber-band) selection rectangle.
  const marquee = doc.createElement('div');
  marquee.className = 'scene-marquee';
  marquee.style.cssText = `position:absolute; display:none; pointer-events:none; z-index:${CHROME_Z_INDEX};`;

  // Smart snap guide lines.
  const guideV = doc.createElement('div');
  guideV.className = 'scene-guide-v';
  guideV.style.cssText = `position:absolute; display:none; pointer-events:none; z-index:${CHROME_Z_INDEX};`;
  const guideH = doc.createElement('div');
  guideH.className = 'scene-guide-h';
  guideH.style.cssText = `position:absolute; display:none; pointer-events:none; z-index:${CHROME_Z_INDEX};`;

  // Inline rich-text formatting toolbar (Milestone 3) — shown only while a
  // text object is actively in contenteditable mode. Deliberately a plain
  // DOM element managed here (not React) so document.execCommand calls
  // stay same-document with the contenteditable selection they act on; a
  // toolbar rendered in the outer app would need to reach across the
  // iframe boundary just to read/restore that selection.
  const textToolbar = doc.createElement('div');
  textToolbar.className = 'scene-text-toolbar';
  textToolbar.style.cssText = `position:absolute; display:none; z-index:${CHROME_Z_INDEX};`;
  const TEXT_TOOLBAR_COMMANDS: Array<{ cmd: string; label: string }> = [
    { cmd: 'bold', label: 'B' },
    { cmd: 'italic', label: 'I' },
    { cmd: 'underline', label: 'U' },
    { cmd: 'insertUnorderedList', label: '•' },
  ];
  TEXT_TOOLBAR_COMMANDS.forEach(({ cmd, label }) => {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `scene-text-toolbar-btn scene-text-toolbar-${cmd}`;
    btn.textContent = label;
    // mousedown (not click) + preventDefault: a click would first fire
    // mousedown-then-blur on the contenteditable element, collapsing/
    // losing the selection before execCommand ever runs.
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      doc.execCommand(cmd);
    });
    textToolbar.appendChild(btn);
  });

  function showTextToolbar(el: HTMLElement) {
    const rect = readRect(el);
    textToolbar.style.display = 'flex';
    textToolbar.style.left = `${rect.x}px`;
    textToolbar.style.top = `${Math.max(0, rect.y - 34)}px`;
  }
  function hideTextToolbar() {
    textToolbar.style.display = 'none';
  }

  // Milestone A (v2 diagram builder): 4 small hover handles (one per edge
  // midpoint) shown over whichever object the mouse is currently over —
  // one shared set repositioned per-hover, same pattern as the
  // single-selection `overlay` above, rather than one set per object.
  // Dragging from a handle either onto another object (create a connector)
  // or onto empty canvas (spawn+connect a new node) — see wireConnectDrag.
  const connectHandles = doc.createElement('div');
  connectHandles.className = 'scene-connect-handles';
  connectHandles.style.cssText = `position:absolute; display:none; pointer-events:none; z-index:${CHROME_Z_INDEX};`;
  const HANDLE_SIDES = ['top', 'right', 'bottom', 'left'] as const;
  const handleEls: Record<(typeof HANDLE_SIDES)[number], HTMLElement> = {} as any;
  HANDLE_SIDES.forEach((side) => {
    const h = doc.createElement('span');
    h.className = `scene-connect-handle scene-connect-handle-${side}`;
    h.style.pointerEvents = 'auto';
    handleEls[side] = h;
    connectHandles.appendChild(h);
  });
  // A temporary preview line shown while dragging from a handle, following
  // the mouse until it's released over a target (or empty canvas).
  const connectPreview = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement;
  connectPreview.setAttribute('class', 'scene-connect-preview');
  (connectPreview as unknown as HTMLElement).style.cssText = `position:absolute; inset:0; width:100%; height:100%; display:none; pointer-events:none; z-index:${CHROME_Z_INDEX};`;
  const connectPreviewLine = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
  connectPreviewLine.setAttribute('stroke', '#f4c10b');
  connectPreviewLine.setAttribute('stroke-width', '2');
  connectPreviewLine.setAttribute('stroke-dasharray', '5 4');
  connectPreview.appendChild(connectPreviewLine);

  root.append(overlay, multiOverlay, marquee, guideV, guideH, textToolbar, connectHandles, connectPreview as unknown as Node);

  let selectedIds: string[] = [];
  let selectedIdSet: Set<string> = new Set();

  function objectEls(): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('[data-object-id]'));
  }

  function elById(id: string): HTMLElement | null {
    return objectEls().find((e) => e.getAttribute('data-object-id') === id) ?? null;
  }

  // Clicking any member of a group selects every element sharing its
  // `data-group-id` — groups have no synthetic SceneObject of their own,
  // they're purely a shared-id relationship (see reducer.ts's GROUP_OBJECTS).
  function groupMembers(id: string): string[] {
    const el = elById(id);
    const gid = el?.getAttribute('data-group-id');
    if (!gid) return [id];
    return objectEls()
      .map((e) => ({ e, oid: e.getAttribute('data-object-id') }))
      .filter(({ e, oid }) => oid && e.getAttribute('data-group-id') === gid)
      .map(({ oid }) => oid as string);
  }

  function updateOverlays() {
    if (selectedIds.length === 0) {
      overlay.style.display = 'none';
      multiOverlay.style.display = 'none';
      return;
    }
    if (selectedIds.length === 1) {
      multiOverlay.style.display = 'none';
      const el = elById(selectedIds[0]);
      if (!el) {
        overlay.style.display = 'none';
        return;
      }
      const rect = readRect(el);
      const rotation = readRotation(el);
      overlay.style.display = 'block';
      overlay.style.left = `${rect.x}px`;
      overlay.style.top = `${rect.y}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.transform = rotation ? `rotate(${rotation}deg)` : '';
      // Resize/rotate don't apply to a connector (its geometry is always
      // re-derived from its endpoints, never stored — see
      // renderScene.ts's renderConnectorObject) or a component instance
      // (its internals don't scale to fit a resized box yet — see
      // renderComponentInstanceObject). Selection outline still shows;
      // only the handles are hidden.
      const objType = el.getAttribute('data-object-type');
      const handlesSupported = objType !== 'connector' && objType !== 'component-instance';
      resizeHandle.style.display = handlesSupported ? 'block' : 'none';
      rotateHandle.style.display = handlesSupported ? 'block' : 'none';
      return;
    }
    overlay.style.display = 'none';
    const rects = selectedIds.map((id) => elById(id)).filter((e): e is HTMLElement => !!e).map(readRect);
    if (!rects.length) {
      multiOverlay.style.display = 'none';
      return;
    }
    const bbox = unionRect(rects);
    multiOverlay.style.display = 'block';
    multiOverlay.style.left = `${bbox.x}px`;
    multiOverlay.style.top = `${bbox.y}px`;
    multiOverlay.style.width = `${bbox.width}px`;
    multiOverlay.style.height = `${bbox.height}px`;
  }

  // Applies a new selection to the DOM/overlays without notifying React —
  // used both internally (after computing the final set of a gesture) and
  // by the controller's setSelectedObjectIds (React state -> canvas sync),
  // which must never re-dispatch what it's syncing *from*.
  function applySelectionInternal(ids: string[]) {
    selectedIds = ids.slice();
    selectedIdSet = new Set(selectedIds);
    objectEls().forEach((el) => {
      const id = el.getAttribute('data-object-id');
      el.classList.toggle('scene-selected', !!id && selectedIdSet.has(id));
    });
    updateOverlays();
  }

  function applySelection(ids: string[]) {
    const changed = !sameIds(ids, selectedIds);
    applySelectionInternal(ids);
    if (changed) callbacks.onSelect(ids.slice());
  }

  // --- Smart snap guides -----------------------------------------------
  // Candidate lines: page edges/center, plus every non-dragged object's
  // edges/center. Snaps the drag-set's bounding-box edges/center to the
  // nearest candidate within SNAP_THRESHOLD px (page-space, same units as
  // the mouse deltas below — the iframe renders at its true 1280x720 size
  // regardless of the outer CSS `scale()` wrapper, so no unit conversion
  // is needed).
  function collectSnapLines(excludeIds: Set<string>): { xs: number[]; ys: number[] } {
    const xs = [0, PAGE_WIDTH / 2, PAGE_WIDTH];
    const ys = [0, PAGE_HEIGHT / 2, PAGE_HEIGHT];
    objectEls().forEach((el) => {
      const id = el.getAttribute('data-object-id');
      if (!id || excludeIds.has(id)) return;
      const r = readRect(el);
      xs.push(r.x, r.x + r.width / 2, r.x + r.width);
      ys.push(r.y, r.y + r.height / 2, r.y + r.height);
    });
    return { xs, ys };
  }

  function computeSnap(dx: number, dy: number, bbox: Rect, excludeIds: Set<string>) {
    const { xs, ys } = collectSnapLines(excludeIds);
    const edgesX = [bbox.x + dx, bbox.x + bbox.width / 2 + dx, bbox.x + bbox.width + dx];
    const edgesY = [bbox.y + dy, bbox.y + bbox.height / 2 + dy, bbox.y + bbox.height + dy];
    let snapDx = dx;
    let guideX: number | null = null;
    let bestX = SNAP_THRESHOLD;
    edgesX.forEach((edge) => {
      xs.forEach((lx) => {
        const delta = Math.abs(lx - edge);
        if (delta <= bestX) {
          bestX = delta;
          snapDx = dx + (lx - edge);
          guideX = lx;
        }
      });
    });
    let snapDy = dy;
    let guideY: number | null = null;
    let bestY = SNAP_THRESHOLD;
    edgesY.forEach((edge) => {
      ys.forEach((ly) => {
        const delta = Math.abs(ly - edge);
        if (delta <= bestY) {
          bestY = delta;
          snapDy = dy + (ly - edge);
          guideY = ly;
        }
      });
    });
    return { dx: snapDx, dy: snapDy, guideX, guideY };
  }

  function showGuides(gx: number | null, gy: number | null) {
    if (gx !== null) {
      guideV.style.display = 'block';
      guideV.style.left = `${gx}px`;
    } else {
      guideV.style.display = 'none';
    }
    if (gy !== null) {
      guideH.style.display = 'block';
      guideH.style.top = `${gy}px`;
    } else {
      guideH.style.display = 'none';
    }
  }

  function hideGuides() {
    guideV.style.display = 'none';
    guideH.style.display = 'none';
  }

  // --- Marquee (rubber-band) selection ----------------------------------
  // Starts from a mousedown on truly empty canvas (bare `root`) *or* on the
  // bottom-most object (see wireObject's legacy-html special-case below) —
  // an imported slide's legacy-html object is full-bleed (0,0,1280,720), so
  // without that second entry point there would be no empty canvas space
  // left to marquee-drag from on any real imported slide at all.
  // `onNoMove` decides what a plain click (not a drag) does instead.
  function startMarquee(startX: number, startY: number, additive: boolean, onNoMove: () => void) {
    let moved = false;
    marquee.style.display = 'block';

    function onMove(ev: MouseEvent) {
      const x = Math.min(startX, ev.clientX);
      const y = Math.min(startY, ev.clientY);
      const w = Math.abs(ev.clientX - startX);
      const h = Math.abs(ev.clientY - startY);
      if (w > 2 || h > 2) moved = true;
      marquee.style.left = `${x}px`;
      marquee.style.top = `${y}px`;
      marquee.style.width = `${w}px`;
      marquee.style.height = `${h}px`;
    }
    function onUp() {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      marquee.style.display = 'none';
      if (!moved) {
        onNoMove();
        return;
      }
      const mRect: Rect = {
        x: parseFloat(marquee.style.left) || 0,
        y: parseFloat(marquee.style.top) || 0,
        width: parseFloat(marquee.style.width) || 0,
        height: parseFloat(marquee.style.height) || 0,
      };
      const hitIds = new Set<string>();
      objectEls().forEach((el) => {
        const id = el.getAttribute('data-object-id');
        if (!id) return;
        if (rectsIntersect(mRect, readRect(el))) groupMembers(id).forEach((gid) => hitIds.add(gid));
      });
      const next = additive ? Array.from(new Set([...selectedIds, ...hitIds])) : Array.from(hitIds);
      applySelection(next);
    }
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  }

  function onRootMouseDown(e: MouseEvent) {
    if (e.target !== root) return; // only starts from empty canvas, not an object
    const additive = e.shiftKey;
    startMarquee(e.clientX, e.clientY, additive, () => {
      if (!additive) applySelection([]);
    });
  }
  root.addEventListener('mousedown', onRootMouseDown);

  function onRootDoubleClick(e: MouseEvent) {
    if (e.target !== root) return; // only empty canvas, not on any object
    callbacks.onEmptyCanvasDoubleClick(e.clientX, e.clientY);
  }
  root.addEventListener('dblclick', onRootDoubleClick);

  // --- Zoom (Ctrl/Cmd+wheel) & pan (Space+drag / middle-mouse-drag) ------
  // Registered on `doc`, in the capture phase for mousedown, so a
  // middle-click/space-held-click over an *object* engages panning instead
  // of that object's own drag handler (wireObject's mousedown listener is
  // bound to the object element itself and only ever sees the bubble
  // phase) — panning must work anywhere over the canvas, not just empty
  // space, once zoomed in.
  function onPanKeyDown(e: KeyboardEvent) {
    if (e.code === 'Space' && doc.activeElement?.getAttribute('contenteditable') !== 'true') {
      callbacks.setPanModifierHeld(true);
    }
  }
  function onPanKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') callbacks.setPanModifierHeld(false);
  }
  doc.addEventListener('keydown', onPanKeyDown);
  doc.addEventListener('keyup', onPanKeyUp);

  function onPanMouseDown(e: MouseEvent) {
    if (e.button !== 1 && !(e.button === 0 && callbacks.isPanModifierHeld())) return;
    e.preventDefault();
    e.stopPropagation();
    callbacks.onPanStart();
    // movementX/Y (not a clientX/Y diff) deliberately: the pan gesture
    // itself moves the iframe's on-screen position every tick, which makes
    // the iframe's *own* clientX/clientY a moving reference frame — a
    // clientX-diff-based delta (in either direction: computed in
    // iframe-local space, or re-derived through a live getBoundingClientRect
    // each tick) compounds error because the very transform being computed
    // changes what "local" means mid-gesture. movementX/Y are defined off
    // screenX/screenY (true OS/screen coordinates), which no CSS transform
    // on any ancestor can affect, so they need no zoom-fraction conversion
    // at all — they're already the correct on-screen pixel delta.
    function onMove(ev: MouseEvent) {
      callbacks.onPanMove(ev.movementX, ev.movementY);
    }
    function onUp() {
      callbacks.onPanEnd();
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
    }
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  }
  doc.addEventListener('mousedown', onPanMouseDown, true);

  function onWheelZoomEvt(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    callbacks.onWheelZoom(e.deltaY, e.clientX, e.clientY);
  }
  doc.addEventListener('wheel', onWheelZoomEvt, { passive: false });

  // --- Right-click context menu -------------------------------------------
  // Suppresses the native browser menu everywhere on the canvas (object or
  // empty space) — Canvas.tsx renders its own React menu, positioned via
  // the forwarded coordinates (converted to on-screen space the same way
  // as everything else in this section, since this too is a parent-window
  // concern, not scene math).
  function onContextMenuEvt(e: MouseEvent) {
    e.preventDefault();
    const targetEl = (e.target as HTMLElement)?.closest?.('[data-object-id]') as HTMLElement | null;
    const objectId = targetEl?.getAttribute('data-object-id') ?? null;
    if (objectId && !selectedIds.includes(objectId)) {
      applySelection(groupMembers(objectId));
    }
    callbacks.onContextMenu(e.clientX, e.clientY, objectId);
  }
  doc.addEventListener('contextmenu', onContextMenuEvt);

  // --- Hover-to-connect handles ------------------------------------------
  let connectDragActive = false;
  let hoveredId: string | null = null;

  function positionConnectHandles(el: HTMLElement) {
    const r = readRect(el);
    handleEls.top.style.left = `${r.x + r.width / 2}px`;
    handleEls.top.style.top = `${r.y}px`;
    handleEls.right.style.left = `${r.x + r.width}px`;
    handleEls.right.style.top = `${r.y + r.height / 2}px`;
    handleEls.bottom.style.left = `${r.x + r.width / 2}px`;
    handleEls.bottom.style.top = `${r.y + r.height}px`;
    handleEls.left.style.left = `${r.x}px`;
    handleEls.left.style.top = `${r.y + r.height / 2}px`;
    connectHandles.style.display = 'block';
  }

  function hideConnectHandles() {
    if (connectDragActive) return; // stay visible while a connect-drag is in progress
    connectHandles.style.display = 'none';
  }

  // Hit-tests every object element's rect against a point (page-space
  // coordinates, same units readRect already uses) — used on connector-drag
  // release to find the drop target, without relying on doc.elementFromPoint
  // (which would hit the always-on-top handle/preview chrome instead of the
  // object underneath it).
  // `legacy-html` is excluded here specifically: it's the imported slide's
  // full-bleed background object (0,0 to 1280,720 on essentially every
  // slide, including a freshly-added "blank" one — see
  // legacyHtmlAdapter.ts), so without this exclusion a connector-drag would
  // almost never find genuinely "empty" canvas to spawn a new node on —
  // the background layer would intercept the hit-test everywhere. A
  // connector to the slide's own background wouldn't be semantically
  // meaningful anyway.
  function objectAtPoint(x: number, y: number, excludeId: string): string | null {
    const hit = objectEls()
      .filter((el) => el.getAttribute('data-object-id') !== excludeId && el.getAttribute('data-object-type') !== 'legacy-html')
      .find((el) => {
        const r = readRect(el);
        return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
      });
    return hit?.getAttribute('data-object-id') ?? null;
  }

  function startConnectDrag(fromId: string, fromEl: HTMLElement, handleSide: (typeof HANDLE_SIDES)[number]) {
    connectDragActive = true;
    const r = readRect(fromEl);
    const originX =
      handleSide === 'left' ? r.x : handleSide === 'right' ? r.x + r.width : r.x + r.width / 2;
    const originY =
      handleSide === 'top' ? r.y : handleSide === 'bottom' ? r.y + r.height : r.y + r.height / 2;
    connectPreviewLine.setAttribute('x1', String(originX));
    connectPreviewLine.setAttribute('y1', String(originY));
    connectPreviewLine.setAttribute('x2', String(originX));
    connectPreviewLine.setAttribute('y2', String(originY));
    (connectPreview as unknown as HTMLElement).style.display = 'block';

    function onMove(ev: MouseEvent) {
      connectPreviewLine.setAttribute('x2', String(ev.clientX));
      connectPreviewLine.setAttribute('y2', String(ev.clientY));
      const targetId = objectAtPoint(ev.clientX, ev.clientY, fromId);
      objectEls().forEach((el) => el.classList.toggle('scene-connect-target', el.getAttribute('data-object-id') === targetId));
    }
    function onUp(ev: MouseEvent) {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      connectDragActive = false;
      (connectPreview as unknown as HTMLElement).style.display = 'none';
      objectEls().forEach((el) => el.classList.remove('scene-connect-target'));
      hideConnectHandles();

      const targetId = objectAtPoint(ev.clientX, ev.clientY, fromId);
      if (targetId) {
        callbacks.onCreateConnector(fromId, targetId);
      } else {
        const x = clamp(ev.clientX, 0, PAGE_WIDTH);
        const y = clamp(ev.clientY, 0, PAGE_HEIGHT);
        callbacks.onCreateConnectedNode(fromId, x, y);
      }
    }
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  }

  HANDLE_SIDES.forEach((side) => {
    handleEls[side].addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!hoveredId) return;
      const el = elById(hoveredId);
      if (!el) return;
      startConnectDrag(hoveredId, el, side);
    });
  });
  // Leaving the handle overlay itself (not back onto the object it belongs
  // to — that re-fires the object's own mouseenter, which is a no-op here)
  // hides it — covers moving the pointer off the edge of the canvas
  // entirely while a handle happens to be the last-hovered element.
  connectHandles.addEventListener('mouseleave', (e) => {
    const related = e.relatedTarget as Node | null;
    if (related && hoveredId && elById(hoveredId) === related) return;
    hoveredId = null;
    hideConnectHandles();
  });

  function wireObject(el: HTMLElement) {
    const rawId = el.getAttribute('data-object-id');
    if (!rawId) return;
    const id: string = rawId; // re-narrowed const — see note below
    const objectType = el.getAttribute('data-object-type');

    el.addEventListener('mousedown', (e) => {
      if (el.getAttribute('contenteditable') === 'true') return; // editing — let text selection happen
      e.stopPropagation();

      // Legacy-html is the imported slide's full-bleed background — dragging
      // it as a whole is rarely what's wanted, and (being full-bleed) it
      // would otherwise swallow every mousedown a marquee-select needs to
      // start from. A plain click still selects it like any other object;
      // a drag marquee-selects instead of moving it. Shift-click keeps its
      // normal toggle-in-selection behavior below.
      if (objectType === 'legacy-html' && !e.shiftKey) {
        startMarquee(e.clientX, e.clientY, false, () => applySelection([id]));
        return;
      }

      const groupIds = groupMembers(id);

      if (e.shiftKey) {
        // Shift-click toggles the clicked object's group in/out of the
        // current selection; it never starts a drag (Figma convention).
        const allSelected = groupIds.every((gid) => selectedIdSet.has(gid));
        const next = allSelected
          ? selectedIds.filter((sid) => !groupIds.includes(sid))
          : Array.from(new Set([...selectedIds, ...groupIds]));
        applySelection(next);
        return;
      }

      // Clicking an object that's part of a *larger* existing multi-select
      // defers collapsing to just this object/group until mouseup — if the
      // gesture turns into a drag, the whole current selection moves
      // together; if it's a plain click, it collapses on release.
      const withinBiggerSelection = groupIds.every((gid) => selectedIdSet.has(gid)) && selectedIds.length > groupIds.length;
      const dragIds = withinBiggerSelection ? selectedIds.slice() : groupIds;
      if (!withinBiggerSelection) applySelection(dragIds);

      // A connector's own x/y/width/height are never read at render time —
      // its path is re-derived from its two endpoint objects on every
      // render (see renderScene.ts's renderConnectorObject) — so dragging
      // it *alone* has nothing meaningful to do beyond the selection
      // already applied above. Still rides along harmlessly if it happens
      // to be part of a bigger multi-drag with real objects in it.
      if (objectType === 'connector' && dragIds.length === 1) return;

      const alt = e.altKey; // captured once — alt must be held at drag-start to duplicate
      const startX = e.clientX;
      const startY = e.clientY;
      const dragEls = new Map<string, HTMLElement>();
      dragIds.forEach((did) => {
        const dEl = elById(did);
        if (dEl) dragEls.set(did, dEl);
      });
      const startRects = new Map<string, Rect>();
      dragEls.forEach((dEl, did) => startRects.set(did, readRect(dEl)));
      const startBBox = unionRect(Array.from(startRects.values()));
      const excludeSet = new Set(dragIds);

      let moved = false;
      let axisLocked: 'x' | 'y' | null = null;
      let lastDx = 0;
      let lastDy = 0;
      let cloneEls: Map<string, HTMLElement> | null = null;

      function ensureClones() {
        if (cloneEls) return;
        cloneEls = new Map();
        dragEls.forEach((srcEl, did) => {
          const clone = srcEl.cloneNode(true) as HTMLElement;
          clone.classList.add('scene-drag-clone');
          clone.removeAttribute('contenteditable');
          srcEl.insertAdjacentElement('afterend', clone);
          cloneEls!.set(did, clone);
        });
      }

      // `onMove`/`onUp` are nested function *declarations*, not arrow
      // functions — TS's narrowing of `rawId` (string | null) doesn't
      // propagate that deep, hence the `id` rebinding above rather than
      // using `rawId` directly here.
      function onMove(ev: MouseEvent) {
        let dx = ev.clientX - startX;
        let dy = ev.clientY - startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
        if (!moved) return;

        if (ev.shiftKey) {
          if (!axisLocked) axisLocked = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
          if (axisLocked === 'x') dy = 0;
          else dx = 0;
        } else {
          axisLocked = null;
        }

        dx = clamp(dx, -startBBox.x, PAGE_WIDTH - startBBox.x - startBBox.width);
        dy = clamp(dy, -startBBox.y, PAGE_HEIGHT - startBBox.y - startBBox.height);

        const snap = computeSnap(dx, dy, startBBox, excludeSet);
        dx = snap.dx;
        dy = snap.dy;
        showGuides(snap.guideX, snap.guideY);
        lastDx = dx;
        lastDy = dy;

        if (alt) {
          ensureClones();
          dragEls.forEach((_srcEl, did) => {
            const clone = cloneEls!.get(did);
            const startRect = startRects.get(did)!;
            if (clone) {
              clone.style.left = `${startRect.x + dx}px`;
              clone.style.top = `${startRect.y + dy}px`;
            }
          });
        } else {
          dragEls.forEach((dEl, did) => {
            const startRect = startRects.get(did)!;
            dEl.style.left = `${startRect.x + dx}px`;
            dEl.style.top = `${startRect.y + dy}px`;
          });
          updateOverlays();
        }
      }
      function onUp() {
        doc.removeEventListener('mousemove', onMove);
        doc.removeEventListener('mouseup', onUp);
        hideGuides();

        if (!moved) {
          if (withinBiggerSelection) applySelection(groupIds);
          return;
        }

        if (alt) {
          cloneEls?.forEach((clone) => clone.remove());
          const positionOverrides: Record<string, { x: number; y: number }> = {};
          dragIds.forEach((did) => {
            const startRect = startRects.get(did)!;
            positionOverrides[did] = { x: startRect.x + lastDx, y: startRect.y + lastDy };
          });
          callbacks.onDuplicateSelected(dragIds, positionOverrides);
        } else if (dragIds.length === 1) {
          const dEl = dragEls.get(dragIds[0]);
          if (dEl) {
            const r = readRect(dEl);
            callbacks.onCommitTransform(dragIds[0], { x: r.x, y: r.y });
          }
        } else {
          const patches: Record<string, TransformPatch> = {};
          dragEls.forEach((dEl, did) => {
            const r = readRect(dEl);
            patches[did] = { x: r.x, y: r.y };
          });
          callbacks.onCommitTransforms(patches);
        }
      }
      doc.addEventListener('mousemove', onMove);
      doc.addEventListener('mouseup', onUp);
    });

    // Milestone A (v2): hover handles work for any object type (a
    // connector can link two arbitrary objects, not just diagram nodes) —
    // skipped for connectors themselves, since a connector isn't a sensible
    // connect *source* (it has no meaningful "edge" of its own; its
    // geometry is derived from two other objects, see renderConnectorObject).
    if (objectType !== 'connector') {
      el.addEventListener('mouseenter', () => {
        if (connectDragActive) return;
        hoveredId = id;
        positionConnectHandles(el);
      });
      // The handle overlay sits visually on top of the object (higher
      // z-index, positioned over its edges) — moving the pointer from the
      // object onto one of its own handles fires this same `mouseleave`
      // (the browser now considers the handle, not the object, "entered").
      // Without the relatedTarget check below, that would null `hoveredId`
      // and hide the handles a frame before a mousedown on one could ever
      // register, making the handles impossible to actually grab.
      el.addEventListener('mouseleave', (e) => {
        const related = e.relatedTarget as Node | null;
        if (related && connectHandles.contains(related)) return;
        if (hoveredId === id) hoveredId = null;
        hideConnectHandles();
      });
    }

    if (objectType === 'text') {
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        el.setAttribute('contenteditable', 'true');
        el.focus();
        const range = doc.createRange();
        range.selectNodeContents(el);
        const sel = doc.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        showTextToolbar(el);
      });
      el.addEventListener('blur', () => {
        if (el.getAttribute('contenteditable') === 'true') {
          hideTextToolbar();
          el.removeAttribute('contenteditable');
          callbacks.onCommitText(id, el.innerHTML);
        }
      });
    }
  }

  objectEls().forEach(wireObject);

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    const maybeEl = elById(id);
    if (!maybeEl) return;
    const el: HTMLElement = maybeEl; // re-narrowed const — nested onMove/onUp below are
    // function *declarations*, and TS narrowing of a wide-typed const doesn't propagate
    // that deep (same issue as wireObject's `id` rebind above).
    const startX = e.clientX;
    const startY = e.clientY;
    const start = readRect(el);
    const rotation = readRotation(el);
    const rad = degToRad(-rotation);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      // Rotate the screen-space drag delta into the object's own (unrotated)
      // local axes, so resizing a tilted object grows it along its own
      // edges rather than the screen's — otherwise "drag right" on a 45°
      // rotated box would visually resize diagonally.
      const localDx = dx * cos - dy * sin;
      const localDy = dx * sin + dy * cos;
      const width = clamp(start.width + localDx, MIN_SIZE, PAGE_WIDTH - start.x);
      const height = clamp(start.height + localDy, MIN_SIZE, PAGE_HEIGHT - start.y);
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      updateOverlays();
    }
    function onUp() {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      const rect = readRect(el);
      callbacks.onCommitTransform(id, { width: rect.width, height: rect.height });
    }
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  });

  rotateHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    const maybeEl = elById(id);
    if (!maybeEl) return;
    const el: HTMLElement = maybeEl;
    const rect = readRect(el);
    function onMove(ev: MouseEvent) {
      let angle = angleFromCenterToPoint(rect, ev.clientX, ev.clientY);
      if (ev.shiftKey) angle = Math.round(angle / 15) * 15;
      applyRotation(el, angle);
      updateOverlays();
    }
    function onUp() {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      callbacks.onCommitTransform(id, { rotation: readRotation(el) });
    }
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  });

  function onKeyDown(e: KeyboardEvent) {
    // Undo/redo checked first and independent of selection: keydown inside
    // this iframe document never bubbles to the outer window, so without
    // this the canvas would be a dead zone for Ctrl+Z whenever it (rather
    // than the sidebar or an <input>) has focus. Same reasoning applies to
    // select-all/escape below — they also need their own in-iframe handling.
    const meta = e.ctrlKey || e.metaKey;
    const editingText = doc.activeElement?.getAttribute('contenteditable') === 'true';
    if (meta && e.key.toLowerCase() === 'z' && !editingText) {
      e.preventDefault();
      if (e.shiftKey) callbacks.onRedo();
      else callbacks.onUndo();
      return;
    }
    if (editingText) return; // let native text editing/selection own every other key

    // Milestone A: zoom shortcuts — see SceneEditingCallbacks' doc comment
    // for why this file forwards rather than owning zoom state itself.
    if (meta && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      callbacks.onZoomShortcut('in');
      return;
    }
    if (meta && (e.key === '-' || e.key === '_')) {
      e.preventDefault();
      callbacks.onZoomShortcut('out');
      return;
    }
    if (meta && e.key === '0') {
      e.preventDefault();
      callbacks.onZoomShortcut('fit');
      return;
    }
    if (meta && e.key === '1') {
      e.preventDefault();
      callbacks.onZoomShortcut('actual');
      return;
    }

    if (meta && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      applySelection(objectEls().map((el) => el.getAttribute('data-object-id')).filter((x): x is string => !!x));
      return;
    }
    if (e.key === 'Escape') {
      if (selectedIds.length) {
        e.preventDefault();
        applySelection([]);
      }
      return;
    }
    if (selectedIds.length === 0) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const ids = selectedIds.slice();
      applySelection([]);
      callbacks.onDeleteSelected(ids);
      return;
    }

    const step = e.shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;
    e.preventDefault();

    const rects = selectedIds.map((sid) => elById(sid)).filter((x): x is HTMLElement => !!x).map(readRect);
    if (!rects.length) return;
    const bbox = unionRect(rects);
    const clampedDx = clamp(dx, -bbox.x, PAGE_WIDTH - bbox.x - bbox.width);
    const clampedDy = clamp(dy, -bbox.y, PAGE_HEIGHT - bbox.y - bbox.height);

    const patches: Record<string, TransformPatch> = {};
    selectedIds.forEach((sid) => {
      const el = elById(sid);
      if (!el) return;
      const r = readRect(el);
      const next = { x: r.x + clampedDx, y: r.y + clampedDy };
      el.style.left = `${next.x}px`;
      el.style.top = `${next.y}px`;
      patches[sid] = next;
    });
    updateOverlays();
    if (selectedIds.length === 1) callbacks.onCommitTransform(selectedIds[0], patches[selectedIds[0]]);
    else callbacks.onCommitTransforms(patches);
  }
  doc.addEventListener('keydown', onKeyDown);

  return {
    setSelectedObjectIds(objectIds: string[]) {
      applySelectionInternal(objectIds);
    },
    destroy() {
      root.removeEventListener('mousedown', onRootMouseDown);
      root.removeEventListener('dblclick', onRootDoubleClick);
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('keydown', onPanKeyDown);
      doc.removeEventListener('keyup', onPanKeyUp);
      doc.removeEventListener('mousedown', onPanMouseDown, true);
      doc.removeEventListener('wheel', onWheelZoomEvt);
      doc.removeEventListener('contextmenu', onContextMenuEvt);
      overlay.remove();
      multiOverlay.remove();
      marquee.remove();
      guideV.remove();
      guideH.remove();
      textToolbar.remove();
      connectHandles.remove();
      (connectPreview as unknown as HTMLElement).remove();
    },
  };
}

// Injected into the iframe's <style> alongside canvasEditing.js's own
// editor-overlay CSS (concatenated by Canvas.jsx into the styleBlock it
// passes to buildSlideDoc — canvasEditing.js itself is not modified).
export function sceneEditingOverlayCss(): string {
  return `
    .scene-object{ cursor:move; }
    .scene-object.scene-selected{ outline:1.5px solid #f4c10b; outline-offset:1px; }
    .scene-text{ cursor:text; }
    .scene-text:hover{ outline:1.5px dashed rgba(75,9,118,.35); }
    .scene-overlay-box{ position:absolute; inset:0; border:1.5px solid #f4c10b; pointer-events:none; }
    .scene-handle{ position:absolute; width:12px; height:12px; border-radius:3px; background:#fff; border:1.5px solid #f4c10b; pointer-events:auto; }
    .scene-handle-resize{ right:-6px; bottom:-6px; cursor:nwse-resize; }
    .scene-handle-rotate{ left:50%; top:-26px; margin-left:-6px; border-radius:50%; cursor:grab; }
    .scene-multi-overlay{ border:1.5px dashed #f4c10b; }
    .scene-marquee{ border:1px solid #4b0976; background:rgba(75,9,118,.12); }
    .scene-guide-v{ top:0; height:100%; border-left:1px solid #ff3d81; }
    .scene-guide-h{ left:0; width:100%; border-top:1px solid #ff3d81; }
    .scene-drag-clone{ opacity:.85; }
    .scene-connector{ cursor:default; }
    .scene-diagram-node{ cursor:move; }
    .scene-text-toolbar{ display:flex; gap:2px; background:#241130; border-radius:6px; padding:3px; box-shadow:0 4px 12px rgba(0,0,0,.25); }
    .scene-text-toolbar-btn{ width:24px; height:24px; border:none; border-radius:4px; background:transparent; color:#fff; font:700 12px/1 var(--body, sans-serif); cursor:pointer; }
    .scene-text-toolbar-btn:hover{ background:rgba(255,255,255,.15); }
    .scene-text-toolbar-italic{ font-style:italic; }
    .scene-text-toolbar-underline{ text-decoration:underline; }
    .scene-connect-handle{ position:absolute; width:11px; height:11px; margin:-5.5px 0 0 -5.5px; border-radius:50%; background:#fff; border:1.5px solid #4b0976; cursor:crosshair; }
    .scene-connect-handle:hover{ background:#f4c10b; border-color:#f4c10b; }
    .scene-connect-target{ outline:2px solid #f4c10b; outline-offset:2px; }
  `;
}
