import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../../state/EditorContext';
import { EI } from '../../lib/icons';

function Icon({ name }: { name: string }) {
  return <span dangerouslySetInnerHTML={{ __html: (EI as Record<string, string>)[name] }} />;
}

// Module-level, not component state: a copied style must survive this menu
// closing (it's ephemeral per right-click) and be offered again the next
// time the menu opens on a different object — not a document mutation
// itself (nothing to undo until "Coller le style" actually applies it via
// the normal updateObjectTransform action, which *is* undoable), so it
// deliberately lives outside EditorContext/the reducer.
let copiedStyle: Record<string, unknown> | null = null;

export interface ContextMenuTarget {
  x: number;
  y: number;
  sceneId: string;
  objectId: string | null;
}

// Milestone B (editor usability overhaul): the fast path for common
// manipulation the plan calls for — duplicate, delete, reorder, group,
// lock, copy/paste style. Reuses existing EditorContext actions
// (reorderObjectZ, groupObjects/ungroupObjects, updateObjectTransform for
// both locked and style — the same "as any" passthrough ObjectInspector.tsx
// already relies on) rather than adding new reducer cases.
export default function ContextMenu({ target, onClose }: { target: ContextMenuTarget; onClose: () => void }) {
  const { state, actions } = useEditor();
  const rootRef = useRef<HTMLDivElement>(null);
  // Rendered at the target point immediately (never CSS-hidden) — a
  // visibility:hidden element cannot receive programmatic focus in any
  // browser, which broke Escape-to-close below (focus never left the
  // canvas iframe otherwise). useLayoutEffect corrects the position for
  // viewport clamping *before* the browser paints, so there's no visible
  // flash from starting at the un-clamped point anyway.
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  // `onClose` is a fresh arrow function on every Canvas.tsx render (it's
  // passed inline, `onClose={() => setContextMenu(null)}`) — and Canvas.tsx
  // re-renders for reasons that have nothing to do with this menu, most
  // notably: right-clicking an unselected object selects it first
  // (sceneEditing.ts), and Escape itself is *also* bound globally
  // (useKeyboardShortcuts.js) to clear the current selection — so pressing
  // Escape to close this menu can itself trigger a Canvas.tsx re-render at
  // the same moment. If the listener-setup effect below depended on
  // `[onClose]`, that re-render would tear down and rebuild these
  // `window` listeners *while the same keydown is still being handled*,
  // and the rebuilt listener can end up registered too late to see the
  // event that triggered it. A ref sidesteps this entirely: the listeners
  // are attached exactly once for the component's lifetime and always
  // invoke whatever `onClose` currently is.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onCloseRef.current();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current();
    }
    // Capture phase + a microtask delay: the right-click that opened this
    // menu is itself a "pointer down" the outside-click listener must not
    // immediately treat as "click outside, close" (contextmenu fires
    // before this effect's listener would otherwise catch its own
    // triggering event on some platforms).
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onPointerDown);
      window.addEventListener('contextmenu', onPointerDown);
    }, 0);
    window.addEventListener('keydown', onKeyDown);
    // The right-click that opened this menu almost always originated
    // *inside* the canvas iframe (its own separate document) — a keydown
    // there never reaches this parent-window listener at all (same
    // isolation as every other cross-iframe shortcut in this app; see
    // sceneEditing.ts's own onKeyDown comment). Moving focus onto the menu
    // itself, in the parent document, is what makes Escape (and any future
    // arrow-key menu navigation) actually reach `onKeyDown` above.
    rootRef.current?.focus();
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('contextmenu', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Clamp within the viewport after first paint, once real dimensions are known.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(target.x, window.innerWidth - rect.width - 8);
    const top = Math.min(target.y, window.innerHeight - rect.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [target.x, target.y]);

  const scene = state.scenesById[target.sceneId];
  if (!scene || !target.objectId) return null;

  const selection = state.selection?.sceneId === target.sceneId ? state.selection.objectIds : [];
  const targetIds = selection.includes(target.objectId) ? selection : [target.objectId];
  const singleObj = targetIds.length === 1 ? scene.objectsById[targetIds[0]] : null;

  function run(fn: () => void) {
    fn();
    onClose();
  }

  return (
    <div
      ref={rootRef}
      className="ed-context-menu"
      tabIndex={-1}
      style={{ left: pos.left, top: pos.top, outline: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button onClick={() => run(() => actions.duplicateObjects(target.sceneId, targetIds))}>
        <Icon name="copy" /> Dupliquer
      </button>
      {singleObj && (
        <>
          <button onClick={() => run(() => actions.reorderObjectZ(target.sceneId, singleObj.id, { toFront: true }))}>
            <Icon name="arrowUp" /> Premier plan
          </button>
          <button onClick={() => run(() => actions.reorderObjectZ(target.sceneId, singleObj.id, { toBack: true }))}>
            <Icon name="arrowDown" /> Arrière-plan
          </button>
        </>
      )}
      {targetIds.length >= 2 && (
        <button onClick={() => run(() => actions.groupObjects(target.sceneId, targetIds))}>
          <Icon name="group" /> Grouper
        </button>
      )}
      {singleObj?.groupId && (
        <button onClick={() => run(() => actions.ungroupObjects(target.sceneId, singleObj.groupId as string))}>
          <Icon name="ungroup" /> Dégrouper
        </button>
      )}
      {singleObj && (
        <button
          onClick={() => run(() => actions.updateObjectTransform(target.sceneId, singleObj.id, { locked: !singleObj.locked } as any))}
        >
          <Icon name={singleObj.locked ? 'unlock' : 'lock'} /> {singleObj.locked ? 'Déverrouiller' : 'Verrouiller'}
        </button>
      )}
      {singleObj && (
        <button onClick={() => run(() => { copiedStyle = singleObj.style ? { ...singleObj.style } : {}; })}>
          <Icon name="palette" /> Copier le style
        </button>
      )}
      {singleObj && copiedStyle && (
        <button onClick={() => run(() => actions.updateObjectTransform(target.sceneId, singleObj.id, { style: copiedStyle } as any))}>
          <Icon name="palette" /> Coller le style
        </button>
      )}
      <div className="ed-menu-sep" />
      <button className="danger" onClick={() => run(() => actions.deleteObjects(target.sceneId, targetIds))}>
        <Icon name="trash" /> Supprimer
      </button>
    </div>
  );
}
