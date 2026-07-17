import { useEffect } from 'react';
import { exportPresentation } from './exportPresentation';
import { toast } from './toastBus';

// Exported for useCanvasZoom.ts, which registers its own parent-document
// keydown listener for the same reason this file's own onKeyDown does (a
// single window-level listener per concern, rather than threading zoom
// state through this hook's `actions` prop, which only carries reducer
// actions — zoom is deliberately not reducer/document state, see
// useCanvasZoom.ts's own header comment).
export function isTypingContext() {
  const active = document.activeElement;
  if (!active) return false;
  if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') return true;
  if (active.isContentEditable) return true;
  if (active.tagName === 'IFRAME') {
    try {
      const innerActive = active.contentDocument?.activeElement;
      if (innerActive?.isContentEditable) return true;
    } catch {
      /* cross-origin iframe — treat as not typing */
    }
  }
  return false;
}

function isInsideSidebar(el) {
  return !!el?.closest?.('.ed-sidebar');
}

function isInsideScenePanel(el) {
  return !!el?.closest?.('.ed-scene-panel');
}

// Milestone 10: a single source of truth for the shortcuts-help modal
// (ShortcutsHelpModal.jsx) to render from, so the list shown to users can
// never drift out of sync with what's actually bound below.
export const SHORTCUTS = [
  {
    category: 'Général',
    items: [
      { keys: 'Ctrl/Cmd + S', label: 'Exporter la présentation' },
      { keys: 'Ctrl/Cmd + Z', label: 'Annuler' },
      { keys: 'Ctrl/Cmd + Maj + Z', label: 'Rétablir' },
      { keys: '?', label: "Afficher cette aide" },
      // Milestone C (editor usability overhaul): bound in App.jsx's
      // EditorShell, not here — a plain top-level effect, gated by the same
      // isTypingContext() so Tab still navigates form fields normally while
      // one is focused.
      { keys: 'Tab', label: 'Vue épurée : masquer/afficher les panneaux latéraux' },
    ],
  },
  {
    category: 'Diapositives',
    items: [
      { keys: '↑ / ↓', label: 'Diapositive précédente / suivante (dans la liste)' },
      { keys: 'Ctrl/Cmd + D', label: 'Dupliquer la diapositive sélectionnée' },
      { keys: 'Suppr / Retour arrière', label: 'Supprimer la diapositive sélectionnée (dans la liste)' },
    ],
  },
  {
    category: 'Objets du canevas',
    items: [
      { keys: 'Suppr / Retour arrière', label: 'Supprimer les objets sélectionnés' },
      { keys: 'Ctrl/Cmd + A', label: 'Tout sélectionner sur la diapositive' },
      { keys: 'Ctrl/Cmd + G', label: 'Grouper la sélection' },
      { keys: 'Ctrl/Cmd + Maj + G', label: 'Dégrouper' },
      { keys: 'Échap', label: 'Désélectionner' },
      { keys: '↑ ↓ ← →', label: 'Déplacer la sélection d’1 px (10 px avec Maj)' },
    ],
  },
  // Milestone A (editor usability overhaul): bound in lib/useCanvasZoom.ts,
  // not in this file's own onKeyDown — that hook registers its own
  // parent-document keydown listener (see isTypingContext's export comment
  // above) and also forwards the same actions from inside the canvas
  // iframe via sceneEditing.ts's onZoomShortcut callback, so these work
  // regardless of where focus currently is.
  {
    category: 'Zoom & affichage du canevas',
    items: [
      { keys: 'Ctrl/Cmd + +', label: 'Zoomer' },
      { keys: 'Ctrl/Cmd + -', label: 'Dézoomer' },
      { keys: 'Ctrl/Cmd + 0', label: 'Ajuster à l’écran' },
      { keys: 'Ctrl/Cmd + 1', label: 'Zoom 100 %' },
      { keys: 'Ctrl/Cmd + molette', label: 'Zoomer/dézoomer vers le curseur' },
      { keys: 'Espace + glisser / clic molette', label: 'Déplacer la vue (pan) quand zoomé' },
    ],
  },
  {
    category: 'Pendant la présentation (onglet "Présenter")',
    items: [
      { keys: '← / → / Espace', label: 'Diapositive précédente / suivante' },
      { keys: 'F', label: 'Plein écran' },
      { keys: 'P', label: 'Afficher/masquer les notes du présentateur et le chronomètre' },
      { keys: 'L', label: 'Activer/désactiver le pointeur laser' },
      { keys: 'B', label: "Écran noir côté public (utilisable depuis l'un ou l'autre onglet)" },
      { keys: 'Échap', label: "Retour à la vue d'ensemble" },
    ],
  },
  {
    category: 'Vue présentateur (deux onglets synchronisés)',
    items: [
      { keys: 'Bouton "Vue présentateur"', label: "Ouvre l'onglet public et l'onglet présentateur (notes, minuteur, diapositive suivante) en même temps" },
      { keys: "n'importe lequel des deux onglets", label: 'Peut piloter la navigation — les deux restent synchronisés automatiquement' },
    ],
  },
];

// Ctrl/Cmd+S exports regardless of focus (it's the one shortcut users expect
// to "just work" everywhere); everything else backs off while the user is
// typing inside a text field, a contenteditable slide region, or a notes
// textarea, so it never steals a keystroke from actual content editing.
export function useKeyboardShortcuts(state, actions, onShowHelp) {
  useEffect(() => {
    function onKeyDown(e) {
      const meta = e.ctrlKey || e.metaKey;

      if (e.key === '?' && !isTypingContext()) {
        e.preventDefault();
        onShowHelp?.();
        return;
      }

      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (state.sections.every((s) => s.slideIds.length === 0) && state.qaSlideIds.length === 0) {
          toast('Rien à exporter pour le moment.', true);
          return;
        }
        exportPresentation(state);
        toast('Présentation exportée.');
        return;
      }

      if (isTypingContext()) return;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) actions.redo();
        else actions.undo();
        return;
      }

      if (meta && e.key.toLowerCase() === 'd' && state.selectedSlideId) {
        e.preventDefault();
        actions.duplicateSlide(state.selectedSlideId);
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedSlideId && isInsideSidebar(document.activeElement)) {
        e.preventDefault();
        actions.deleteSlide(state.selectedSlideId);
        return;
      }

      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        state.selection &&
        state.selection.objectIds.length > 0 &&
        isInsideScenePanel(document.activeElement)
      ) {
        e.preventDefault();
        actions.deleteObjects(state.selection.sceneId, state.selection.objectIds);
        return;
      }

      if (meta && e.key.toLowerCase() === 'g' && state.selection && isInsideScenePanel(document.activeElement)) {
        e.preventDefault();
        if (e.shiftKey) {
          const groupIds = new Set(
            state.selection.objectIds
              .map((objectId) => state.scenesById[state.selection.sceneId]?.objectsById[objectId]?.groupId)
              .filter(Boolean)
          );
          groupIds.forEach((groupId) => actions.ungroupObjects(state.selection.sceneId, groupId));
        } else if (state.selection.objectIds.length >= 2) {
          actions.groupObjects(state.selection.sceneId, state.selection.objectIds);
        }
        return;
      }

      if (e.key === 'Escape' && state.selection && state.selection.objectIds.length > 0) {
        actions.setSelection(state.selection.sceneId, []);
        return;
      }

      if (meta && e.key.toLowerCase() === 'a' && isInsideScenePanel(document.activeElement)) {
        const slide = state.selectedSlideId ? state.slidesById[state.selectedSlideId] : null;
        const scene = slide ? state.scenesById[slide.pages[state.selectedPage] ?? slide.pages[0]] : null;
        if (scene) {
          e.preventDefault();
          actions.setSelection(scene.id, scene.objectOrder.slice());
        }
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const flat = state.sections.flatMap((s) => s.slideIds).concat(state.qaSlideIds);
        const i = flat.indexOf(state.selectedSlideId);
        if (i > -1) {
          const next = e.key === 'ArrowDown' ? Math.min(flat.length - 1, i + 1) : Math.max(0, i - 1);
          if (next !== i) {
            e.preventDefault();
            actions.selectSlide(flat[next], 0);
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, actions, onShowHelp]);
}
