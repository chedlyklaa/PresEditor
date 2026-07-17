import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../state/EditorContext';
import { findLegacyObjectId, findLocation } from '../../state/reducer';
import {
  buildSlideDoc,
  makeEditable,
  wireImageSlots,
  wireImageSlot,
  applyImageToSlot,
  insertFreeMedia,
  wireFreeBlock,
  makeGridReorderable,
  makeFreeElementsInteractive,
  unwrapEditorArtifacts,
} from '../../lib/canvasEditing';
import { wireSceneObjects, sceneEditingOverlayCss, type SceneEditingController } from '../../lib/sceneEditing';
import { renderScene, type RenderContext } from '../../scene/renderScene';
import { resolveEffectiveBackground } from '../../lib/slideBackground';
import { resolveEffectiveMaster, buildComponentsMap, mainSlideIndex, mainSlideCount } from '../../scene/renderContext';
import { ensureAnimationCss } from '../../lib/animationCss';
import { toast } from '../../lib/toastBus';
import { uid } from '../../lib/id';
import { useCanvasZoom } from '../../lib/useCanvasZoom';
import CanvasToolbar from './CanvasToolbar';
import ZoomControls from './ZoomControls';
import ContextMenu, { type ContextMenuTarget } from './ContextMenu';
import EmptyState from './EmptyState';
import LayoutPickerModal from '../LayoutPickerModal';
import DiagramGalleryModal from '../DiagramGalleryModal';

const LARGE_FILE_WARNING_BYTES = 15 * 1024 * 1024; // 15MB

interface PendingImageTarget {
  el: HTMLElement;
  legacyRoot: HTMLElement;
}

export default function Canvas() {
  const { state, actions, historyTick } = useEditor();
  const slide = state.selectedSlideId ? state.slidesById[state.selectedSlideId] : null;
  const scene = slide ? state.scenesById[slide.pages[state.selectedPage] ?? slide.pages[0]] : null;
  const stageRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const insertInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pendingImageTargetRef = useRef<PendingImageTarget | null>(null);
  const pendingInsertKindRef = useRef<'image' | 'video'>('image');
  const sceneControllerRef = useRef<SceneEditingController | null>(null);
  const [layoutPickerFor, setLayoutPickerFor] = useState<string | null>(null);
  // Milestone A (v2): gates the double-click-empty-canvas quick-add-node
  // affordance only — hover-connect handles themselves are always on (see
  // sceneEditing.ts's onEmptyCanvasDoubleClick doc comment for why this
  // check lives here rather than inside sceneEditing.ts).
  const [diagramMode, setDiagramMode] = useState(false);
  const [diagramGalleryOpen, setDiagramGalleryOpen] = useState(false);
  const diagramModeRef = useRef(diagramMode);
  diagramModeRef.current = diagramMode;
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  // Declared here (not near the old fitScaler's position further down) so
  // its callbacks exist before the iframe-rebuild effect below references
  // them — see that effect's own dependency-array comment for why this is
  // safe to reference without forcing a rebuild on every zoom/pan tick.
  const zoom = useCanvasZoom(stageRef, scalerRef, frameRef, [state.notesOpen]);

  const requestImageReplace = useCallback((targetEl: HTMLElement, legacyRoot: HTMLElement) => {
    pendingImageTargetRef.current = { el: targetEl, legacyRoot };
    if (imgInputRef.current) imgInputRef.current.accept = targetEl.tagName === 'VIDEO' ? 'video/*' : 'image/*';
    imgInputRef.current?.click();
  }, []);

  const requestInsertMedia = useCallback((kind: 'image' | 'video') => {
    pendingInsertKindRef.current = kind;
    if (insertInputRef.current) insertInputRef.current.accept = kind === 'video' ? 'video/*' : 'image/*';
    insertInputRef.current?.click();
  }, []);

  // Milestone 4: resolved slide -> section -> deck background cascade (see
  // lib/slideBackground.js). Unlike M1's old bg-color feature, this is
  // plain state (Scene.background / SectionMeta.defaultBackground /
  // EditorMeta.defaultBackground), not something baked into an object's
  // own HTML — so it needs its own rebuild-trigger key below, same reason
  // transformSignature/dataSignature exist.
  const slideLocation = slide ? findLocation(state, slide.id) : null;
  const section =
    slideLocation?.kind === 'section' ? state.sections.find((s) => s.id === slideLocation.sectionId) ?? null : null;
  const effectiveBackground = scene ? resolveEffectiveBackground(scene, section, state.meta) : null;
  const backgroundKey = JSON.stringify(effectiveBackground);
  // Matches the real engine's own per-section light-mode background
  // cycling (see buildSlideDoc's comment) — null for anything not in a
  // section (Q&A, master, component slides), same as the real engine's own
  // "hidden-node" slides never cycling either.
  const sectionIndex = slideLocation?.kind === 'section' ? state.sections.findIndex((s) => s.id === slideLocation.sectionId) : null;

  // Milestone 5: same cascade shape as background, one level shallower (no
  // per-slide override — see SectionMeta.masterSlideId's doc comment).
  const effectiveMaster = resolveEffectiveMaster(state, section);
  const componentsMap = buildComponentsMap(state);
  const pageNumber = slide ? mainSlideIndex(state, slide.id) : null;
  const pageCount = mainSlideCount(state);
  const renderContext: RenderContext = {
    background: effectiveBackground,
    master: effectiveMaster,
    pageNumber,
    pageCount,
    components: componentsMap,
    assets: state.assetsById,
  };
  // A master/component's *own* content living outside this scene can
  // change (edited on its own slide) without this scene's objects
  // changing at all — same missing-rebuild-trigger problem
  // transformSignature/dataSignature exist for, one level removed. Full
  // JSON signatures rather than an id/count check because a content edit
  // (not just add/remove) must also trigger the rebuild.
  const masterContentKey = effectiveMaster ? JSON.stringify(effectiveMaster) : '';
  const componentsContentKey = JSON.stringify(componentsMap);
  // pageNumber/pageCount depend on the *whole deck's* section/slide list,
  // not this scene's own objectOrder — adding/removing/reordering a slide
  // anywhere else in the deck can change this slide's page number without
  // touching anything objectOrderKey would catch.
  const pageKey = `${pageNumber ?? ''}/${pageCount}`;

  // Which objects exist, and in what order — as opposed to their content —
  // is a *structural* change: a newly added/deleted/reordered object isn't
  // present in the live iframe DOM at all yet (or needs removing/reordering
  // there), so unlike a plain content edit, this one genuinely does need a
  // rebuild. Editing an existing object's transform/text does not change
  // this key, so typing still never triggers it.
  const objectOrderKey = scene ? scene.objectOrder.join(',') : '';

  // Transform/flag/style fields changed from *outside* a canvas gesture —
  // the Inspector's number inputs, its style controls (fill/stroke/color/
  // font size/...), its lock/hide toggles, the Layers panel's lock/hide
  // icons, and Align/Distribute/Group/Ungroup — all dispatch straight to
  // the reducer with no corresponding direct-DOM mutation the way a canvas
  // drag/resize/rotate has already applied before it commits. Without this
  // key those edits would update React state correctly but never appear in
  // the live iframe until some unrelated action happened to force a
  // rebuild. A canvas gesture's own commit *also* changes this key and
  // re-triggers a rebuild here, but only after mouseup (the gesture is
  // visually done by then, so the rebuild is an imperceptible DOM swap) —
  // unlike bgColor/objectOrderKey's sibling exceptions, this one is
  // deliberately broad because so many M2/M3 entry points bypass
  // sceneEditing.ts entirely.
  const transformSignature = scene
    ? scene.objectOrder
        .map((id) => {
          const o = scene.objectsById[id];
          if (!o) return '';
          return `${o.x},${o.y},${o.width},${o.height},${o.rotation},${o.opacity},${o.locked},${o.hidden},${o.groupId || ''},${JSON.stringify(o.style || {})},${JSON.stringify(o.animations || [])}`;
        })
        .join('|')
    : '';

  // Milestone 3: the same problem as transformSignature above, but for
  // `data` on object types whose data is a discrete external pick (shape
  // kind, icon key, image src/fit — Inspector controls, no gesture ever
  // mutates them in the live DOM) rather than continuously-typed text.
  // `text` and `legacy-html` are excluded on purpose: their data.html is
  // edited by typing (via sceneEditing.ts's contenteditable / canvasEditing
  // .js's makeEditable), and including it here would rebuild on every
  // keystroke — exactly the focus/cursor-destroying regression this
  // effect's own leading comment warns about.
  const dataSignature = scene
    ? scene.objectOrder
        .map((id) => {
          const o = scene.objectsById[id];
          if (!o || o.type === 'text' || o.type === 'legacy-html') return '';
          return JSON.stringify(o.data);
        })
        .join('|')
    : '';

  function commitLegacyObject(legacyRoot: HTMLElement | null) {
    if (!legacyRoot || !scene) return;
    const wrapperEl = legacyRoot.closest('[data-object-id]');
    const objectId = wrapperEl?.getAttribute('data-object-id');
    if (!objectId) return;
    actions.updateObjectData(scene.id, objectId, { html: unwrapEditorArtifacts(legacyRoot) });
  }

  // Rebuilds the iframe document only when the *identity* of what's shown
  // changes (slide, page, background) — never on scene content itself,
  // which is only ever written by our own debounced commits below. If this
  // effect also depended on the scene's objects, every keystroke would
  // tear down and rebuild the iframe, destroying focus/cursor/selection
  // mid-edit.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !slide || !scene) return undefined;

    const contentHtml = renderScene(scene, 'edit', renderContext);
    frame.srcdoc = buildSlideDoc(
      { cls: slide.cls, pages: [contentHtml] } as any,
      0,
      ensureAnimationCss(state.meta.styleBlock || '') + sceneEditingOverlayCss(),
      sectionIndex
    );

    const onLoad = () => {
      const doc = frame.contentDocument;
      const root = doc?.getElementById('slide-root');
      if (!doc || !root) return;
      // Lets actions.detachObject (EditorContext.tsx) reach the live
      // rendered DOM without Canvas.tsx needing to know anything about
      // what it's used for — see that action's own comment.
      actions.registerCanvasFrame(doc);

      // Legacy-html objects: reuse the existing contenteditable/image-slot
      // engine verbatim (canvasEditing.js is otherwise untouched by the
      // Studio rewrite), scoped per object rather than to the whole page.
      root.querySelectorAll<HTMLElement>('[data-object-type="legacy-html"]').forEach((wrapperEl) => {
        const objectId = wrapperEl.getAttribute('data-object-id');
        const legacyRoot = wrapperEl.querySelector<HTMLElement>('.legacy-content');
        if (!objectId || !legacyRoot) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const commit = () => actions.updateObjectData(scene.id, objectId, { html: unwrapEditorArtifacts(legacyRoot) });
        const scheduleCommit = () => {
          clearTimeout(timer);
          timer = setTimeout(commit, 400);
        };
        makeEditable(legacyRoot, doc, scheduleCommit);
        wireImageSlots(legacyRoot, doc, (targetEl: HTMLElement) => requestImageReplace(targetEl, legacyRoot));
        makeFreeElementsInteractive(legacyRoot, doc, scheduleCommit);
        makeGridReorderable(legacyRoot, doc, scheduleCommit);
      });

      // Every scene object (including legacy-html wrappers, selectable and
      // movable as a whole) — generic select/drag/resize/rotate.
      sceneControllerRef.current = wireSceneObjects(root, doc, {
        onSelect: (objectIds) => actions.setSelection(scene.id, objectIds),
        onCommitTransform: (objectId, patch) => actions.updateObjectTransform(scene.id, objectId, patch),
        onCommitTransforms: (patches) => actions.updateObjectsTransform(scene.id, patches),
        onCommitText: (objectId, html) => actions.updateObjectData(scene.id, objectId, { html }),
        onDeleteSelected: (objectIds) => actions.deleteObjects(scene.id, objectIds),
        onDuplicateSelected: (objectIds, positionOverrides) => actions.duplicateObjects(scene.id, objectIds, positionOverrides),
        onUndo: () => actions.undo(),
        onRedo: () => actions.redo(),
        onCreateConnector: (fromId, toId) => actions.createConnector(scene.id, fromId, toId),
        // Two sequential dispatches (pre-generate the new node's id via
        // objectDefaults' own id convention so the immediately-following
        // createConnector call can reference it — mirrors the M9
        // registerAsset-then-addObject pattern for the same "need the id
        // before the next dispatch" reason) rather than a combined reducer
        // action, since this is a small, occasional gesture, not a hot path.
        onCreateConnectedNode: (fromId, x, y) => {
          const newId = uid('obj');
          const width = 200;
          const height = 90;
          actions.addObject(scene.id, 'diagram-node', {
            id: newId,
            x: Math.round(x - width / 2),
            y: Math.round(y - height / 2),
            width,
            height,
            data: { shape: 'rect', label: 'Nœud' },
          } as any);
          actions.createConnector(scene.id, fromId, newId);
        },
        onEmptyCanvasDoubleClick: (x, y) => {
          if (!diagramModeRef.current) return;
          const width = 200;
          const height = 90;
          actions.addObject(scene.id, 'diagram-node', {
            x: Math.round(x - width / 2),
            y: Math.round(y - height / 2),
            width,
            height,
            data: { shape: 'rect', label: 'Nœud' },
          });
        },
        onZoomShortcut: zoom.onIframeZoomShortcut,
        onWheelZoom: zoom.onIframeWheelZoom,
        isPanModifierHeld: zoom.isSpaceHeld,
        setPanModifierHeld: zoom.setSpaceHeld,
        onPanStart: zoom.onIframePanStart,
        onPanMove: zoom.onIframePanMove,
        onPanEnd: zoom.onIframePanEnd,
        onContextMenu: (clientX, clientY, objectId) => {
          if (!objectId) return; // nothing meaningful to offer on empty canvas today
          const { x, y } = zoom.iframeToScreen(clientX, clientY);
          setContextMenu({ x, y, sceneId: scene.id, objectId });
        },
      });
      const currentSel = state.selection?.sceneId === scene.id ? state.selection.objectIds : [];
      sceneControllerRef.current.setSelectedObjectIds(currentSel);
    };
    frame.addEventListener('load', onLoad, { once: true });

    return () => {
      frame.removeEventListener('load', onLoad);
      sceneControllerRef.current?.destroy();
      sceneControllerRef.current = null;
      actions.registerCanvasFrame(null);
    };
    // Scene object *text content* is intentionally excluded — see comment
    // above (backgroundKey, objectOrderKey, transformSignature,
    // dataSignature, masterContentKey, componentsContentKey, and pageKey
    // are deliberate exceptions; historyTick is the last — see its own doc
    // comment in historyReducer.ts for why undo/redo needs to force a
    // rebuild that a regular edit must not). Typing into a contenteditable
    // object never touches any of those seven, so cursor/focus safety
    // during text editing is unaffected by them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    slide?.id,
    slide?.cls,
    state.selectedPage,
    state.meta.styleBlock,
    backgroundKey,
    sectionIndex,
    objectOrderKey,
    transformSignature,
    dataSignature,
    masterContentKey,
    componentsContentKey,
    pageKey,
    historyTick,
    requestImageReplace,
    actions,
    // Stable across zoom/pan changes (useCanvasZoom.ts memoizes every one
    // of these against refs, never against zoomPercent/pan state) — listed
    // here for correctness, not because zooming/panning should ever
    // trigger this effect; see useCanvasZoom.ts's header comment.
    zoom.onIframeZoomShortcut,
    zoom.onIframeWheelZoom,
    zoom.iframeToScreen,
    zoom.isSpaceHeld,
    zoom.setSpaceHeld,
    zoom.onIframePanStart,
    zoom.onIframePanMove,
    zoom.onIframePanEnd,
  ]);

  // Keeps the in-iframe selection overlay synced with React-driven
  // selection changes (Layers panel click, Escape, etc.) without
  // rebuilding the iframe — see wireSceneObjects()'s controller.
  useEffect(() => {
    const controller = sceneControllerRef.current;
    if (!controller || !scene) return;
    const objectIds = state.selection?.sceneId === scene.id ? state.selection.objectIds : [];
    controller.setSelectedObjectIds(objectIds);
    // `scene` (not just `scene?.id`) intentionally excluded: its reference
    // changes on every content edit, and re-running this on every keystroke
    // would be needless work for an effect that only cares about identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selection, scene?.id]);

  function warnIfLarge(file: File) {
    if (file.size > LARGE_FILE_WARNING_BYTES) {
      toast(
        `Fichier volumineux (${(file.size / 1024 / 1024).toFixed(1)} Mo) : il sera intégré dans la présentation mais pourrait dépasser la capacité de sauvegarde locale du navigateur — pensez à exporter régulièrement.`,
        true
      );
    }
  }

  function handleImagePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const pending = pendingImageTargetRef.current;
    if (!file || !pending) return;
    warnIfLarge(file);
    const reader = new FileReader();
    reader.onload = () => {
      const doc = frameRef.current?.contentDocument;
      const resultEl = applyImageToSlot(pending.el, reader.result as string);
      if (resultEl && resultEl !== pending.el && doc) {
        wireImageSlot(resultEl, doc, (targetEl: HTMLElement) => requestImageReplace(targetEl, pending.legacyRoot));
      }
      commitLegacyObject(pending.legacyRoot);
    };
    reader.readAsDataURL(file);
  }

  function handleInsertMediaPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const doc = frameRef.current?.contentDocument;
    const root = doc?.getElementById('slide-root');
    if (!file || !doc || !root || !scene) return;
    const objectId = findLegacyObjectId(scene);
    const legacyRoot = objectId
      ? root.querySelector<HTMLElement>(`[data-object-id="${objectId}"] .legacy-content`)
      : null;
    if (!legacyRoot) {
      toast("Impossible d'insérer un média : aucun contenu existant sur cette diapositive.", true);
      return;
    }
    warnIfLarge(file);
    const reader = new FileReader();
    reader.onload = () => {
      const container = (legacyRoot.firstElementChild as HTMLElement) || legacyRoot;
      const block = insertFreeMedia(container, doc, pendingInsertKindRef.current, reader.result as string);
      wireFreeBlock(block, doc, () => commitLegacyObject(legacyRoot));
      wireImageSlots(block, doc, (targetEl: HTMLElement) => requestImageReplace(targetEl, legacyRoot));
      commitLegacyObject(legacyRoot);
    };
    reader.readAsDataURL(file);
  }

  function handleAddText() {
    if (!scene) return;
    actions.addObject(scene.id, 'text');
  }

  function handleAddShape() {
    if (!scene) return;
    actions.addObject(scene.id, 'shape');
  }

  function handleAddIcon() {
    if (!scene) return;
    actions.addObject(scene.id, 'icon');
  }

  function requestAddPhoto() {
    photoInputRef.current?.click();
  }

  function handleInsertComponent(componentSlideId: string) {
    if (!scene) return;
    actions.insertComponentInstance(scene.id, componentSlideId);
  }

  function handleAddDiagramNode() {
    if (!scene) return;
    actions.addObject(scene.id, 'diagram-node');
  }

  function handleConnectSelection(fromId: string, toId: string) {
    if (!scene) return;
    actions.createConnector(scene.id, fromId, toId);
  }

  function handleInsertDiagramTemplate(templateKey: string) {
    if (!scene) return;
    actions.insertDiagramTemplate(scene.id, templateKey);
  }

  // Milestone (charts, v2): "Ajouter un graphique" used to always insert a
  // bar chart, silently — switching to line/pie meant already knowing the
  // Inspector had small unlabeled icon buttons for it. Taking the desired
  // kind directly here lets CanvasToolbar.jsx offer every kind (including
  // "Aire"/"Anneau", which aren't separate SceneObject types — an area
  // chart is a line chart with `kind:'area'`, a donut a pie with
  // `donut:true`) as an explicit, named choice at insert time.
  function handleAddChart(kind: 'bar' | 'line' | 'area' | 'pie' | 'donut' = 'bar') {
    if (!scene) return;
    const isDonut = kind === 'donut';
    actions.addObject(scene.id, 'chart', {
      data: {
        kind: isDonut ? 'pie' : kind,
        donut: isDonut,
        series: [
          { label: 'A', value: 30 },
          { label: 'B', value: 55 },
          { label: 'C', value: 20 },
        ],
      },
    });
  }

  function handleAddTable() {
    if (!scene) return;
    actions.addObject(scene.id, 'table');
  }

  // Milestone 9: registers (or reuses, if this exact file was already
  // inserted before) an entry in the deck-wide asset store, then references
  // it by id — see lib/assets.ts's findDuplicateAsset for the dedup check.
  function handlePhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !scene) return;
    warnIfLarge(file);
    const reader = new FileReader();
    reader.onload = () => {
      const assetId = actions.registerAsset(reader.result as string, 'image', file.name);
      actions.addObject(scene.id, 'image', { data: { assetId, fit: 'cover' } });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="ed-canvas-wrap">
      <input ref={imgInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImagePicked} />
      <input ref={insertInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleInsertMediaPicked} />
      <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoPicked} />
      {slide && (
        <CanvasToolbar
          slide={slide}
          onInsertMedia={requestInsertMedia}
          onAddText={handleAddText}
          onAddShape={handleAddShape}
          onAddIcon={handleAddIcon}
          onAddPhoto={requestAddPhoto}
          onInsertComponent={handleInsertComponent}
          onAddDiagramNode={handleAddDiagramNode}
          onConnectSelection={handleConnectSelection}
          onOpenDiagramGallery={() => setDiagramGalleryOpen(true)}
          diagramMode={diagramMode}
          onToggleDiagramMode={() => setDiagramMode((v) => !v)}
          onAddChart={handleAddChart}
          onAddTable={handleAddTable}
        />
      )}
      <div className="ed-canvas-stage" ref={stageRef}>
        {!slide && <EmptyState onOpenLayoutPicker={setLayoutPickerFor} />}
        {slide && (
          <div className="ed-canvas-scaler" ref={scalerRef}>
            <iframe key={slide.id} ref={frameRef} className="ed-canvas-frame" title="Aperçu de la diapositive" />
          </div>
        )}
        {slide && <ZoomControls zoom={zoom} />}
      </div>
      {contextMenu && <ContextMenu target={contextMenu} onClose={() => setContextMenu(null)} />}
      {layoutPickerFor && <LayoutPickerModal targetSectionId={layoutPickerFor} onClose={() => setLayoutPickerFor(null)} />}
      {diagramGalleryOpen && (
        <DiagramGalleryModal onPick={handleInsertDiagramTemplate} onClose={() => setDiagramGalleryOpen(false)} />
      )}
    </div>
  );
}
