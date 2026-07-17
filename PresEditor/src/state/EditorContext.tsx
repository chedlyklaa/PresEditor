import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { A } from './actionTypes';
import { editorReducer, totalSlideCount } from './reducer';
import { withHistory, createHistoryState, HISTORY_ACTIONS, type HistoryStateInternal } from './history/historyReducer';
import { isUndoable, isReset, coalesceKey } from './history/undoableActions';
import { createEmptyState, createBlankStartState } from '../lib/emptyState';
import { parsePresentationSource } from '../lib/importPresentation';
import { loadState, saveState, migrateState } from '../lib/storage';
import { saveToLibrary, loadFromLibrary, deleteFromLibrary, newLibraryId } from '../lib/presentationLibrary';
import { getProject, createProject, updateProject, updateProjectThumbnail } from '../lib/apiClient';
import { queueSave, getQueuedSave, clearQueuedSave } from '../lib/offlineQueue';
import { renderThumbnail } from '../lib/thumbnail';
import { toast } from '../lib/toastBus';
import { findDuplicateAsset, createAsset } from '../lib/assets';
import { detachHtmlIntoObjects } from '../lib/detachLegacyObject';
import { createStarterState } from '../lib/presentationTemplates';
import { parseProjectJson, resolveProjectState, buildProjectEnvelope } from '../lib/projectFile';
import { THEME_PALETTES, applyThemePalette } from '../lib/themePalettes';
import type { EditorState, Asset } from '../types/state';

// Told to EditorProvider by whichever route mounts it (see App.jsx) instead
// of the provider deciding internally — 'local' preserves today's boot
// behavior (resume/auto-fetch/blank) unchanged; 'cloud' fetches a specific
// server-stored project by id. Everything downstream (reducer, renderScene,
// undo history, export) is identical either way — only *what gets loaded
// and where it's saved back to* differs.
export type BootSource = { kind: 'local' } | { kind: 'cloud'; projectId: string };

interface EditorContextValue {
  state: EditorState;
  dispatch: (action: any) => void;
  actions: ReturnType<typeof buildActionsShape>;
  source: BootSource;
  bootStatus: 'loading' | 'ready' | 'welcome';
  // 'offline' (cloud mode only): a save attempt failed to reach the
  // server — the content is queued (lib/offlineQueue.ts) and retried
  // automatically, not lost.
  saveStatus: 'idle' | 'saving' | 'saved' | 'error' | 'offline';
  savedAt: Date | null;
  canUndo: boolean;
  canRedo: boolean;
  // Increments only on undo/redo — see historyReducer.ts's `navTick` for
  // why the canvas specifically needs this signal.
  historyTick: number;
}

// Only used for the TS return-type helper above — the real object is built
// inline in the provider (it needs `dispatch`/`stateRef`, not available at
// module scope).
declare function buildActionsShape(): {
  setTitle: (title: string) => void;
  addSection: () => void;
  renameSection: (sectionId: string, label: string) => void;
  cycleSectionColor: (sectionId: string) => void;
  toggleSectionCollapse: (sectionId: string) => void;
  moveSection: (sectionId: string, dir: number) => void;
  deleteSection: (sectionId: string) => void;
  toggleQaCollapse: () => void;
  addSlide: (layoutKey: string, targetSectionId: string, atIndex?: number | null) => void;
  duplicateSlide: (slideId: string) => void;
  deleteSlide: (slideId: string) => void;
  moveSlide: (slideId: string, dir: number) => void;
  relocateSlide: (slideId: string, targetSectionId: string, targetIndex?: number | null) => void;
  selectSlide: (slideId: string, page?: number) => void;
  selectPage: (page: number) => void;
  addPage: (slideId: string) => void;
  deletePage: (slideId: string, pageIndex: number) => void;
  updateSlideNotes: (slideId: string, notes: string) => void;
  updateSlideBg: (slideId: string, cls: 'slide-light' | 'slide-dark') => void;
  updateSlideBgColor: (slideId: string, color: string | null) => void;
  updateSlideNodeIcon: (slideId: string, icon: string) => void;
  updateSlideNodeLabel: (slideId: string, label: string) => void;
  toggleNotes: () => void;
  importFromText: (text: string, source: string) => boolean;
  undo: () => void;
  redo: () => void;
  setSelection: (sceneId: string, objectIds: string[]) => void;
  addObject: (sceneId: string, objectType: string, partial?: object) => void;
  deleteObject: (sceneId: string, objectId: string) => void;
  duplicateObject: (sceneId: string, objectId: string) => void;
  updateObjectTransform: (
    sceneId: string,
    objectId: string,
    patch: Partial<{ x: number; y: number; width: number; height: number; rotation: number }>
  ) => void;
  updateObjectData: (sceneId: string, objectId: string, dataPatch: object) => void;
  reorderObjectZ: (sceneId: string, objectId: string, opts: { dir?: number; toFront?: boolean; toBack?: boolean }) => void;
  registerCanvasFrame: (doc: Document | null) => void;
  detachObject: (sceneId: string, objectId: string) => void;
  updateObjectsTransform: (sceneId: string, patches: Record<string, object>) => void;
  deleteObjects: (sceneId: string, objectIds: string[]) => void;
  duplicateObjects: (sceneId: string, objectIds: string[], positionOverrides?: Record<string, { x: number; y: number }>) => void;
  groupObjects: (sceneId: string, objectIds: string[]) => void;
  ungroupObjects: (sceneId: string, groupId: string) => void;
  alignObjects: (sceneId: string, objectIds: string[], edge: string) => void;
  distributeObjects: (sceneId: string, objectIds: string[], axis: 'horizontal' | 'vertical') => void;
  updateSceneBackground: (sceneId: string, background: object | null) => void;
  updateSectionBackground: (sectionId: string, background: object | null) => void;
  updateDeckBackground: (background: object | null) => void;
  updateThemeToken: (varName: string, value: string) => void;
  addMasterSlide: () => void;
  deleteMasterSlide: (masterSlideId: string) => void;
  setSectionMaster: (sectionId: string, masterSlideId: string | null) => void;
  setDeckMaster: (masterSlideId: string | null) => void;
  addComponent: () => void;
  deleteComponent: (componentSlideId: string) => void;
  insertComponentInstance: (sceneId: string, componentSlideId: string) => void;
  createComponentFromSelection: (sceneId: string, objectIds: string[], name?: string) => void;
  createConnector: (sceneId: string, fromId: string, toId: string) => void;
  insertDiagramTemplate: (sceneId: string, templateKey: string) => void;
  registerAsset: (dataUrl: string, kind: 'image', name: string) => string;
  deleteAsset: (assetId: string) => void;
  addSectionFromTemplate: (templateKey: string) => void;
  createNewPresentation: (opts: { starterKey: string; title: string; themeKey?: string }) => void;
  importProjectFile: (text: string) => boolean;
  addEdge: (fromSlideId: string, toSlideId: string) => void;
  deleteEdge: (edgeId: string) => void;
  redirectEdge: (edgeId: string, endpoint: 'from' | 'to', newSlideId: string) => void;
  openFromLibrary: (id: string) => void;
  deleteLibraryEntry: (id: string) => void;
  goToLibrary: () => void;
  saveLocalCopyToCloud: () => Promise<void>;
};

const EditorStateContext = createContext<EditorContextValue | null>(null);

function hasContent(s: EditorState | null): boolean {
  if (!s) return false;
  const mainCount = (s.sections || []).reduce((n, sec) => n + sec.slideIds.length, 0);
  return mainCount > 0 || (s.qaSlideIds || []).length > 0;
}

// Presentation library (v2): every document needs a stable id to be saved
// under in lib/presentationLibrary.ts, distinct from the single-slot
// session autosave that predates it. Stamped once, here, the first time a
// state reaches boot/creation without one — never reassigned afterwards
// (a project file re-imported that already carries a libraryId keeps it,
// so re-opening the same exported project updates its existing library
// entry instead of forking a duplicate).
function ensureLibraryId(state: EditorState): EditorState {
  if (state.meta.libraryId) return state;
  return { ...state, meta: { ...state.meta, libraryId: newLibraryId() } };
}

// Action shapes vary per action type (see reducer.ts, which — deliberately,
// for Milestone 1 — takes `action: any` rather than a full discriminated
// action union) so this is instantiated with `any` for the action type
// too. Without the explicit generic here, inference from an `any`-typed
// reducer parameter falls back to the narrowest constraint ({type:
// string}), which would reject every action's extra fields.
const wrappedReducer = withHistory<EditorState, any>(editorReducer, { isUndoable, isReset, coalesceKey });

export function EditorProvider({ source, children }: { source: BootSource; children: ReactNode }) {
  const [history, dispatch] = useReducer(
    wrappedReducer,
    undefined,
    () => createHistoryState(createEmptyState() as EditorState) as HistoryStateInternal<EditorState>
  );
  const state = history.present;
  const navigate = useNavigate();

  // 'loading' | 'ready' | 'welcome' — welcome = nothing to edit yet, show the
  // import / start-blank choice instead of an empty canvas.
  const [bootStatus, setBootStatus] = useState<'loading' | 'ready' | 'welcome'>('loading');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'offline'>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Cloud mode only — keeps retrying a failed save every few seconds until
  // it succeeds, independent of further edits (see the autosave effect).
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const booted = useRef(false);

  // `actions` below reads state through this ref instead of closing over
  // `state` directly, so the actions object can stay referentially stable
  // across every keystroke. Consumers wrapped in React.memo (SlideRow,
  // SectionItem...) would otherwise re-render on every render of the
  // provider just because the `actions` prop "changed".
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Set by Canvas.tsx (the only thing that owns the live preview iframe)
  // every time it (re)loads, cleared on unload — lets detachObject below
  // reach into the *rendered* DOM to measure where each piece of a
  // legacy-html/text object's bundled content currently sits, without
  // Canvas.tsx needing to know anything about what detachObject does with
  // it. A ref, not state: this never needs to trigger a re-render.
  const frameDocRef = useRef<Document | null>(null);

  // source is stable for the lifetime of a mounted EditorProvider — the
  // route that renders it either never changes (kind:'local') or is
  // key={projectId}'d so a different project is a fresh mount, never a
  // prop change mid-life (see App.jsx) — so plain closures over `source`
  // below are safe without adding it to dependency arrays.
  const cloudProjectId = source.kind === 'cloud' ? source.projectId : null;

  // Shared by both places a cloud save can first fail — the debounced
  // autosave effect below, and bootCloud's one-off flush of a queued save
  // recovered from IndexedDB (see the boot effect) — so a failure in
  // *either* keeps retrying every few seconds until it lands, rather than
  // only the autosave-effect path getting a retry loop. Without this,
  // reloading while still offline would recover the queued edit into the
  // editor correctly but then silently stop trying to sync it, since the
  // very next "ready" state is the debounced autosave effect's own
  // deliberate first-save skip (nothing *new* to push back).
  const retryCloudSave = useCallback((projectId: string, title: string, json: unknown) => {
    setSaveStatus('offline');
    clearTimeout(retryTimer.current);
    const attempt = () => {
      updateProject(projectId, title, json)
        .then(() => {
          setSaveStatus('saved');
          setSavedAt(new Date());
          clearQueuedSave(projectId);
        })
        .catch(() => {
          retryTimer.current = setTimeout(attempt, 5000);
        });
    };
    retryTimer.current = setTimeout(attempt, 5000);
  }, []);

  // ---- boot ----
  // 'local': resume a previous single-slot session, else best-effort
  // auto-load the sibling presentation.html (served from /public by the dev
  // server), else fall back to a welcome screen — byte-for-byte the
  // pre-routing behavior. 'cloud': fetch one specific project by id from
  // the backend (server/) and open straight into it; a missing/forbidden
  // id bounces back to /home with a toast rather than leaving a dead editor.
  useEffect(() => {
    let cancelled = false;
    async function bootLocal() {
      const saved = loadState();
      if (hasContent(saved)) {
        dispatch({ type: A.IMPORT_STATE, payload: ensureLibraryId(saved as EditorState) });
        if (!cancelled) {
          setBootStatus('ready');
          toast('Session précédente restaurée.');
        }
        return;
      }
      try {
        const res = await fetch('/presentation.html', { cache: 'no-store' });
        if (res.ok) {
          const text = await res.text();
          const parsed = parsePresentationSource(text, 'fetch');
          if (!cancelled) {
            dispatch({ type: A.IMPORT_STATE, payload: ensureLibraryId(parsed as EditorState) });
            setBootStatus('ready');
            toast('presentation.html chargé automatiquement.');
          }
          return;
        }
      } catch {
        /* no dev-server copy available — fall through to welcome screen */
      }
      if (!cancelled) setBootStatus('welcome');
    }
    async function bootCloud(projectId: string) {
      // A queued save (lib/offlineQueue.ts) means the *previous* session
      // ended with edits that never reached the server — that content is
      // strictly newer than whatever GET returns, so it takes priority over
      // re-fetching. Flushing it immediately (rather than waiting for the
      // next debounced autosave tick) means reopening the project while
      // back online resyncs it right away.
      const queued = await getQueuedSave(projectId);
      if (queued) {
        try {
          const resolved = resolveProjectState(queued.json);
          if (cancelled) return;
          dispatch({ type: A.IMPORT_STATE, payload: resolved });
          setBootStatus('ready');
          toast('Modifications non synchronisées restaurées — nouvel envoi en cours…', true);
          updateProject(projectId, queued.title, queued.json)
            .then(() => {
              setSaveStatus('saved');
              setSavedAt(new Date());
              clearQueuedSave(projectId);
            })
            .catch(() => retryCloudSave(projectId, queued.title, queued.json));
          return;
        } catch {
          /* malformed queue entry — fall through to a normal server fetch */
        }
      }
      try {
        const doc = await getProject(projectId);
        const resolved = resolveProjectState(doc.json);
        if (cancelled) return;
        dispatch({ type: A.IMPORT_STATE, payload: resolved });
        setBootStatus('ready');
      } catch (err: any) {
        if (cancelled) return;
        toast(`Impossible d'ouvrir cette présentation : ${err.message}`, true);
        navigate('/home', { replace: true });
      }
    }
    if (cloudProjectId) bootCloud(cloudProjectId);
    else bootLocal();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- autosave (debounced) ----
  // 'local' branch is byte-for-byte the pre-routing behavior (single-slot
  // localStorage + the local presentationLibrary.ts index). 'cloud' branch
  // PUTs the M11 envelope (lib/projectFile.ts's buildProjectEnvelope) to
  // this specific project's /api/projects/:id — Milestone C adds the
  // offline queue + thumbnail refresh into this same effect.
  useEffect(() => {
    if (bootStatus !== 'ready') return;
    const firstReady = !booted.current;
    booted.current = true;

    if (!cloudProjectId) {
      // Presentation library (v2): kept in sync on every 'ready' state,
      // including the very first one — unlike the single-slot save below,
      // skipping the first save here would mean a freshly auto-loaded or
      // freshly created document never shows up in "Mes présentations"
      // until the user makes an actual edit.
      const libTimer = setTimeout(() => {
        if (state.meta.libraryId) saveToLibrary(state.meta.libraryId, state);
      }, 700);

      if (firstReady) return () => clearTimeout(libTimer); // don't fire the single-slot save on the very first "ready" state

      setSaveStatus('saving');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const ok = saveState(state);
        setSaveStatus(ok ? 'saved' : 'error');
        setSavedAt(ok ? new Date() : savedAt);
        if (!ok) toast('Stockage local plein : pensez à exporter votre travail.', true);
      }, 700);
      return () => {
        clearTimeout(saveTimer.current);
        clearTimeout(libTimer);
      };
    }

    // Nothing to push back on the very first "ready" — this state was just
    // loaded *from* the server a moment ago (bootCloud above).
    if (firstReady) return;
    setSaveStatus('saving');
    clearTimeout(saveTimer.current);
    clearTimeout(retryTimer.current);
    const title = state.meta.title;
    const envelope = buildProjectEnvelope(state);
    saveTimer.current = setTimeout(() => {
      updateProject(cloudProjectId, title, envelope)
        .then(() => {
          setSaveStatus('saved');
          setSavedAt(new Date());
          clearQueuedSave(cloudProjectId);
          // Best-effort, never blocks/affects saveStatus — a thumbnail
          // failure shouldn't look like a content-save failure to the user.
          renderThumbnail(state)
            .then((thumb) => {
              if (thumb) return updateProjectThumbnail(cloudProjectId, thumb);
            })
            .catch(() => {});
        })
        .catch(() => {
          // Server unreachable — queue for IndexedDB persistence (survives
          // a reload) and keep retrying every few seconds until it lands,
          // independent of whether the user keeps editing.
          queueSave(cloudProjectId, { title, json: envelope });
          retryCloudSave(cloudProjectId, title, envelope);
        });
    }, 800);
    return () => {
      clearTimeout(saveTimer.current);
      clearTimeout(retryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, bootStatus]);

  const importFromText = useCallback((text: string, source: string) => {
    try {
      const parsed = parsePresentationSource(text, source);
      dispatch({ type: A.IMPORT_STATE, payload: ensureLibraryId(parsed as EditorState) });
      setBootStatus('ready');
      toast('Présentation importée.');
      return true;
    } catch (err: any) {
      toast(`Échec de l'import : ${err.message}`, true);
      return false;
    }
  }, []);

  // Milestone C (v2): the single entry point both Welcome.jsx's "New
  // presentation" flow and TopBar.jsx's mid-session "Nouveau" button funnel
  // through — builds via createBlankStartState()/createStarterState() (the
  // same factories a prior milestone's now-removed startBlank/
  // startFromTemplate actions used directly), then applies a title and an
  // optional theme palette before the state is dispatched. Theming reuses
  // lib/themePalettes.ts's applyThemePalette(), itself just Milestone 4's
  // existing setThemeTokenInStyleBlock() looped over every var in the
  // chosen palette — no new theming mechanism, only a new place that calls it.
  const createNewPresentation = useCallback((opts: { starterKey: string; title: string; themeKey?: string }) => {
    const built = opts.starterKey === 'blank' ? createBlankStartState() : createStarterState(opts.starterKey);
    if (!built) return;
    if (opts.title.trim()) built.meta.title = opts.title.trim();
    const palette = THEME_PALETTES.find((p) => p.key === opts.themeKey);
    if (palette) built.meta.styleBlock = applyThemePalette(built.meta.styleBlock, palette);
    built.meta.libraryId = newLibraryId();
    dispatch({ type: A.IMPORT_STATE, payload: built });
    setBootStatus('ready');
  }, []);

  // Presentation library (v2): loads a previously-saved document from
  // lib/presentationLibrary.ts's per-doc storage (distinct from the
  // single-slot session autosave loadState() reads on boot) — reached from
  // the library/welcome screen's "Ouvrir" card action. Runs through the same
  // migrateState() stale-shape migrations as a resumed session or an
  // imported project file, since a library entry saved before an earlier
  // milestone is just as likely to need them.
  const openFromLibrary = useCallback((id: string) => {
    const raw = loadFromLibrary(id);
    if (!raw) {
      toast('Impossible de charger cette présentation.', true);
      return;
    }
    dispatch({ type: A.IMPORT_STATE, payload: migrateState(raw) as EditorState });
    setBootStatus('ready');
  }, []);

  // No confirm here — the library card itself asks before calling this
  // (same split as deleteSection's confirm-in-actions vs deleteObject's
  // confirm-in-caller: this one lives in the UI since the library screen
  // already renders a per-card delete affordance, not a shared list actions
  // has to gate). If the deleted entry is the document currently open in
  // this session, stamp a fresh libraryId onto it so the next autosave
  // doesn't silently resurrect the entry the user just deleted.
  const deleteLibraryEntry = useCallback((id: string) => {
    deleteFromLibrary(id);
    if (stateRef.current.meta.libraryId === id) {
      dispatch({
        type: A.IMPORT_STATE,
        payload: { ...stateRef.current, meta: { ...stateRef.current.meta, libraryId: newLibraryId() } },
      });
    }
  }, []);

  const goToLibrary = useCallback(() => setBootStatus('welcome'), []);

  // Milestone E: local mode's escape hatch into the cloud, offered from
  // TopBar.jsx only when the user is signed in — a one-off upload (not a
  // mode switch the rest of this provider needs to know about), so this
  // just POSTs the current in-memory state as a brand-new project and
  // navigates to its /editor/:id route, where a fresh EditorProvider takes
  // over with source:{kind:'cloud'} exactly like opening any other cloud
  // project. The local copy this editor instance was showing is untouched
  // (still on disk / in local-storage, whichever this session came from).
  const saveLocalCopyToCloud = useCallback(async () => {
    const s = stateRef.current;
    try {
      const created = await createProject(s.meta.title || 'Présentation sans titre', buildProjectEnvelope(s));
      toast('Copie enregistrée dans votre compte.');
      navigate(`/editor/${created.id}`);
    } catch (err: any) {
      toast(err.message || "Échec de l'enregistrement dans le compte.", true);
    }
  }, [navigate]);

  // Milestone 11: mirrors importFromText's try/dispatch/toast shape exactly
  // — same failure mode (malformed input), same recovery (toast, state
  // untouched) — just for a JSON project file instead of an HTML deck.
  const importProjectFile = useCallback((text: string) => {
    try {
      const parsed = parseProjectJson(text);
      dispatch({ type: A.IMPORT_STATE, payload: ensureLibraryId(parsed as EditorState) });
      setBootStatus('ready');
      toast('Projet chargé.');
      return true;
    } catch (err: any) {
      toast(`Échec du chargement du projet : ${err.message}`, true);
      return false;
    }
  }, []);

  const actions = useMemo(
    () => ({
      setTitle: (title: string) => dispatch({ type: A.SET_TITLE, title }),

      addSection: () => dispatch({ type: A.ADD_SECTION }),
      renameSection: (sectionId: string, label: string) => dispatch({ type: A.RENAME_SECTION, sectionId, label }),
      cycleSectionColor: (sectionId: string) => dispatch({ type: A.CYCLE_SECTION_COLOR, sectionId }),
      toggleSectionCollapse: (sectionId: string) => dispatch({ type: A.TOGGLE_SECTION_COLLAPSE, sectionId }),
      moveSection: (sectionId: string, dir: number) => dispatch({ type: A.MOVE_SECTION, sectionId, dir }),
      deleteSection: (sectionId: string) => {
        const current = stateRef.current;
        const section = current.sections.find((s) => s.id === sectionId);
        if (!section) return;
        if (current.sections.length === 1 && current.qaSlideIds.length === 0) {
          toast('Impossible de supprimer la seule section restante.', true);
          return;
        }
        const n = section.slideIds.length;
        const msg =
          n > 0
            ? `Supprimer la section « ${section.label} » et ses ${n} diapositive(s) ?`
            : `Supprimer la section « ${section.label} » ?`;
        if (!window.confirm(msg)) return;
        dispatch({ type: A.DELETE_SECTION, sectionId });
      },
      toggleQaCollapse: () => dispatch({ type: A.TOGGLE_QA_COLLAPSE }),

      addSlide: (layoutKey: string, targetSectionId: string, atIndex?: number | null) =>
        dispatch({ type: A.ADD_SLIDE, layoutKey, targetSectionId, atIndex }),
      duplicateSlide: (slideId: string) => dispatch({ type: A.DUPLICATE_SLIDE, slideId }),
      deleteSlide: (slideId: string) => {
        if (totalSlideCount(stateRef.current) <= 1) {
          toast('Impossible de supprimer la dernière diapositive.', true);
          return;
        }
        if (!window.confirm('Supprimer définitivement cette diapositive ?')) return;
        dispatch({ type: A.DELETE_SLIDE, slideId });
      },
      moveSlide: (slideId: string, dir: number) => dispatch({ type: A.MOVE_SLIDE, slideId, dir }),
      relocateSlide: (slideId: string, targetSectionId: string, targetIndex?: number | null) =>
        dispatch({ type: A.RELOCATE_SLIDE, slideId, targetSectionId, targetIndex }),

      selectSlide: (slideId: string, page = 0) => dispatch({ type: A.SELECT_SLIDE, slideId, page }),
      selectPage: (page: number) => dispatch({ type: A.SELECT_PAGE, page }),
      addPage: (slideId: string) => dispatch({ type: A.ADD_PAGE, slideId }),
      deletePage: (slideId: string, pageIndex: number) => {
        if (!window.confirm('Supprimer cette page de la diapositive ?')) return;
        dispatch({ type: A.DELETE_PAGE, slideId, pageIndex });
      },

      updateSlideNotes: (slideId: string, notes: string) => dispatch({ type: A.UPDATE_SLIDE_NOTES, slideId, notes }),
      updateSlideBg: (slideId: string, cls: string) => dispatch({ type: A.UPDATE_SLIDE_BG, slideId, cls }),
      updateSlideBgColor: (slideId: string, color: string | null) =>
        dispatch({ type: A.UPDATE_SLIDE_BG_COLOR, slideId, color }),
      updateSlideNodeIcon: (slideId: string, icon: string) => dispatch({ type: A.UPDATE_SLIDE_NODE_ICON, slideId, icon }),
      updateSlideNodeLabel: (slideId: string, label: string) =>
        dispatch({ type: A.UPDATE_SLIDE_NODE_LABEL, slideId, label }),

      toggleNotes: () => dispatch({ type: A.TOGGLE_NOTES }),
      importFromText,

      // ---- history ----
      undo: () => dispatch({ type: HISTORY_ACTIONS.UNDO }),
      redo: () => dispatch({ type: HISTORY_ACTIONS.REDO }),

      // ---- scene/object actions (Presentation Studio, Milestone 1) ----
      setSelection: (sceneId: string, objectIds: string[]) => dispatch({ type: A.SET_SELECTION, sceneId, objectIds }),
      addObject: (sceneId: string, objectType: string, partial?: object) =>
        dispatch({ type: A.ADD_OBJECT, sceneId, objectType, partial }),
      deleteObject: (sceneId: string, objectId: string) => dispatch({ type: A.DELETE_OBJECT, sceneId, objectId }),
      duplicateObject: (sceneId: string, objectId: string) => dispatch({ type: A.DUPLICATE_OBJECT, sceneId, objectId }),
      updateObjectTransform: (sceneId: string, objectId: string, patch: object) =>
        dispatch({ type: A.UPDATE_OBJECT_TRANSFORM, sceneId, objectId, patch }),
      updateObjectData: (sceneId: string, objectId: string, dataPatch: object) =>
        dispatch({ type: A.UPDATE_OBJECT_DATA, sceneId, objectId, dataPatch }),
      reorderObjectZ: (sceneId: string, objectId: string, opts: object) =>
        dispatch({ type: A.REORDER_OBJECT_Z, sceneId, objectId, ...opts }),
      registerCanvasFrame: (doc: Document | null) => {
        frameDocRef.current = doc;
      },
      // "Détacher en objets" (LayersPanel.tsx): explodes one legacy-html/text
      // object's bundled content (a title + paragraph + bullet list + image
      // all living inside a single `data.html` blob, one Layers row, one
      // draggable box) into several independently selectable/movable native
      // objects. Needs the *live* rendered DOM to know where each piece
      // currently sits (lib/detachLegacyObject.ts's own comment has the
      // full reasoning) — reducer.ts can't do that itself, so this builds
      // the new objects here, synchronously, and dispatches the result as
      // one atomic action (one undo step for the whole split).
      detachObject: (sceneId: string, objectId: string) => {
        const scene = stateRef.current.scenesById[sceneId];
        const obj = scene?.objectsById[objectId];
        if (!scene || !obj || (obj.type !== 'legacy-html' && obj.type !== 'text')) return;
        const doc = frameDocRef.current;
        const wrapperEl = doc?.querySelector<HTMLElement>(`[data-object-id="${objectId}"]`);
        if (!doc || !wrapperEl) {
          toast("Impossible de détacher : la diapositive n'est pas encore chargée.", true);
          return;
        }
        const containerEl = wrapperEl.querySelector<HTMLElement>('.legacy-content') || wrapperEl;
        const objects = detachHtmlIntoObjects(containerEl, scene.objectOrder.length);
        if (!objects) {
          toast('Rien à détacher : ce contenu est déjà un seul élément.', true);
          return;
        }
        dispatch({ type: A.DETACH_OBJECT, sceneId, objectId, objects });
      },

      // ---- multi-object actions (Presentation Studio, Milestone 2) ----
      updateObjectsTransform: (sceneId: string, patches: Record<string, object>) =>
        dispatch({ type: A.UPDATE_OBJECTS_TRANSFORM, sceneId, patches }),
      // No confirm dialog — consistent with the single-object deleteObject
      // (Milestone 1): object deletion is common/granular enough that a
      // confirm prompt on every delete would be more annoying than useful
      // now that undo exists as the safety net.
      deleteObjects: (sceneId: string, objectIds: string[]) => {
        if (objectIds.length === 0) return;
        dispatch({ type: A.DELETE_OBJECTS, sceneId, objectIds });
      },
      duplicateObjects: (sceneId: string, objectIds: string[], positionOverrides?: Record<string, { x: number; y: number }>) =>
        dispatch({ type: A.DUPLICATE_OBJECTS, sceneId, objectIds, positionOverrides }),
      groupObjects: (sceneId: string, objectIds: string[]) => dispatch({ type: A.GROUP_OBJECTS, sceneId, objectIds }),
      ungroupObjects: (sceneId: string, groupId: string) => dispatch({ type: A.UNGROUP_OBJECTS, sceneId, groupId }),
      alignObjects: (sceneId: string, objectIds: string[], edge: string) =>
        dispatch({ type: A.ALIGN_OBJECTS, sceneId, objectIds, edge }),
      distributeObjects: (sceneId: string, objectIds: string[], axis: 'horizontal' | 'vertical') =>
        dispatch({ type: A.DISTRIBUTE_OBJECTS, sceneId, objectIds, axis }),

      // ---- backgrounds & theme (Presentation Studio, Milestone 4) ----
      updateSceneBackground: (sceneId: string, background: object | null) =>
        dispatch({ type: A.UPDATE_SCENE_BACKGROUND, sceneId, background }),
      updateSectionBackground: (sectionId: string, background: object | null) =>
        dispatch({ type: A.UPDATE_SECTION_BACKGROUND, sectionId, background }),
      updateDeckBackground: (background: object | null) => dispatch({ type: A.UPDATE_DECK_BACKGROUND, background }),
      updateThemeToken: (varName: string, value: string) => dispatch({ type: A.UPDATE_THEME_TOKEN, varName, value }),

      // ---- master slides & reusable components (Presentation Studio, Milestone 5) ----
      addMasterSlide: () => dispatch({ type: A.ADD_MASTER_SLIDE }),
      deleteMasterSlide: (masterSlideId: string) => {
        if (!window.confirm('Supprimer ce modèle de diapositive ?')) return;
        dispatch({ type: A.DELETE_MASTER_SLIDE, masterSlideId });
      },
      setSectionMaster: (sectionId: string, masterSlideId: string | null) =>
        dispatch({ type: A.SET_SECTION_MASTER, sectionId, masterSlideId }),
      setDeckMaster: (masterSlideId: string | null) => dispatch({ type: A.SET_DECK_MASTER, masterSlideId }),
      addComponent: () => dispatch({ type: A.ADD_COMPONENT }),
      deleteComponent: (componentSlideId: string) => {
        if (!window.confirm('Supprimer ce composant ? Les instances déjà placées sur des diapositives ne seront plus affichées.')) return;
        dispatch({ type: A.DELETE_COMPONENT, componentSlideId });
      },
      insertComponentInstance: (sceneId: string, componentSlideId: string) =>
        dispatch({ type: A.INSERT_COMPONENT_INSTANCE, sceneId, componentSlideId }),
      createComponentFromSelection: (sceneId: string, objectIds: string[], name?: string) =>
        dispatch({ type: A.CREATE_COMPONENT_FROM_SELECTION, sceneId, objectIds, name }),

      // ---- diagram builder (Presentation Studio, Milestone 6) ----
      createConnector: (sceneId: string, fromId: string, toId: string) =>
        dispatch({ type: A.CREATE_CONNECTOR, sceneId, fromId, toId }),
      insertDiagramTemplate: (sceneId: string, templateKey: string) =>
        dispatch({ type: A.INSERT_DIAGRAM_TEMPLATE, sceneId, templateKey }),

      // ---- asset library & presentation templates (Presentation Studio, Milestone 9) ----
      // Reads current state synchronously (via stateRef, same pattern
      // deleteSlide/deleteSection above use) to decide *before* dispatching
      // whether this data: URL already has an asset — the caller (Canvas.tsx's
      // handlePhotoPicked) needs the resolved id immediately after to build
      // the new image object's `data.assetId`, so this can't be a plain
      // fire-and-forget dispatch like every other action here.
      registerAsset: (dataUrl: string, kind: 'image', name: string): string => {
        const existing = findDuplicateAsset(stateRef.current.assetsById, dataUrl);
        if (existing) return existing.id;
        const asset: Asset = createAsset(dataUrl, kind, name);
        dispatch({ type: A.ADD_ASSET, asset });
        return asset.id;
      },
      deleteAsset: (assetId: string) => {
        if (!window.confirm('Supprimer cet asset de la bibliothèque ? Les images qui l’utilisent ne s’afficheront plus.')) return;
        dispatch({ type: A.DELETE_ASSET, assetId });
      },
      addSectionFromTemplate: (templateKey: string) => dispatch({ type: A.ADD_SECTION_FROM_TEMPLATE, templateKey }),
      createNewPresentation,
      importProjectFile,

      // ---- editable overview graph (Presentation Studio v2, Milestone D) ----
      // Thin dispatch wrappers — the reducer's own ADD_EDGE/REDIRECT_EDGE
      // cases already re-validate main-slide membership/no-self-loop/no-dup
      // (see reducer.ts's comment on why), so there's nothing meaningful to
      // pre-check here the way deleteSlide's confirm-dialog pattern needs
      // stateRef for. No confirm on deleteEdge either — same no-confirm
      // precedent as deleteObject (Milestone 1): granular enough that undo
      // is the safety net, not a dialog.
      addEdge: (fromSlideId: string, toSlideId: string) => dispatch({ type: A.ADD_EDGE, fromSlideId, toSlideId }),
      deleteEdge: (edgeId: string) => dispatch({ type: A.DELETE_EDGE, edgeId }),
      redirectEdge: (edgeId: string, endpoint: 'from' | 'to', newSlideId: string) =>
        dispatch({ type: A.REDIRECT_EDGE, edgeId, endpoint, newSlideId }),

      // ---- local presentation library (v2): local-mode welcome screen ----
      openFromLibrary,
      deleteLibraryEntry,
      goToLibrary,
      saveLocalCopyToCloud,
    }),
    [
      importFromText,
      createNewPresentation,
      importProjectFile,
      openFromLibrary,
      deleteLibraryEntry,
      goToLibrary,
      saveLocalCopyToCloud,
    ]
  );

  const value = useMemo(
    () => ({
      state,
      dispatch,
      actions,
      source,
      bootStatus,
      saveStatus,
      savedAt,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      historyTick: history.navTick,
    }),
    [state, actions, source, bootStatus, saveStatus, savedAt, history.past.length, history.future.length, history.navTick]
  );

  return <EditorStateContext.Provider value={value}>{children}</EditorStateContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorStateContext);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}
