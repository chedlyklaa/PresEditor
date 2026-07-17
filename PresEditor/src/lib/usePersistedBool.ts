import { useState, useCallback } from 'react';

// Milestone C (editor usability overhaul): shared by the sidebar/right-panel
// collapse toggles and ObjectInspector's per-section collapse — "remembered
// state" per the plan, backed by localStorage so it survives a reload, not
// just the current session. Falls back to `initial` if nothing's stored yet
// or if localStorage is unavailable (private browsing, etc.).
export function usePersistedBool(key: string, initial: boolean): [boolean, () => void, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === '1';
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(key, v ? '1' : '0');
      } catch {
        /* ignore — collapse state just won't persist this session */
      }
    },
    [key]
  );

  const toggle = useCallback(() => set(!value), [set, value]);

  return [value, toggle, set];
}
