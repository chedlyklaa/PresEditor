// Snapshot-history wrapper around an existing reducer — see the
// Presentation Studio plan's "Undo/redo" section for why this is simpler
// and safer here than hand-written per-action inverse commands: the
// wrapped reducer already never mutates (every action returns a brand-new
// state tree), so a snapshot per checkpoint is cheap and there is no
// inverse-logic to keep in sync with every future action, forever.
//
// Deliberately pure: coalescing bookkeeping (which action a checkpoint
// merges into, and when) lives *inside* the returned state, not in a
// module-level mutable closure variable — a closure-mutating reducer would
// misbehave under React StrictMode's dev-mode double-invocation (used to
// catch impure reducers) and under any future concurrent-rendering path.

export const HISTORY_ACTIONS = {
  UNDO: '@@history/UNDO',
  REDO: '@@history/REDO',
} as const;

interface CoalesceMark {
  key: string;
  time: number;
}

export interface HistoryStateInternal<S> {
  past: S[];
  present: S;
  future: S[];
  _coalesce?: CoalesceMark;
  // Increments only on UNDO/REDO, never on a regular dispatch — an
  // explicit signal consumers can watch to tell "the user jumped to a
  // different point in history" apart from "the user is typing/dragging".
  // The canvas needs this distinction: it deliberately does *not* rebuild
  // the live iframe on every content edit (that would destroy focus mid
  // keystroke), syncing state->DOM itself via direct mutation instead —
  // but that DOM-mutation path only runs for the edit gesture that
  // produced it. A jump via undo/redo has no such gesture, so without
  // this signal the canvas would silently go stale after undoing/redoing
  // anything that isn't a structural add/remove of an object.
  navTick: number;
}

export interface WithHistoryOptions<A> {
  isUndoable: (action: A) => boolean;
  // Actions sharing the same non-null key, dispatched within the
  // coalesce window, merge into a single history entry instead of each
  // pushing its own checkpoint — e.g. every intermediate frame of one drag
  // gesture, or a burst of debounced typing commits for the same field.
  coalesceKey?: (action: A) => string | null;
  coalesceWindowMs?: number;
  // Actions that replace the document wholesale (import / start-blank).
  // These clear past/future entirely rather than being denied or
  // checkpointed — undoing "into" a just-replaced, unrelated previous
  // document would be more confusing than useful.
  isReset?: (action: A) => boolean;
}

export function createHistoryState<S>(present: S): HistoryStateInternal<S> {
  return { past: [], present, future: [], navTick: 0 };
}

export function withHistory<S, A extends { type: string }>(
  reducer: (state: S, action: A) => S,
  options: WithHistoryOptions<A>
) {
  const coalesceWindowMs = options.coalesceWindowMs ?? 1500;

  return function historyReducer(state: HistoryStateInternal<S>, action: A) {
    if ((action.type as string) === HISTORY_ACTIONS.UNDO) {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        navTick: state.navTick + 1,
      };
    }
    if ((action.type as string) === HISTORY_ACTIONS.REDO) {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        navTick: state.navTick + 1,
      };
    }

    const nextPresent = reducer(state.present, action);
    if (nextPresent === state.present) return state; // no-op action — no checkpoint

    if (options.isReset?.(action)) {
      return createHistoryState(nextPresent);
    }

    if (!options.isUndoable(action)) {
      return { ...state, present: nextPresent };
    }

    const key = options.coalesceKey?.(action) ?? null;
    const now = Date.now();
    const shouldCoalesce =
      key !== null && state._coalesce?.key === key && now - state._coalesce.time < coalesceWindowMs;

    if (shouldCoalesce) {
      return { past: state.past, present: nextPresent, future: [], _coalesce: { key, time: now }, navTick: state.navTick };
    }
    return {
      past: [...state.past, state.present],
      present: nextPresent,
      future: [],
      _coalesce: key !== null ? { key, time: now } : undefined,
      navTick: state.navTick,
    };
  };
}
