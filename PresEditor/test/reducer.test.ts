import { describe, it, expect } from 'vitest';
import { editorReducer } from '../src/state/reducer';
import { A } from '../src/state/actionTypes';
import { withHistory, createHistoryState, HISTORY_ACTIONS } from '../src/state/history/historyReducer';
import { isUndoable, isReset, coalesceKey } from '../src/state/history/undoableActions';
import { createBlankStartState } from '../src/lib/emptyState';
import type { EditorState } from '../src/types/state';

// createBlankStartState() gives one section, one slide, one scene holding a
// single full-bleed legacy-html "title" object — the same shape a real new
// project starts from, not a hand-rolled fixture that could drift from it.
function baseState(): EditorState {
  return createBlankStartState();
}

function firstSceneId(state: EditorState): string {
  const slideId = state.selectedSlideId!;
  return state.slidesById[slideId].pages[0];
}

describe('reducer: object CRUD', () => {
  it('ADD_OBJECT appends the new object and selects it', () => {
    const state = baseState();
    const sceneId = firstSceneId(state);
    const before = state.scenesById[sceneId].objectOrder.length;

    const next = editorReducer(state, { type: A.ADD_OBJECT, sceneId, objectType: 'text', partial: {} });

    const scene = next.scenesById[sceneId];
    expect(scene.objectOrder.length).toBe(before + 1);
    const newId = scene.objectOrder[scene.objectOrder.length - 1];
    expect(scene.objectsById[newId].type).toBe('text');
    expect(next.selection).toEqual({ sceneId, objectIds: [newId] });
  });

  it('DELETE_OBJECT removes the object and clears its selection', () => {
    const state = baseState();
    const sceneId = firstSceneId(state);
    const added = editorReducer(state, { type: A.ADD_OBJECT, sceneId, objectType: 'shape', partial: {} });
    const objId = added.scenesById[sceneId].objectOrder.at(-1)!;

    const next = editorReducer(added, { type: A.DELETE_OBJECT, sceneId, objectId: objId });

    expect(next.scenesById[sceneId].objectsById[objId]).toBeUndefined();
    expect(next.scenesById[sceneId].objectOrder).not.toContain(objId);
    expect(next.selection).toBeNull();
  });

  it('DUPLICATE_OBJECT copies data and offsets position by (16,16)', () => {
    const state = baseState();
    const sceneId = firstSceneId(state);
    const added = editorReducer(state, {
      type: A.ADD_OBJECT,
      sceneId,
      objectType: 'shape',
      partial: { x: 100, y: 100 },
    });
    const objId = added.scenesById[sceneId].objectOrder.at(-1)!;

    const next = editorReducer(added, { type: A.DUPLICATE_OBJECT, sceneId, objectId: objId });

    const scene = next.scenesById[sceneId];
    expect(scene.objectOrder.length).toBe(added.scenesById[sceneId].objectOrder.length + 1);
    const copyId = scene.objectOrder.at(-1)!;
    expect(copyId).not.toBe(objId);
    const copy = scene.objectsById[copyId] as { x: number; y: number; type: string };
    expect(copy.x).toBe(116);
    expect(copy.y).toBe(116);
    expect(copy.type).toBe('shape');
  });

  it('a no-op action (deleting an object that no longer exists) returns the exact same state reference', () => {
    const state = baseState();
    const sceneId = firstSceneId(state);
    const next = editorReducer(state, { type: A.DELETE_OBJECT, sceneId, objectId: 'nonexistent' });
    // withHistory's checkpoint skip (see historyReducer.test.ts) relies on
    // this reference equality — a reducer that always returns a fresh
    // object even for a no-op would silently defeat that optimization.
    expect(next).toBe(state);
  });
});

describe('reducer: slide CRUD', () => {
  it('ADD_SLIDE inserts a new slide into the target section', () => {
    const state = baseState();
    const sectionId = state.sections[0].id;
    const before = state.sections[0].slideIds.length;

    const next = editorReducer(state, { type: A.ADD_SLIDE, layoutKey: 'content', targetSectionId: sectionId });

    expect(next.sections[0].slideIds.length).toBe(before + 1);
  });

  it('DELETE_SLIDE removes the slide and its scene', () => {
    const state = baseState();
    const sectionId = state.sections[0].id;
    const added = editorReducer(state, { type: A.ADD_SLIDE, layoutKey: 'content', targetSectionId: sectionId });
    const newSlideId = added.sections[0].slideIds.at(-1)!;
    const sceneId = added.slidesById[newSlideId].pages[0];

    const next = editorReducer(added, { type: A.DELETE_SLIDE, slideId: newSlideId });

    expect(next.sections[0].slideIds).not.toContain(newSlideId);
    expect(next.slidesById[newSlideId]).toBeUndefined();
    expect(next.scenesById[sceneId]).toBeUndefined();
  });
});

describe('reducer: DETACH_OBJECT (legacy-html -> multiple native objects)', () => {
  it('replaces the source object with the provided objects at its original slot', () => {
    const state = baseState();
    const sceneId = firstSceneId(state);
    const scene = state.scenesById[sceneId];
    const legacyId = scene.objectOrder[0];

    const newObjects = [
      { id: 'obj_a', type: 'text', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 0, opacity: 1, locked: false, hidden: false, data: { html: 'A' } },
      { id: 'obj_b', type: 'text', x: 0, y: 20, width: 10, height: 10, rotation: 0, zIndex: 1, opacity: 1, locked: false, hidden: false, data: { html: 'B' } },
    ];
    const next = editorReducer(state, { type: A.DETACH_OBJECT, sceneId, objectId: legacyId, objects: newObjects });

    const nextScene = next.scenesById[sceneId];
    expect(nextScene.objectsById[legacyId]).toBeUndefined();
    expect(nextScene.objectOrder).toEqual(['obj_a', 'obj_b']);
    expect(next.selection).toEqual({ sceneId, objectIds: ['obj_a', 'obj_b'] });
  });

  it('is a no-op when fewer than 2 replacement objects are given', () => {
    const state = baseState();
    const sceneId = firstSceneId(state);
    const legacyId = state.scenesById[sceneId].objectOrder[0];
    const next = editorReducer(state, {
      type: A.DETACH_OBJECT,
      sceneId,
      objectId: legacyId,
      objects: [{ id: 'only_one', type: 'text' }],
    });
    expect(next).toBe(state);
  });
});

describe('history: undo/redo and coalescing', () => {
  function historyOf() {
    return withHistory<EditorState, any>(editorReducer, { isUndoable, isReset, coalesceKey });
  }

  it('an undoable action pushes one checkpoint; undo restores the prior state', () => {
    const state = baseState();
    const sceneId = firstSceneId(state);
    const history = historyOf();
    let h = createHistoryState(state);

    h = history(h, { type: A.ADD_OBJECT, sceneId, objectType: 'text', partial: {} });
    expect(h.past.length).toBe(1);
    expect(h.present.scenesById[sceneId].objectOrder.length).toBe(state.scenesById[sceneId].objectOrder.length + 1);

    h = history(h, { type: HISTORY_ACTIONS.UNDO });
    expect(h.present).toEqual(state);
    expect(h.future.length).toBe(1);

    h = history(h, { type: HISTORY_ACTIONS.REDO });
    expect(h.present.scenesById[sceneId].objectOrder.length).toBe(state.scenesById[sceneId].objectOrder.length + 1);
  });

  it('consecutive UPDATE_OBJECT_TRANSFORM on the same object within the coalesce window merge into one checkpoint', () => {
    const state = baseState();
    const sceneId = firstSceneId(state);
    const objId = state.scenesById[sceneId].objectOrder[0];
    const history = historyOf();
    let h = createHistoryState(state);

    h = history(h, { type: A.UPDATE_OBJECT_TRANSFORM, sceneId, objectId: objId, patch: { x: 10 } });
    expect(h.past.length).toBe(1);
    h = history(h, { type: A.UPDATE_OBJECT_TRANSFORM, sceneId, objectId: objId, patch: { x: 20 } });
    h = history(h, { type: A.UPDATE_OBJECT_TRANSFORM, sceneId, objectId: objId, patch: { x: 30 } });

    // Three drags of the same object, one undo step — not three.
    expect(h.past.length).toBe(1);
    expect((h.present.scenesById[sceneId].objectsById[objId] as { x: number }).x).toBe(30);

    h = history(h, { type: HISTORY_ACTIONS.UNDO });
    expect(h.present).toEqual(state); // one undo unwinds the whole coalesced drag
  });

  it('non-undoable actions (e.g. SET_SELECTION) never push a checkpoint', () => {
    const state = baseState();
    const sceneId = firstSceneId(state);
    const objId = state.scenesById[sceneId].objectOrder[0];
    const history = historyOf();
    let h = createHistoryState(state);

    h = history(h, { type: A.SET_SELECTION, sceneId, objectIds: [objId] });

    expect(h.past.length).toBe(0);
    expect(h.present.selection).toEqual({ sceneId, objectIds: [objId] });
  });

  it('IMPORT_STATE (a reset action) clears past and future rather than checkpointing', () => {
    const state = baseState();
    const sceneId = firstSceneId(state);
    const history = historyOf();
    let h = createHistoryState(state);
    h = history(h, { type: A.ADD_OBJECT, sceneId, objectType: 'text', partial: {} });
    expect(h.past.length).toBe(1);

    const freshState = baseState();
    h = history(h, { type: A.IMPORT_STATE, payload: freshState });

    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.present).toBe(freshState);
  });
});
