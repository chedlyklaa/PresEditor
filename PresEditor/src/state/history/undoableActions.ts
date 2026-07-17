import { A } from '../actionTypes';

// Navigation/UI-only actions — never worth an undo step.
const NON_UNDOABLE = new Set<string>([A.SELECT_SLIDE, A.SELECT_PAGE, A.TOGGLE_NOTES, A.SET_SELECTION]);

// Actions that replace the whole document (import / start-blank) reset
// history instead of being denied or checkpointed — see historyReducer.ts.
const RESET_ACTIONS = new Set<string>([A.IMPORT_STATE]);

export function isUndoable(action: { type: string }): boolean {
  return !NON_UNDOABLE.has(action.type);
}

export function isReset(action: { type: string }): boolean {
  return RESET_ACTIONS.has(action.type);
}

// Consecutive actions sharing a key within the coalesce window collapse
// into one history entry — e.g. every intermediate commit of one drag, or
// a burst of debounced typing commits for the same field.
export function coalesceKey(action: any): string | null {
  switch (action.type) {
    case A.UPDATE_SLIDE_NOTES:
      return `notes:${action.slideId}`;
    case A.UPDATE_OBJECT_TRANSFORM:
      return `transform:${action.objectId}`;
    case A.UPDATE_OBJECT_DATA:
      return `data:${action.objectId}`;
    case A.UPDATE_OBJECTS_TRANSFORM:
      return `transforms:${Object.keys(action.patches).sort().join(',')}`;
    case A.UPDATE_SCENE_BACKGROUND:
      return `scenebg:${action.sceneId}`;
    case A.UPDATE_SECTION_BACKGROUND:
      return `sectionbg:${action.sectionId}`;
    case A.UPDATE_DECK_BACKGROUND:
      return 'deckbg';
    case A.UPDATE_THEME_TOKEN:
      return `theme:${action.varName}`;
    default:
      return null;
  }
}
