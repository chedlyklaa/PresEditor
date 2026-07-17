import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { EditorProvider, useEditor } from './state/EditorContext';
import { AuthProvider } from './state/AuthContext';
import { useKeyboardShortcuts, isTypingContext } from './lib/useKeyboardShortcuts';
import { usePersistedBool } from './lib/usePersistedBool';
import { EI } from './lib/icons';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar/Sidebar';
import Canvas from './components/Canvas/Canvas';
import LayersPanel from './components/Layers/LayersPanel';
import ObjectInspector from './components/Inspector/ObjectInspector';
import NotesPanel from './components/NotesPanel';
import Welcome from './components/Welcome';
import Toast from './components/Toast';
import ShortcutsHelpModal from './components/ShortcutsHelpModal';
import NewPresentationModal from './components/NewPresentationModal';
import OverviewEditor from './components/OverviewEditor';
import SignIn from './routes/SignIn';
import SignUp from './routes/SignUp';
import Home from './routes/Home';
import RequireAuth from './routes/RequireAuth';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

function EditorShell() {
  const { state, actions, bootStatus } = useEditor();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newPresentationOpen, setNewPresentationOpen] = useState(false);
  // Milestone D (v2): a persistent mode switch — Scene edit (the normal
  // Sidebar/Canvas/Inspector layout) vs Overview edit (OverviewEditor.jsx,
  // the deck-level graph). A full mode-indicator UI pass is Milestone F's
  // job; this is just the toggle itself.
  const [overviewMode, setOverviewMode] = useState(false);
  // Milestone C (editor usability overhaul): sidebar/right-panel collapse
  // is remembered across reloads (usePersistedBool); "clean view" is a
  // transient per-session override that hides both regardless of their own
  // collapsed state, for a quick maximize-the-canvas moment — not worth
  // persisting, it's meant to be toggled back almost immediately. Neither
  // one needs to know anything about the canvas: collapsing changes
  // `.ed-body`'s own grid-template-columns below, and useCanvasZoom.ts's
  // existing ResizeObserver on the stage already re-fits automatically
  // whenever that resizes the stage — no new wiring into the zoom hook.
  const [sidebarCollapsed, toggleSidebarCollapsed] = usePersistedBool('ed-sidebar-collapsed', false);
  const [scenePanelCollapsed, toggleScenePanelCollapsed] = usePersistedBool('ed-scenepanel-collapsed', false);
  const [cleanView, setCleanView] = useState(false);
  useKeyboardShortcuts(state, actions, () => setShortcutsOpen(true));

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Tab' && !isTypingContext()) {
        e.preventDefault();
        setCleanView((v) => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const showSidebar = !cleanView;
  const showScenePanel = !cleanView;
  const sidebarW = !showSidebar ? '0px' : sidebarCollapsed ? '32px' : 'var(--sidebar-w)';
  const sceneW = !showScenePanel ? '0px' : scenePanelCollapsed ? '32px' : 'var(--scene-w)';
  const notesW = state.notesOpen && !cleanView ? ' var(--notes-w)' : '';
  const bodyGridStyle = { gridTemplateColumns: `${sidebarW} 1fr ${sceneW}${notesW}` };

  return (
    <div className="ed-app">
      <TopBar
        onShowShortcuts={() => setShortcutsOpen(true)}
        onShowNewPresentation={() => setNewPresentationOpen(true)}
        overviewMode={overviewMode}
        onToggleOverviewMode={() => setOverviewMode((v) => !v)}
      />
      {shortcutsOpen && <ShortcutsHelpModal onClose={() => setShortcutsOpen(false)} />}
      {newPresentationOpen && (
        <NewPresentationModal warnBeforeReplace={true} onClose={() => setNewPresentationOpen(false)} />
      )}
      {bootStatus === 'loading' && (
        <div className="ed-canvas-stage" style={{ width: '100%', gridColumn: '1 / -1' }}>
          <div className="ed-spinner">
            <div className="ed-ring" />
            <div>Chargement…</div>
          </div>
        </div>
      )}
      {bootStatus === 'welcome' && <Welcome />}
      {bootStatus === 'ready' && overviewMode && <OverviewEditor />}
      {bootStatus === 'ready' && !overviewMode && (
        <div className={`ed-body${state.notesOpen ? ' notes-open' : ''}`} style={bodyGridStyle}>
          {showSidebar && <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebarCollapsed} />}
          <Canvas />
          {showScenePanel && (
            <div className={`ed-scene-panel${scenePanelCollapsed ? ' collapsed' : ''}`}>
              <button
                className="ed-panel-toggle-btn ed-panel-toggle-btn-collapse"
                onClick={toggleScenePanelCollapsed}
                title={scenePanelCollapsed ? 'Afficher les calques et propriétés' : 'Masquer les calques et propriétés'}
              >
                <Icon name="chevron" />
              </button>
              {!scenePanelCollapsed && (
                <>
                  <LayersPanel />
                  <ObjectInspector />
                </>
              )}
            </div>
          )}
          {!cleanView && <NotesPanel />}
        </div>
      )}
      {cleanView && (
        <button className="ed-clean-view-exit" onClick={() => setCleanView(false)} title="Quitter la vue épurée (Tab)">
          <Icon name="x" /> Vue épurée — Tab pour revenir
        </button>
      )}
    </div>
  );
}

// /editor/local — public, no guard: the offline/no-account escape hatch.
// EditorProvider's boot behaves exactly as it did before routing existed
// (resume the single-slot session, else auto-fetch presentation.html, else
// its own local Welcome screen/library — see EditorContext.tsx's `source`
// comment).
function LocalEditorRoute() {
  return (
    <EditorProvider source={{ kind: 'local' }}>
      <EditorShell />
    </EditorProvider>
  );
}

// /editor/:id — guarded (see RequireAuth below). `key={id}` forces a fresh
// EditorProvider mount whenever the route param changes (e.g. navigating
// from one project straight to another) instead of trying to hot-swap a
// live provider's loaded document.
function CloudEditorRoute() {
  const { id } = useParams();
  return (
    <EditorProvider key={id} source={{ kind: 'cloud', projectId: id }}>
      <EditorShell />
    </EditorProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route
            path="/home"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
          <Route path="/editor/local" element={<LocalEditorRoute />} />
          <Route
            path="/editor/:id"
            element={
              <RequireAuth>
                <CloudEditorRoute />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
        <Toast />
      </BrowserRouter>
    </AuthProvider>
  );
}
