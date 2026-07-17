// Milestone 11: the lossless "native" project format — a straight JSON dump
// of EditorState, versioned via a small envelope so a future milestone can
// evolve the shape without breaking older saved files. Distinct from
// exportPresentation.ts's HTML export/present: that's a one-way "publish"
// artifact (see the original Presentation Studio plan's "known gap,
// deliberately accepted" — native scene objects flatten to styled divs on
// HTML export, and re-importing that HTML later re-wraps everything into
// one opaque legacy blob). A JSON project file round-trips perfectly,
// since state/reducer.ts never mutates and every field in EditorState is
// plain, JSON-safe data (types/state.ts, types/scene.ts) — the same
// invariant that already makes localStorage autosave (lib/storage.js) work.
import { downloadBlob } from './exportPresentation';
import { migrateState } from './storage';
import type { EditorState } from '../types/state';

const PROJECT_FORMAT_VERSION = 1;

// Shared by the file-download export below and by the cloud save path
// (EditorContext.tsx's autosave effect PUTs this same shape to
// /api/projects/:id — the backend stores it verbatim, see server/src/db.ts's
// ProjectDoc.json comment) — one envelope shape, one place that builds it.
export function buildProjectEnvelope(state: EditorState) {
  return {
    format: 'presStudio-project',
    version: PROJECT_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    state,
  };
}

export function exportProjectJson(state: EditorState): void {
  const envelope = buildProjectEnvelope(state);
  const name = `${(state.meta.title || 'presentation').replace(/[^a-z0-9\-_]+/gi, '_')}.json`;
  downloadBlob(name, JSON.stringify(envelope, null, 2), 'application/json');
}

// Accepts both the versioned envelope above and a bare EditorState (e.g. a
// hand-edited or scripted file) — anything with a top-level `state` object
// is treated as the envelope form, everything else is assumed to already
// *be* a state object. Either way it's run through storage.ts's own
// migration pipeline (the same one loadState() uses for localStorage), so a
// project saved by an older milestone still opens correctly. Split out from
// parseProjectJson below so the cloud boot path (EditorContext.tsx, given
// an already-`JSON.parse`d API response rather than raw file text) can
// reuse the exact same envelope-resolution + migration logic.
export function resolveProjectState(parsed: unknown): EditorState {
  const rawState = parsed && typeof parsed === 'object' && (parsed as any).state ? (parsed as any).state : parsed;
  if (!rawState || typeof rawState !== 'object' || !(rawState as any).slidesById) {
    throw new Error('Ce fichier ne semble pas être un projet valide.');
  }
  return migrateState(rawState) as EditorState;
}

export function parseProjectJson(text: string): EditorState {
  return resolveProjectState(JSON.parse(text));
}
