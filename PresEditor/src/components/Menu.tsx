import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Milestone B (editor usability overhaul): the one shared dropdown-menu
// pattern, generalized from Home.tsx's hand-rolled per-card "⋯" menu
// (absolutely-positioned panel, outside-click/Escape to close). Used by
// TopBar.jsx's Fichier/Compte/Présenter menus, CanvasToolbar's Diagramme
// menu, and Sidebar's per-section "⋯" menu — Home.tsx's own menu is left
// as-is (already working, out of scope) rather than migrated.
//
// The panel is portaled to <body> and positioned with `position: fixed`
// from the trigger's live getBoundingClientRect(), rather than being a
// plain `position: absolute` child of the trigger. Several of this
// component's callers live inside a scrolling/clipping ancestor —
// `.ed-topbar` (`overflow-x: auto`, which per the CSS spec also forces the
// other axis into a clipping context, not just `visible`) and `.ed-sidebar`
// (`overflow-y: auto`) both clip a plain absolutely-positioned descendant
// the moment it extends past that ancestor's own box, which is exactly
// what "the dropdown appears behind/cut off" was — a `position: fixed`
// element isn't confined by an ancestor's overflow at all (unless that
// ancestor is itself transformed, which none of these are), the same
// reason Canvas/ContextMenu.tsx never had this problem.
export default function Menu({
  trigger,
  children,
  align = 'left',
  menuClassName = '',
}: {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number | null; right: number | null }>({
    top: 0,
    left: null,
    right: null,
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Recomputed on open, and kept in sync on scroll/resize while open (the
  // trigger's on-screen position can move — e.g. scrolling the sidebar
  // that contains it — even though the portal-rendered panel itself
  // doesn't live in that scrolling box anymore).
  useLayoutEffect(() => {
    if (!open) return undefined;
    function updatePos() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos(
        align === 'right'
          ? { top: rect.bottom + 6, left: null, right: window.innerWidth - rect.right }
          : { top: rect.bottom + 6, left: rect.left, right: null }
      );
    }
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open, align]);

  return (
    <div className="ed-menu" ref={rootRef}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open &&
        createPortal(
          // Closes on any item click, so individual menu items never need
          // their own onClose plumbing — a destructive item's own
          // window.confirm (EditorContext.tsx's existing pattern) still
          // runs first; closing the menu regardless of the confirm outcome
          // is harmless (cancel just means the user reopens it).
          <div
            ref={panelRef}
            className={`ed-menu-panel ${menuClassName}`}
            style={{ position: 'fixed', top: pos.top, left: pos.left ?? undefined, right: pos.right ?? undefined }}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>,
          document.body
        )}
    </div>
  );
}
