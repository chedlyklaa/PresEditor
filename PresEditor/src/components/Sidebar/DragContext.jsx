import { createContext, useContext, useRef } from 'react';

// Drag-and-drop state changes many times per second while dragging (every
// dragover) but nothing about it needs to trigger a React re-render except
// the transient "drop here" outline, which each row owns locally. So the
// shared "what is currently being dragged" value lives in a ref, not state.
const DragCtx = createContext(null);

export function useDragRef() {
  const ref = useContext(DragCtx);
  if (!ref) throw new Error('useDragRef must be used within DragProvider');
  return ref;
}

export function DragProvider({ children }) {
  const ref = useRef(null); // { type: 'slide' | 'section', id: string } | null
  return <DragCtx.Provider value={ref}>{children}</DragCtx.Provider>;
}
