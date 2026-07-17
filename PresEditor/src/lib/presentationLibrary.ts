import { uid } from './id';
import type { EditorState } from '../types/state';

const INDEX_KEY = 'presEditor_library_index_v1';
const ITEM_PREFIX = 'presEditor_library_item_';

export interface LibraryEntry {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  slideCount: number;
}

function readIndex(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: LibraryEntry[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    /* storage full — the per-doc item write below will already have
       surfaced/failed the same way; nothing more useful to do here */
  }
}

export function listLibraryEntries(): LibraryEntry[] {
  return readIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function countSlides(state: EditorState): number {
  const main = (state.sections || []).reduce((n, s) => n + s.slideIds.length, 0);
  return main + (state.qaSlideIds || []).length;
}

// Upserts both the per-doc snapshot and its index entry. Called from
// EditorContext's existing debounced autosave effect, right alongside the
// single-slot saveState(state) call it already makes — every autosave now
// also lands here, keyed by state.meta.libraryId, so the welcome/library
// screen can list every presentation ever opened or created, not just the
// one most-recently-open session.
export function saveToLibrary(id: string, state: EditorState): boolean {
  try {
    localStorage.setItem(ITEM_PREFIX + id, JSON.stringify(state));
  } catch {
    return false;
  }
  const entries = readIndex();
  const existing = entries.find((e) => e.id === id);
  const now = new Date().toISOString();
  const entry: LibraryEntry = {
    id,
    title: state.meta.title || 'Sans titre',
    updatedAt: now,
    createdAt: existing ? existing.createdAt : now,
    slideCount: countSlides(state),
  };
  writeIndex(existing ? entries.map((e) => (e.id === id ? entry : e)) : [...entries, entry]);
  return true;
}

export function loadFromLibrary(id: string): EditorState | null {
  try {
    const raw = localStorage.getItem(ITEM_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function deleteFromLibrary(id: string) {
  try {
    localStorage.removeItem(ITEM_PREFIX + id);
  } catch {
    /* ignore */
  }
  writeIndex(readIndex().filter((e) => e.id !== id));
}

export function newLibraryId(): string {
  return uid('doc');
}
