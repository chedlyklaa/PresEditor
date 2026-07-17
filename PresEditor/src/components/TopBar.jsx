import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useEditor } from '../state/EditorContext';
import { useAuth } from '../state/AuthContext';
import { EI } from '../lib/icons';
import { exportPresentation, presentPresentation } from '../lib/exportPresentation';
import { exportProjectJson } from '../lib/projectFile';
import { toast } from '../lib/toastBus';
import Menu from './Menu';

function Icon({ name }) {
  return <span dangerouslySetInnerHTML={{ __html: EI[name] }} />;
}

// Milestone B (editor usability overhaul): rebuilt around the Phase 0
// mapping table — every control that used to be a top-level button here is
// still reachable (see the plan's mapping table), just grouped into the
// Fichier / Présenter▾ / Compte menus (components/Menu.tsx) so the bar
// itself never needs `.ed-topbar`'s old overflow-x:auto escape hatch. Home
// navigation ("Accueil"/"Mes présentations") deliberately stays a
// standalone control rather than folding into the Compte menu — unlike
// every other account-menu item, it must stay reachable even when signed
// out (local mode's own library), so nesting it inside a signed-in-only
// menu would regress that.
export default function TopBar({ onShowShortcuts, onShowNewPresentation, overviewMode, onToggleOverviewMode }) {
  const { state, actions, saveStatus, savedAt, canUndo, canRedo, source } = useEditor();
  const { user, signOut } = useAuth();
  const fileInputRef = useRef(null);
  const projectInputRef = useRef(null);

  function handleSignOut() {
    if (window.confirm(`Se déconnecter de ${user.email} ?`)) signOut();
  }

  function handleFilePicked(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => actions.importFromText(reader.result, 'import');
    reader.onerror = () => toast('Impossible de lire ce fichier.', true);
    reader.readAsText(file);
  }

  function handleProjectFilePicked(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => actions.importProjectFile(reader.result);
    reader.onerror = () => toast('Impossible de lire ce fichier.', true);
    reader.readAsText(file);
  }

  function handleSaveProject() {
    if (isDeckEmpty()) {
      toast('Rien à enregistrer pour le moment.', true);
      return;
    }
    exportProjectJson(state);
    toast('Projet enregistré (.json).');
  }

  function handlePrint() {
    if (isDeckEmpty()) {
      toast('Rien à imprimer pour le moment.', true);
      return;
    }
    try {
      presentPresentation(state);
      toast('Dans le nouvel onglet : Ctrl/Cmd+P pour imprimer ou exporter en PDF.');
    } catch (err) {
      toast(err.message, true);
    }
  }

  function isDeckEmpty() {
    return state.sections.every((s) => s.slideIds.length === 0) && state.qaSlideIds.length === 0;
  }

  function handleExport() {
    if (isDeckEmpty()) {
      toast('Rien à exporter pour le moment.', true);
      return;
    }
    exportPresentation(state);
    toast('Présentation exportée.');
  }

  function handlePresent() {
    if (isDeckEmpty()) {
      toast('Rien à présenter pour le moment.', true);
      return;
    }
    try {
      presentPresentation(state);
    } catch (err) {
      toast(err.message, true);
    }
  }

  // Milestone B (v2): opens a second tab of the exact same deck, flagged as
  // the presenter view (lib/presenterMode.ts reads window.__presStudioPresenterView
  // to pick its layout) — kept as a fully separate button from "Présenter"
  // rather than replacing it, since a single-window presentation (no second
  // screen available) stays a completely valid, unchanged use case.
  function handlePresentDual() {
    if (isDeckEmpty()) {
      toast('Rien à présenter pour le moment.', true);
      return;
    }
    try {
      presentPresentation(state);
      presentPresentation(state, { presenterView: true });
      toast('Deux onglets ouverts : public et présentateur, synchronisés.');
    } catch (err) {
      toast(err.message, true);
    }
  }

  const statusLabel =
    saveStatus === 'saving'
      ? 'Enregistrement…'
      : saveStatus === 'offline'
      ? 'Hors ligne — modifications conservées localement'
      : saveStatus === 'error'
      ? "Échec de l'enregistrement local"
      : savedAt
      ? `Enregistré à ${savedAt.toLocaleTimeString('fr-FR')}`
      : '—';

  return (
    <div className="ed-topbar">
      <div className="ed-brand">
        <Icon name="sitemap" /> Éditeur
      </div>
      <input
        className="ed-title-input"
        placeholder="Titre de la présentation"
        spellCheck={false}
        value={state.meta.title}
        onChange={(e) => actions.setTitle(e.target.value)}
      />
      <button className="ed-btn" title="Annuler (Ctrl+Z)" disabled={!canUndo} onClick={actions.undo}>
        <Icon name="undo" />
      </button>
      <button className="ed-btn" title="Rétablir (Ctrl+Maj+Z)" disabled={!canRedo} onClick={actions.redo}>
        <Icon name="redo" />
      </button>
      <div className="ed-spacer" />

      {/* ---- Fichier menu: Nouveau / Importer / Ouvrir un projet / Enregistrer le projet ---- */}
      <Menu
        trigger={({ open, toggle }) => (
          <button className={`ed-btn${open ? ' on' : ''}`} onClick={toggle} title="Fichier">
            <Icon name="folder" /> Fichier <Icon name="chevron" />
          </button>
        )}
      >
        <button onClick={onShowNewPresentation} title="Créer une nouvelle présentation (remplace le travail actuel)">
          <Icon name="plus" /> Nouveau
        </button>
        <button onClick={() => fileInputRef.current.click()} title="Importer un fichier presentation.html">
          <Icon name="upload" /> Importer
        </button>
        <button onClick={() => projectInputRef.current.click()} title="Ouvrir un projet enregistré (.json) — le format natif, sans perte">
          <Icon name="folder" /> Ouvrir un projet
        </button>
        <button onClick={handleSaveProject} title="Enregistrer le projet complet en .json — format natif, sans perte, à ré-ouvrir plus tard">
          <Icon name="save" /> Enregistrer le projet
        </button>
      </Menu>
      <input ref={fileInputRef} type="file" accept=".html,text/html" style={{ display: 'none' }} onChange={handleFilePicked} />
      <input
        ref={projectInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleProjectFilePicked}
      />

      {/* ---- View switcher: Éditeur | Vue d'ensemble, Notes attached — icon-only
           with tooltips (labels would push the bar past 1366px with a
           realistic account name; every control here still has a French
           tooltip per the icon-only-needs-a-tooltip rule). ---- */}
      <div className="ed-view-switch">
        <button className={!overviewMode ? 'on' : ''} onClick={() => overviewMode && onToggleOverviewMode()} title="Éditeur">
          <Icon name="type" />
        </button>
        <button className={overviewMode ? 'on' : ''} onClick={() => !overviewMode && onToggleOverviewMode()} title="Vue d'ensemble">
          <Icon name="sitemap" />
        </button>
      </div>
      <button
        className={`ed-btn ed-icon-btn${state.notesOpen ? ' on' : ''}`}
        disabled={overviewMode}
        onClick={actions.toggleNotes}
        title={overviewMode ? "Notes (indisponible en vue d'ensemble)" : 'Afficher/masquer le panneau Notes'}
      >
        <Icon name="note" />
      </button>

      {/* ---- Présenter▾ split button: Présenter / Vue présentateur / Imprimer-PDF ---- */}
      <div className="ed-split-btn">
        <button className="ed-btn primary" onClick={handlePresent} title="Ouvrir la présentation dans un nouvel onglet, sans exporter">
          <Icon name="present" /> Présenter
        </button>
        <Menu
          align="right"
          trigger={({ open, toggle }) => (
            <button className={`ed-btn primary ed-split-caret${open ? ' on' : ''}`} onClick={toggle} title="Autres options de présentation">
              <Icon name="chevron" />
            </button>
          )}
        >
          <button
            onClick={handlePresentDual}
            title="Ouvrir deux onglets synchronisés : public (audience) et présentateur (notes, minuteur, aperçu suivant)"
          >
            <Icon name="monitor" /> Vue présentateur
          </button>
          <button onClick={handlePrint} title="Ouvrir la présentation dans un nouvel onglet prêt pour Ctrl/Cmd+P → PDF">
            <Icon name="print" /> Imprimer / PDF
          </button>
        </Menu>
      </div>

      <button className="ed-btn primary" onClick={handleExport} title="Exporter la présentation en HTML autonome (Ctrl/Cmd + S)">
        <Icon name="download" /> Exporter
      </button>

      {/* ---- Home navigation: always reachable, signed in or not ---- */}
      {source.kind === 'cloud' ? (
        <Link className="ed-btn" to="/home" title="Retour à l'accueil">
          ← <Icon name="library" /> Accueil
        </Link>
      ) : (
        <button className="ed-btn" onClick={actions.goToLibrary} title="Retour à l'accueil : vos présentations précédentes">
          ← <Icon name="library" /> Mes présentations
        </button>
      )}

      {/* ---- Compte menu ---- */}
      {user ? (
        <Menu
          align="right"
          trigger={({ open, toggle }) => (
            <button className={`ed-btn${open ? ' on' : ''}`} onClick={toggle} title={`Connecté en tant que ${user.email}`}>
              <Icon name="user" />
              <span className="ed-account-btn-email">{user.displayName}</span>
              <Icon name="chevron" />
            </button>
          )}
        >
          {source.kind === 'local' && (
            <button
              onClick={actions.saveLocalCopyToCloud}
              title="Téléverser une copie de cette présentation locale dans votre compte, pour la retrouver et la synchroniser depuis n'importe quel appareil"
            >
              <Icon name="cloud" /> Enregistrer une copie dans mon compte
            </button>
          )}
          <div className="ed-menu-sep" />
          <button className="danger" onClick={handleSignOut}>
            <Icon name="user" /> Se déconnecter
          </button>
        </Menu>
      ) : (
        <Link className="ed-btn" to="/signin" title="Se connecter pour synchroniser vos présentations entre vos appareils">
          <Icon name="user" /> Se connecter
        </Link>
      )}

      <button className="ed-btn ed-icon-btn" title="Raccourcis clavier (?)" onClick={onShowShortcuts}>
        <Icon name="question" />
      </button>
      <div
        className={`ed-status${saveStatus === 'saving' ? ' saving' : ''}${saveStatus === 'error' ? ' error' : ''}${
          saveStatus === 'offline' ? ' offline' : ''
        }`}
      >
        {statusLabel}
      </div>
    </div>
  );
}
