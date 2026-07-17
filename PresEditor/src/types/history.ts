// Generic snapshot-history wrapper shape — see state/history/historyReducer.ts.
// Kept generic (`<T>`) rather than hardcoded to EditorState so it stays a
// reusable, independently-testable piece of infrastructure.
export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}
